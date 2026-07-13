// Ingest OUR OWN repositories (local directories) into the Foundry as 'owned' code — trained on
// regardless of license. Each --Repos path is one repo.
//   bun run Scripts/IngestOwnRepos.ts --Repos=.,../client,../server --Store=postgres

import { InMemoryDocumentStore, CreateLocalRepoProvider, IngestFromWeb, BuildReport, RenderReportText } from "../Foundry/FoundryBarrel.ts";
import type { DocumentStore } from "../Foundry/FoundryBarrel.ts";
import { PostgresDocumentStore } from "../Foundry/PostgresDocumentStore.ts";
import { ReadArg } from "./ScriptArgs.ts";

const Roots = ReadArg("--Repos=", ".").split(",").map((S) => S.trim()).filter((S) => S.length > 0);
const Store: DocumentStore = ReadArg("--Store=", "memory") === "postgres"
  ? new PostgresDocumentStore(process.env["DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/shahd")
  : new InMemoryDocumentStore();

const Provider = CreateLocalRepoProvider({
  Roots,
  License: ReadArg("--License=", "OWNED"),
  MinLevel: "medium",
  OnRepo: (Info) =>
    console.log(`  ${Info.Repo}: level=${Info.Assessment.Level} files=${Info.Assessment.FileCount} avgQ=${Info.Assessment.AvgQuality.toFixed(2)} bytes=${Info.Assessment.TotalBytes} -> ${Info.Ingested ? "INGESTED WHOLE" : "skipped"}`),
});

console.log(`ingesting own repos: ${Roots.join(", ")}`);
const Stats = await IngestFromWeb([Provider], [""], Store, new Date().toISOString());
console.log(`\ningested ${Stats.Ingested} files -> Filtered=${Stats.ByTier.Filtered} Rejected=${Stats.ByTier.Rejected}\n`);
console.log(RenderReportText(BuildReport(await Store.All())));
