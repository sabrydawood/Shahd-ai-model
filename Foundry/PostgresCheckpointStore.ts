// Store model checkpoints (weights + optimizer + RNG + config + tokenizer) in Postgres, so a trained
// model is durable and synced alongside the corpus + chat — not a gitignored file a `git clean` can
// wipe. Brain stays Postgres-agnostic: it builds/parses the checkpoint object (BuildCheckpoint /
// ParseCheckpoint); this Foundry store just persists that object's JSON as a row. Lightweight meta
// (params/arch/vocab) is stored separately so List() never has to fetch the multi-MB payload.
//
// NOTE: fine for the current small models (~15MB JSON). For future GB-scale models, move the payload
// to object storage and keep only the metadata row here.

import postgres from "postgres";
import type { Checkpoint } from "../Brain/Checkpoint/CheckpointFormat.ts";
import { ParseCheckpoint } from "../Brain/Checkpoint/CheckpointReader.ts";

// Format = "chat" (SFT/agent model) or "base" (pretrained autocomplete); Step = training steps done
// so far (for the dashboard's "resume/extend from step N"). Embed/Layers/Heads/Block are the exact
// architecture — the dashboard's "Resume training" prefills them so a re-run matches the checkpoint's
// arch exactly (a NumHeads mismatch would otherwise silently retrain from scratch). All from the Meta.
export type CheckpointSummary = { Name: string; CreatedAt: string; Params: number; Vocab: number; Arch: string; Corpus: string; Format: string; Step: number; Embed: number; Layers: number; Heads: number; Block: number };

type MetaRow = { name: string; created_at: string; meta: string };
type DataRow = { data: string };
type StoredMeta = { params: number; vocab: number; arch: string; corpus: string; format: string; step: number; embed: number; layers: number; heads: number; block: number };

function MetaOf(Ckpt: Checkpoint): StoredMeta {
  const Meta = Ckpt.Meta as Record<string, unknown>;
  const M = Ckpt.Config.Model;
  const Corpus = String(Meta["Corpus"] ?? "");
  // Prefer the explicit Meta.Format; infer from the corpus tag for older checkpoints that predate it.
  const Format = typeof Meta["Format"] === "string" ? (Meta["Format"] as string) : Corpus.includes("sft") ? "chat" : "base";
  return {
    params: Ckpt.Params.reduce((Acc, P) => Acc + P.Rows * P.Cols, 0),
    vocab: M.VocabSize,
    arch: `emb${M.EmbedDim} L${M.NumLayers} h${M.NumHeads} ctx${M.BlockSize}`,
    corpus: Corpus,
    format: Format,
    step: Number(Meta["Step"] ?? 0),
    embed: M.EmbedDim,
    layers: M.NumLayers,
    heads: M.NumHeads,
    block: M.BlockSize,
  };
}

export class PostgresCheckpointStore {
  private Sql: ReturnType<typeof postgres>;
  private Ready: Promise<void>;

  constructor(Url: string) {
    this.Sql = postgres(Url);
    this.Ready = this.Migrate().catch((Caught) => {
      console.warn(`PostgresCheckpointStore: migration deferred: ${(Caught as Error).message}`);
    });
  }

  private async Migrate(): Promise<void> {
    await this.Sql`CREATE TABLE IF NOT EXISTS checkpoints (name TEXT PRIMARY KEY, format_version INT NOT NULL, data TEXT NOT NULL, meta TEXT NOT NULL, created_at TEXT NOT NULL)`;
  }

  async Save(Name: string, Ckpt: Checkpoint, CreatedAt: string): Promise<void> {
    await this.Ready;
    const Data = JSON.stringify(Ckpt);
    const Meta = JSON.stringify(MetaOf(Ckpt));
    await this.Sql`
      INSERT INTO checkpoints (name, format_version, data, meta, created_at)
      VALUES (${Name}, ${Ckpt.FormatVersion}, ${Data}, ${Meta}, ${CreatedAt})
      ON CONFLICT (name) DO UPDATE SET format_version = EXCLUDED.format_version, data = EXCLUDED.data, meta = EXCLUDED.meta, created_at = EXCLUDED.created_at`;
  }

  async Load(Name: string): Promise<Checkpoint | null> {
    await this.Ready;
    const Rows = (await this.Sql`SELECT data FROM checkpoints WHERE name = ${Name} LIMIT 1`) as unknown as DataRow[];
    return Rows[0] ? ParseCheckpoint(Rows[0].data) : null;
  }

  async List(): Promise<CheckpointSummary[]> {
    await this.Ready;
    const Rows = (await this.Sql`SELECT name, created_at, meta FROM checkpoints ORDER BY created_at DESC`) as unknown as MetaRow[];
    return Rows.map((R) => {
      const M = JSON.parse(R.meta) as Partial<StoredMeta>;
      const Corpus = M.corpus ?? "";
      return {
        Name: R.name,
        CreatedAt: R.created_at,
        Params: M.params ?? 0,
        Vocab: M.vocab ?? 0,
        Arch: M.arch ?? "",
        Corpus,
        Format: M.format ?? (Corpus.includes("sft") ? "chat" : "base"),
        Step: M.step ?? 0,
        Embed: M.embed ?? 0,
        Layers: M.layers ?? 0,
        Heads: M.heads ?? 0,
        Block: M.block ?? 0,
      };
    });
  }

  async Delete(Name: string): Promise<void> {
    await this.Ready;
    await this.Sql`DELETE FROM checkpoints WHERE name = ${Name}`;
  }

  async Close(): Promise<void> {
    await this.Sql.end();
  }
}
