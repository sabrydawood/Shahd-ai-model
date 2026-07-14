// The per-kind store set (Phase 9): one document store per data kind, each on its own table
// (documents_<kind>), sharing a SINGLE Postgres connection pool. This is the single entry point for
// the physically-separated data types — Kind(k) gives the store for one kind, Stats() gives the
// per-kind breakdown the dashboard shows. Training composes a corpus by reading the kinds it wants,
// each up to its own size cap, so models can be pure-code, pure-conversation, or a controlled mix.

import postgres from "postgres";
import { DataKinds, TableForKind } from "./DataKinds.ts";
import type { DataKind } from "./DataKinds.ts";
import { PostgresDocumentStore } from "./PostgresDocumentStore.ts";
import type { DocumentStore } from "./DocumentStore.ts";

export type KindStat = { Kind: DataKind; Count: number; FilteredBytes: number };

export class FoundryStores {
  private Sql: ReturnType<typeof postgres>;
  private Stores = new Map<DataKind, PostgresDocumentStore>();

  constructor(Url: string) {
    this.Sql = postgres(Url);
  }

  /** The store for one kind (its own documents_<kind> table), created lazily on the shared connection. */
  Kind(Kind: DataKind): DocumentStore {
    let Store = this.Stores.get(Kind);
    if (Store === undefined) {
      Store = new PostgresDocumentStore(this.Sql, TableForKind(Kind));
      this.Stores.set(Kind, Store);
    }
    return Store;
  }

  /** Per-kind document count + training-eligible bytes. A missing table (kind not populated yet)
   *  reports zero rather than throwing, so the breakdown is always renderable. */
  async Stats(): Promise<KindStat[]> {
    const Out: KindStat[] = [];
    for (const Kind of DataKinds) {
      try {
        const S = await this.Kind(Kind).Stats();
        Out.push({ Kind, Count: S.Total, FilteredBytes: S.FilteredBytes });
      } catch {
        Out.push({ Kind, Count: 0, FilteredBytes: 0 });
      }
    }
    return Out;
  }

  async Close(): Promise<void> {
    await this.Sql.end();
  }
}
