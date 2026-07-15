// Re-tier curated PROSE that the code-quality filter wrongly Rejected (Phase 9 fix). Conversation /
// knowledge / books are natural language; the old tiering scored them with ScoreCodeQuality, whose
// line-length heuristics reject detailed (long-line) dialogue and articles as "minified?". This pass
// re-scores every Rejected curated doc with ScoreTextQuality (prose-aware) and PROMOTES the ones that
// now pass to Filtered (clearing the reject reason). It only ever promotes — never demotes — and only
// touches Origin="curated" rows, so it is safe to re-run. The document id (Origin+License+Content hash)
// is unchanged, so each promotion updates the same row in place.
//
//   bun run Scripts/RetierProse.ts            # dry-run: report how many would be promoted
//   bun run Scripts/RetierProse.ts --Apply    # write the promotions to Postgres

import { ScoreTextQuality } from "../Brain/Data/QualityFilter.ts";
import { ResolveFoundryStores } from "./FoundryEnv.ts";
import { ReadFlag } from "./ScriptArgs.ts";
import type { DataKind } from "../Foundry/DataKinds.ts";

const Apply = ReadFlag("--Apply");
const ProseKinds: DataKind[] = ["conversation", "knowledge", "books"];
const Stores = ResolveFoundryStores();

let TotalPromoted = 0;
let TotalKept = 0;
for (const Kind of ProseKinds) {
  const Store = Stores.Kind(Kind);
  let Rejected;
  try {
    Rejected = await Store.ByTier("Rejected");
  } catch {
    console.log(`[${Kind}] table missing/empty — skipped`);
    continue;
  }
  let Promoted = 0;
  let Kept = 0;
  for (const Doc of Rejected) {
    if (Doc.Origin !== "curated") {
      Kept++; // only curated prose is re-judged as text; leave anything else exactly as it is
      continue;
    }
    const Q = ScoreTextQuality(Doc.Content);
    if (Q.Passed) {
      Promoted++;
      if (Apply) await Store.Upsert({ ...Doc, Tier: "Filtered", RejectReason: null, QualityScore: Q.Score });
    } else {
      Kept++;
    }
  }
  console.log(`[${Kind}] Rejected=${Rejected.length} -> promote ${Promoted}, keep ${Kept}`);
  TotalPromoted += Promoted;
  TotalKept += Kept;
}
await Stores.Close();
console.log(`${Apply ? "APPLIED" : "DRY-RUN"}: promoted ${TotalPromoted}, kept ${TotalKept}.${Apply ? "" : " Re-run with --Apply to write."}`);
process.exit(0);
