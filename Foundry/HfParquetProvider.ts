// Generic Hugging Face parquet provider (data engine, Phase 2) — the reusable engine behind the bulk
// datasets that only ship as parquet (Wikipedia dumps now; Gutenberg / Stack Exchange later). The HF
// datasets-server /rows JSON API is unreachable from here, but the parquet FILES download fine via
// resolve/main, and hyparquet + hyparquet-compressors decode them (verified: codec is not a blocker).
//
// A dataset's shards are discovered from the HF tree API, then downloaded ONE per run (whole file — the
// user chose whole-shard over byte-range for now) and decoded in row windows so memory stays bounded to
// the shard buffer + one window. A {Shard, Offset} cursor (persisted in collection_state) makes runs
// resume across shards — the first real use of that Phase-1 cursor. download/decode/list are injected so
// the provider is testable with plain data (no network, no real parquet).

import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import type { WebProvider, RepoSink } from "./WebSource.ts";
import type { SourceInput } from "./Ingest.ts";
import type { DataKind } from "./DataKinds.ts";
import { FetchWithBackoff, HttpError } from "./HttpBackoff.ts";

export type ParquetRow = Record<string, unknown>;

// One HF parquet dataset the provider can collect. ConfigFor turns the run's Query (e.g. a Wikipedia
// language) into the HF config directory; MapRow turns a decoded row into a document body (or null to
// skip a stub). License/Kind are fixed per source and recorded on every document.
export type HfParquetSource = {
  Name: string;
  Kind: DataKind;
  License: string;
  Dataset: string; // "wikimedia/wikipedia"
  ConfigFor: (Query: string) => string; // lang -> "20231101.simple"
  MapRow: (Row: ParquetRow, Query: string) => { Content: string; Provenance: string; Lang: string } | null;
};

export type HfParquetOptions = {
  StartShard?: number; // resume: shard index to start at (from the persisted cursor)
  StartOffset?: number; // resume: row offset within that shard
  MaxPerRun?: number; // cap rows collected this run
  WindowRows?: number; // rows decoded per hyparquet call (memory vs. call-count trade-off)
  BatchSize?: number;
  ListShards?: (Dataset: string, Config: string) => Promise<string[]>; // injected in tests
  FetchShard?: (Url: string) => Promise<ArrayBuffer>; // injected in tests
  ReadRows?: (File: ArrayBuffer, Start: number, End: number) => Promise<ParquetRow[]>; // injected in tests
  OnCursor?: (Shard: number, Offset: number) => void; // report progress so the caller can persist it
  Sleep?: (Ms: number) => Promise<void>;
  OnRepoStart?: (Name: string) => void;
  OnRepoReady?: RepoSink;
  Log?: (Message: string) => void;
};

const HfBase = "https://huggingface.co";

// Discover a dataset config's parquet shards (ordered) via the HF tree API — reachable even though the
// datasets-server is not. Returns full resolve URLs.
async function DefaultListShards(Dataset: string, Config: string, Sleep?: (Ms: number) => Promise<void>): Promise<string[]> {
  const Tree = (await FetchWithBackoff(
    async () => {
      const Response = await fetch(`${HfBase}/api/datasets/${Dataset}/tree/main/${Config}`, { headers: { "User-Agent": "shahd-foundry" } });
      if (!Response.ok) throw new HttpError(Response.status);
      return Response.json() as Promise<{ path?: string }[]>;
    },
    { Sleep },
  )) as { path?: string }[];
  return Tree.filter((E) => typeof E.path === "string" && E.path.endsWith(".parquet"))
    .map((E) => E.path!)
    .sort()
    .map((Path) => `${HfBase}/datasets/${Dataset}/resolve/main/${Path}`);
}

async function DefaultFetchShard(Url: string, Sleep?: (Ms: number) => Promise<void>): Promise<ArrayBuffer> {
  // A parquet shard is large (100s of MB) and HF's xethub CDN intermittently drops a long transfer
  // mid-stream (ECONNRESET) — the transfer is fine, the connection just blips. Retry generously on a
  // fresh connection (6 attempts); a real HTTP status error still fails fast. Byte-range reads (a later
  // optimization) are the structural fix — smaller requests are far less likely to drop.
  return FetchWithBackoff(
    async () => {
      const Response = await fetch(Url, { headers: { "User-Agent": "shahd-foundry" } }); // follows the HF 302
      if (!Response.ok) throw new HttpError(Response.status);
      return Response.arrayBuffer();
    },
    { Sleep, MaxAttempts: 6, BaseDelayMs: 1000 },
  );
}

async function DefaultReadRows(File: ArrayBuffer, Start: number, End: number): Promise<ParquetRow[]> {
  return parquetReadObjects({ file: File, compressors, rowStart: Start, rowEnd: End });
}

