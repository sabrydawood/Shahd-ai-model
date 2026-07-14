// Split the single `documents` table into per-kind tables (Phase 9). Each data kind gets its own
// table (documents_<kind>, identical schema) so data types stay physically separate. Classification
// of the EXISTING rows: text-* from oasst -> conversation, text-* from wikipedia (or other) ->
// knowledge, everything else -> code. Dry-run by default (reports the split); --Apply creates the
// tables and copies rows into them. Non-destructive: the original `documents` table is KEPT so the
// move is verifiable and reversible before anything is dropped.
//
//   bun run Scripts/MigrateKinds.ts            # dry run: show the per-kind split
//   bun run Scripts/MigrateKinds.ts --Apply    # create documents_<kind> tables and copy rows in

import postgres from "postgres";
import { DataKinds, TableForKind } from "../Foundry/DataKinds.ts";
import type { DataKind } from "../Foundry/DataKinds.ts";
import { DatabaseUrl } from "./FoundryEnv.ts";
import { ReadFlag } from "./ScriptArgs.ts";

const Apply = ReadFlag("--Apply");
const Sql = postgres(DatabaseUrl());

// The WHERE clause that assigns an existing `documents` row to a kind. Mutually exclusive + exhaustive.
const KindWhere: Record<DataKind, ReturnType<typeof Sql> | null> = {
  conversation: Sql`lang like 'text-%' and source like 'oasst%'`,
  knowledge: Sql`lang like 'text-%' and source not like 'oasst%'`,
  code: Sql`lang not like 'text-%'`,
  books: null, // reserved — no existing rows map here yet
  web: null,
  instruction: null,
};

console.log(`Migrate documents -> per-kind tables. Mode: ${Apply ? "APPLY" : "DRY-RUN"}\n`);

// Guard: only run if the legacy table exists.
const HasLegacy = await Sql<{ exists: boolean }[]>`select to_regclass('public.documents') is not null as exists`;
if (!HasLegacy[0]?.exists) {
  console.log("no legacy `documents` table — nothing to migrate.");
  await Sql.end();
  process.exit(0);
}

let TotalMoved = 0;
for (const Kind of DataKinds) {
  const Where = KindWhere[Kind];
  if (Where === null) {
    console.log(`${Kind.padEnd(13)} — reserved (empty table${Apply ? " created" : ""})`);
    if (Apply) await Sql`create table if not exists ${Sql(TableForKind(Kind))} (like documents including all)`;
    continue;
  }
  const CountRows = await Sql<{ n: number }[]>`select count(*)::int n from documents where ${Where}`;
  const N = CountRows[0]?.n ?? 0;
  if (Apply) {
    await Sql`create table if not exists ${Sql(TableForKind(Kind))} (like documents including all)`;
    const Moved = await Sql`insert into ${Sql(TableForKind(Kind))} select * from documents where ${Where} on conflict (id) do nothing`;
    console.log(`${Kind.padEnd(13)} ${String(N).padStart(7)} rows -> ${TableForKind(Kind)} (${Moved.count} inserted)`);
  } else {
    console.log(`${Kind.padEnd(13)} ${String(N).padStart(7)} rows -> ${TableForKind(Kind)}`);
  }
  TotalMoved += N;
}

console.log(`\n${Apply ? "APPLIED" : "DRY-RUN"}: ${TotalMoved} rows across kinds. Legacy \`documents\` table kept (drop it only after verifying).`);
if (!Apply) console.log("Re-run with --Apply to create the per-kind tables and copy the rows.");
await Sql.end();
