// Foundry ingestion + export flow (M3). IngestDocuments classifies each input into a tier, hashes
// its content (stable id + exact-dup key), embeds it, and upserts it to the store. The web-fetching
// itself is NOT here — callers pass inputs tagged with an Origin (local / web-permissive /
// web-general), so ingestion stays pure and testable and the risky network fetch is an injected
// concern. ExportTrainingText materializes only the training-eligible (Filtered) tier.

import { createHash } from "node:crypto";
import type { DocumentStore } from "./DocumentStore.ts";
import type { DocumentRecord, Origin, Tier } from "./DocumentRecord.ts";
import { ClassifyDocument } from "./Tiering.ts";
import { HashingEmbedding } from "./Embedding.ts";

export type SourceInput = {
  Source: string;
  License: string;
  Lang: string;
  Content: string;
  Provenance: string;
  Origin: Origin;
};

export type IngestStats = { Ingested: number; ByTier: Record<Tier, number> };

export async function IngestDocuments(
  Inputs: SourceInput[],
  Store: DocumentStore,
  IngestedAt: string,
  EmbeddingDim = 256,
): Promise<IngestStats> {
  const ByTier: Record<Tier, number> = { Filtered: 0, Raw: 0, Rejected: 0 };
  for (const Input of Inputs) {
    const Decision = ClassifyDocument(Input.License, Input.Content, Input.Origin);
    const ContentHash = createHash("sha256").update(Input.Content).digest("hex").slice(0, 32);
    // The dedup/primary key includes Origin + License so provenance-distinct copies of identical
    // bytes do NOT overwrite each other (a web-general Raw copy must not clobber a local Filtered
    // one, and a Rejected doc must not be "laundered" into Filtered by re-tagging its license).
    const Id = createHash("sha256").update(`${Input.Origin}\0${Input.License}\0${Input.Content}`).digest("hex").slice(0, 32);
    const Record: DocumentRecord = {
      Id,
      Tier: Decision.Tier,
      Origin: Input.Origin,
      Source: Input.Source,
      License: Input.License,
      Lang: Input.Lang,
      Content: Input.Content,
      Bytes: Buffer.byteLength(Input.Content, "utf8"),
      QualityScore: Decision.QualityScore,
      ContentHash,
      Embedding: HashingEmbedding(Input.Content, EmbeddingDim),
      RejectReason: Decision.RejectReason,
      Provenance: Input.Provenance,
      IngestedAt,
    };
    await Store.Upsert(Record);
    ByTier[Decision.Tier]++;
  }
  return { Ingested: Inputs.length, ByTier };
}

/** Materialize the training-eligible (Filtered) tier as one training-ready text blob. */
export async function ExportTrainingText(Store: DocumentStore, Separator = "\n\n"): Promise<string> {
  const Filtered = await Store.ByTier("Filtered");
  return Filtered.map((Doc) => Doc.Content).join(Separator);
}
