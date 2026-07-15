// In-memory CollectionStateStore — the dependency-free implementation for tests and no-database runs.
// Same interface as the Postgres store, so the Learn flow's state tracking is validated without a DB.

import type { CollectionStateStore, CollectionState } from "./CollectionState.ts";

export class InMemoryCollectionStateStore implements CollectionStateStore {
  private States = new Map<string, CollectionState>();

  async Get(SourceKey: string): Promise<CollectionState | null> {
    return this.States.get(SourceKey) ?? null;
  }

  async Upsert(State: CollectionState): Promise<void> {
    this.States.set(State.SourceKey, { ...State }); // copy so later caller mutation can't leak in
  }

  async All(): Promise<CollectionState[]> {
    return [...this.States.values()].sort((A, B) => B.UpdatedAt.localeCompare(A.UpdatedAt));
  }
}
