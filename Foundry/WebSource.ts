// Web ingestion orchestrator (M6). A WebProvider fetches documents already tagged with an Origin;
// IngestFromWeb runs the providers over a set of queries and feeds the results through the normal
// Foundry ingestion (so tiering/license/quality/dedup apply identically to web and local data). A
// provider that throws is skipped (non-fatal) so one bad source can't sink the whole run. Providers
// are injected — the network fetch and any search/API key live in the provider, never here.

import type { DocumentStore } from "./DocumentStore.ts";
import type { SourceInput, IngestStats } from "./Ingest.ts";
import { IngestDocuments } from "./Ingest.ts";

export type WebProvider = {
  Name: string;
  Fetch: (Query: string, Limit: number) => Promise<SourceInput[]>;
};

// Incremental sink: a repo provider calls this the moment a repo is downloaded+assessed, so the
// caller can STORE that repo before the next one downloads (durable progress, low memory). When a
// provider is given a sink it streams into it and returns []; otherwise it collects and returns all.
export type RepoSink = (Source: string, Files: SourceInput[]) => Promise<void>;

// Per-repo file-level ingestion progress: which repo, how many of its files are stored, out of how
// many. Lets the dashboard show a bar for the repo currently being ingested, not just "done".
export type IngestProgress = (Repo: string, FilesDone: number, FilesTotal: number) => void;

export async function IngestFromWeb(
  Providers: WebProvider[],
  Queries: string[],
  Store: DocumentStore,
  IngestedAt: string,
  PerQuery = 10,
  EmbeddingDim = 256,
  OnProgress?: IngestProgress,
): Promise<IngestStats> {
  const Collected: SourceInput[] = [];
  for (const Provider of Providers) {
    for (const Query of Queries) {
      try {
        Collected.push(...(await Provider.Fetch(Query, PerQuery)));
      } catch {
        // A provider/query failure is non-fatal — skip it and keep going.
      }
    }
  }

  // Group the collected files by repo (Source) so ingestion runs — and reports progress — per repo,
  // preserving arrival order. IngestDocuments keeps its per-document try/catch resilience unchanged.
  const ByRepo = new Map<string, SourceInput[]>();
  for (const Input of Collected) {
    const Group = ByRepo.get(Input.Source) ?? [];
    Group.push(Input);
    ByRepo.set(Input.Source, Group);
  }

  const Total: IngestStats = { Ingested: 0, ByTier: { Filtered: 0, Raw: 0, Rejected: 0 }, Failed: 0 };
  for (const [Repo, Group] of ByRepo) {
    const Stats = await IngestDocuments(Group, Store, IngestedAt, EmbeddingDim, (Done, TotalFiles) => OnProgress?.(Repo, Done, TotalFiles));
    Total.Ingested += Stats.Ingested;
    Total.Failed += Stats.Failed;
    Total.ByTier.Filtered += Stats.ByTier.Filtered;
    Total.ByTier.Raw += Stats.ByTier.Raw;
    Total.ByTier.Rejected += Stats.ByTier.Rejected;
  }
  return Total;
}
