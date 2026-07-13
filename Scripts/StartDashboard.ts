// Ingest the seed corpus into an in-memory Foundry and serve the inspection dashboard.
//   bun run Scripts/StartDashboard.ts   (then open http://localhost:8090)

import { readFileSync, existsSync } from "node:fs";
import { InMemoryDocumentStore, IngestDocuments, StartDashboard } from "../Brain/Foundry/FoundryBarrel.ts";
import type { SourceInput } from "../Brain/Foundry/FoundryBarrel.ts";
import { ReadArg } from "./ScriptArgs.ts";

type ManifestEntry = { Source: string; License: string; Path: string; Lang?: string };

const Manifest = JSON.parse(readFileSync("Corpus/Manifest.json", "utf8")) as { Documents: ManifestEntry[] };
const Inputs: SourceInput[] = Manifest.Documents
  .filter((E) => existsSync(E.Path))
  .map((E) => ({ Source: E.Source, License: E.License, Lang: E.Lang ?? "unknown", Content: readFileSync(E.Path, "utf8"), Provenance: E.Path, Origin: "local" as const }));

const Store = new InMemoryDocumentStore();
await IngestDocuments(Inputs, Store, "2026-07-13T00:00:00.000Z");

const Port = Number(ReadArg("--Port=", "8090"));
StartDashboard(Store, Port);
console.log(`Data Foundry dashboard: http://localhost:${Port}  (${await Store.Count()} documents)`);