export function CreateHfParquetProvider(Source: HfParquetSource, Options: HfParquetOptions = {}): WebProvider {
  const MaxPerRun = Options.MaxPerRun ?? 200_000;
  const Window = Options.WindowRows ?? 1000;
  const BatchSize = Options.BatchSize ?? 500;
  const ListShards = Options.ListShards ?? ((D: string, C: string): Promise<string[]> => DefaultListShards(D, C, Options.Sleep));
  const FetchShard = Options.FetchShard ?? ((U: string): Promise<ArrayBuffer> => DefaultFetchShard(U, Options.Sleep));
  const ReadRows = Options.ReadRows ?? DefaultReadRows;
  const Log = Options.Log ?? ((Message: string): void => console.log(Message));

  return {
    Name: Source.Name,
    Semantics: "streaming", // more shards / languages remain to collect; cursor advances across runs
    Fetch: async (Query: string, Limit: number): Promise<SourceInput[]> => {
      const Config = Source.ConfigFor(Query);
      Options.OnRepoStart?.(`${Source.Name} ${Config} shards`);
      const Shards = await ListShards(Source.Dataset, Config);
      Log(`[${Source.Name}] ${Config}: ${Shards.length} shard(s)`);

      const Shard = Options.StartShard ?? 0;
      let Offset = Options.StartOffset ?? 0;
      const Cap = Math.min(Math.max(1, Limit), MaxPerRun);

      if (Shard >= Shards.length) {
        Log(`[${Source.Name}] all ${Shards.length} shard(s) already collected (cursor past end)`);
        Options.OnCursor?.(Shard, 0);
        return [];
      }

      Options.OnRepoStart?.(`${Source.Name} shard ${Shard + 1}/${Shards.length}`);
      Log(`[${Source.Name}] downloading shard ${Shard + 1}/${Shards.length} (whole file)…`);
      const File = await FetchShard(Shards[Shard]!);

      let Batch: SourceInput[] = [];
      let Collected = 0;
      const Flush = async (): Promise<void> => {
        if (Batch.length > 0 && Options.OnRepoReady !== undefined) {
          Options.OnRepoStart?.(`${Source.Name} ${Config} (${Collected}/${Cap})`); // Stop boundary between batches
          await Options.OnRepoReady(`${Source.Name}-${Config}`, Batch);
          Batch = [];
        }
      };

      let ShardDone = false;
      while (Collected < Cap && !ShardDone) {
        const Rows = await ReadRows(File, Offset, Offset + Window);
        if (Rows.length === 0) {
          ShardDone = true;
          break;
        }
        // Advance the offset by rows actually CONSUMED, not by the window size: when the MaxPerRun cap is
        // hit mid-window, the unconsumed rows must be re-read next run, not skipped.
        let Consumed = 0;
        for (const Row of Rows) {
          Consumed++;
          const Mapped = Source.MapRow(Row, Query);
          if (Mapped !== null) {
            Batch.push({ Source: Source.Name, License: Source.License, Lang: Mapped.Lang, Content: Mapped.Content, Provenance: Mapped.Provenance, Origin: "curated" });
            Collected++;
            if (Batch.length >= BatchSize) await Flush();
          }
          if (Collected >= Cap) break;
        }
        Offset += Consumed;
        if (Rows.length < Window) ShardDone = true; // last (partial) window of the shard
      }
      await Flush();

      // Advance the cursor: to the next shard if this one is finished, else stay on it at the new offset
      // (a mid-shard cap will re-download this shard next run — the whole-shard trade-off the user chose).
      const NextShard = ShardDone ? Shard + 1 : Shard;
      const NextOffset = ShardDone ? 0 : Offset;
      Options.OnCursor?.(NextShard, NextOffset);
      Log(`[${Source.Name}] collected ${Collected} docs; cursor -> shard ${NextShard} offset ${NextOffset}`);
      return [];
    },
  };
}

// The first parquet source: Wikipedia dumps (CC-BY-SA), bulk knowledge to replace the live API's trickle.
// Query is the language ("simple" for Simple English by default — the smallest config, one shard).
export const WikiDumpSource: HfParquetSource = {
  Name: "wikidump",
  Kind: "knowledge",
  License: "CC-BY-SA-4.0",
  Dataset: "wikimedia/wikipedia",
  ConfigFor: (Query: string): string => `20231101.${(Query || "simple").trim().toLowerCase()}`,
  MapRow: (Row: ParquetRow, Query: string): { Content: string; Provenance: string; Lang: string } | null => {
    const Lang = (Query || "simple").trim().toLowerCase();
    const Title = typeof Row["title"] === "string" ? (Row["title"] as string) : "";
    const Text = typeof Row["text"] === "string" ? (Row["text"] as string).trim() : "";
    if (Text.length < 200) return null; // skip stubs / near-empty extracts
    return { Content: `${Title}\n\n${Text}`.trim(), Provenance: `wikipedia:${Lang}:${Row["id"] ?? "?"}`, Lang: `text-${Lang}` };
  },
};
