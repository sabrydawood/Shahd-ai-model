// Tier classification (M3) — the one place a document's fate is decided, reusing the existing Data
// filters (rule #4: no reimplementation). Rules, in order:
//   general web  -> Raw (isolated, inspect-only) regardless of license (license is unverified).
//   non-permissive -> Rejected (with the license as the reason).
//   low quality  -> Rejected (with the quality reasons).
//   otherwise    -> Filtered (permissive + clean, eligible for training).

import { IsPermissive } from "../Brain/Data/LicenseManifest.ts";
import { ScoreCodeQuality, ScoreTextQuality } from "../Brain/Data/QualityFilter.ts";
import type { Tier, Origin } from "./DocumentRecord.ts";

export type TierDecision = { Tier: Tier; QualityScore: number; RejectReason: string | null };

export function ClassifyDocument(License: string, Content: string, Origin: Origin): TierDecision {
  // curated sources (OASST / Wikipedia / books) are natural-language PROSE — score them as text so the
  // code-minification line-length heuristics don't wrongly reject detailed (long-line) dialogue/articles.
  const Quality = Origin === "curated" ? ScoreTextQuality(Content) : ScoreCodeQuality(Content);
  if (Origin === "web-general") {
    return { Tier: "Raw", QualityScore: Quality.Score, RejectReason: "general web: isolated for inspection, not training-eligible" };
  }
  if (Origin === "owned" || Origin === "curated") {
    // Our own code (owned) or a whole dataset we explicitly vetted + approved (curated: OASST /
    // Wikipedia / public-domain books). The source-level license is already accepted, so it is not
    // re-checked per document (License is still recorded on the record for provenance) — only quality.
    if (!Quality.Passed) return { Tier: "Rejected", QualityScore: Quality.Score, RejectReason: `low quality: ${Quality.Reasons.join("; ")}` };
    return { Tier: "Filtered", QualityScore: Quality.Score, RejectReason: null };
  }
  if (!IsPermissive(License)) {
    return { Tier: "Rejected", QualityScore: Quality.Score, RejectReason: `non-permissive license: ${License}` };
  }
  if (!Quality.Passed) {
    return { Tier: "Rejected", QualityScore: Quality.Score, RejectReason: `low quality: ${Quality.Reasons.join("; ")}` };
  }
  return { Tier: "Filtered", QualityScore: Quality.Score, RejectReason: null };
}
