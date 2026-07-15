// The Foundry's persistence boundary (M3). The model never depends on this; only the data-curation
// layer does. Async so a Postgres/pgvector implementation fits the same interface as the in-memory
// one used in tests. FindSimilar powers semantic near-dup and "find similar" over embeddings.

import type { DocumentRecord, Tier } from "./DocumentRecord.ts";

export type SimilarHit = { Doc: DocumentRecord; Score: number };

// Per-repo rollup for the dashboard (accordion list + "already learned" skip).
export type RepoSummary = { Source: string; Files: number; Bytes: number };

// A filter for the data-browser: any subset of tier/lang/license + a free-text search (matched
// against provenance and content). Omitted fields are unconstrained. Empty filter = everything.
export type DocumentFilter = { Tier?: Tier; Lang?: string; License?: string; Search?: string };

// One page of a filtered browse: the rows for this page plus the TOTAL matching count (so the UI can
// render "page X of Y" without loading every row).
export type DocumentPage = { Rows: DocumentRecord[]; Total: number };

// Aggregate counts for the dashboard cards — computed WITHOUT loading document content.
export type FoundryStats = {
  Total: number;
  ByTier: Record<Tier, number>;
  ByLang: Record<string, number>;
  ByLicense: Record<string, number>;
  FilteredBytes: number;
};

export interface DocumentStore {
  /** Insert or update a document by Id (content hash). Returns true if the row was NEWLY inserted,
   *  false if it already existed (a dedup hit that was updated in place) — so ingestion can honestly
   *  report "N new vs M duplicate" instead of counting every upsert as fresh data. */
  Upsert(Doc: DocumentRecord): Promise<boolean>;
  All(): Promise<DocumentRecord[]>;
  /** Documents in a tier; Limit caps the read (used for per-kind training size control). */
  ByTier(Tier: Tier, Limit?: number): Promise<DocumentRecord[]>;
  FindSimilar(Embedding: number[], Limit: number): Promise<SimilarHit[]>;
  Count(): Promise<number>;
  /** Distinct repo/source names already ingested (used to skip re-learning). */
  Sources(): Promise<string[]>;
  /** Per-repo file counts + bytes, most files first (the dashboard's repo list). */
  RepoSummaries(): Promise<RepoSummary[]>;
  /** Documents belonging to one repo/source (accordion contents). */
  DocumentsBySource(Source: string, Limit: number): Promise<DocumentRecord[]>;
  /** One document's full record by id (content hash) — powers the file viewer. Null if absent. */
  DocumentById(Id: string): Promise<DocumentRecord | null>;
  /**
   * A filtered, paginated page of documents (the data-browser). Offset/Limit page the results;
   * Total is the full matching count for the pager. Rows come newest-first (by ingestion) so the
   * most recently collected data is reviewed first.
   */
  Query(Filter: DocumentFilter, Offset: number, Limit: number): Promise<DocumentPage>;
  /** Delete one document by id. Returns the number removed (0 if the id was absent, else 1). */
  DeleteById(Id: string): Promise<number>;
  /** Bulk-delete every document matching a filter (corpus cleanup). Returns how many were removed. */
  DeleteMatching(Filter: DocumentFilter): Promise<number>;
  /** Aggregate dashboard stats (counts by tier/lang/license + filtered bytes), computed efficiently. */
  Stats(): Promise<FoundryStats>;
  /**
   * Relabel a source's NOASSERTION docs once its real license is verified (license-backfill). Docs
   * that also pass quality (>= MinQuality) are promoted to Filtered with NewLicense and reject_reason
   * cleared; the rest keep their tier but get NewLicense + a low-quality reason. Scoped to
   * license='NOASSERTION' so only the previously-unresolved rows are touched. Returns the split.
   */
  ReclassifyBySource(Source: string, NewLicense: string, MinQuality: number): Promise<{ Promoted: number; KeptLowQuality: number }>;
}
