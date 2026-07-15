// Wikipedia article provider (Phase 8) — broad general-knowledge text, strong in Arabic and English.
// Pulls random articles' plain-text extracts via the MediaWiki API (reliable JSON, no scraping) and
// stores them as curated documents. License is CC-BY-SA (share-alike) — NOT on the permissive code
// allowlist; it is included as an explicitly Sabry-approved general-text source (Origin "curated"),
// with the license recorded on every document for provenance. The JSON fetch is injected (mock in
// tests; real MediaWiki API by default). Random-article dups across requests are deduped downstream
// by content hash.
//
// Wikipedia is a STREAMING source: random articles are effectively unlimited, so each run collects a
// capped chunk (MaxPerRun) of FRESH articles — run again to grow. The MediaWiki API rate-limits (HTTP
// 429); every request goes through FetchWithBackoff (honors Retry-After) and a run-wide CircuitBreaker
// stops cleanly after too many consecutive failures instead of hammering the API — the old naive loop
// derived its request ceiling from the raw limit (2,000,000 -> 200,010 requests) and never waited.

import type { WebProvider, RepoSink } from "./WebSource.ts";
import type { SourceInput } from "./Ingest.ts";
import { FetchWithBackoff, CircuitBreaker, HttpError, RetryAfterToMs } from "./HttpBackoff.ts";

export type WikipediaOptions = {
  FetchJson?: (Url: string) => Promise<unknown>; // injected in tests; real MediaWiki API by default
  BatchSize?: number;
  MinChars?: number; // skip stubs / near-empty extracts
  MaxPerRun?: number; // cap on articles collected in ONE run (streaming source; re-run for more)
  MaxConsecutiveFailures?: number; // circuit-break: stop after this many requests fail in a row
  Sleep?: (Ms: number) => Promise<void>; // injected in tests so backoff never really waits
  OnRepoStart?: (Name: string) => void; // working signal + Stop boundary (throws on abort)
  OnRepoReady?: RepoSink;
  Log?: (Message: string) => void;
};

type WikiPage = { title?: string; extract?: string; pageid?: number };
type WikiResponse = { query?: { pages?: Record<string, WikiPage> } };

async function DefaultFetchJson(Url: string): Promise<unknown> {
  const Response = await fetch(Url, { headers: { "User-Agent": "shahd-foundry/1.0 (educational LM research)" } });
  // Throw a typed HttpError carrying the server's Retry-After hint so backoff can honor it (429/503).
  if (!Response.ok) throw new HttpError(Response.status, RetryAfterToMs(Response.headers.get("retry-after")));
  return Response.json();
}

export function CreateWikipediaProvider(Options: WikipediaOptions = {}): WebProvider {
  const FetchJson = Options.FetchJson ?? DefaultFetchJson;
  const BatchSize = Options.BatchSize ?? 100;
  const MinChars = Options.MinChars ?? 200;
  const MaxPerRun = Options.MaxPerRun ?? 5000;
  const MaxConsecutiveFailures = Options.MaxConsecutiveFailures ?? 5;
  const Log = Options.Log ?? ((Message: string): void => console.log(Message));

  return {
    Name: "wikipedia",
    Semantics: "streaming",
    Fetch: async (Query: string, Limit: number): Promise<SourceInput[]> => {
      const Lang = (Query || "en").trim().toLowerCase();
      // Validate the language code STRICTLY (a real one is just letters, optionally hyphenated, e.g.
      // "en", "pt-br"). Without this, a value like "127.0.0.1:6379/x" makes the request host become
      // attacker-controlled — a server-side request forgery (SSRF) — since a URL's authority ends at
      // the first "/". An allow-list of the expected shape closes it without touching legitimate use.
      if (!/^[a-z]{2,10}(-[a-z]{2,10})?$/.test(Lang)) {
        throw new Error(`Wikipedia: invalid language code "${Lang}" (expected e.g. "en", "ar", "pt-br")`);
      }
      // Streaming source: collect at most MaxPerRun this run (the raw Limit can be huge — 2,000,000 —
      // which must NOT become the request ceiling). Re-run to keep growing the corpus.
      const Want = Math.min(Math.max(1, Limit), MaxPerRun);
      const Api = `https://${Lang}.wikipedia.org/w/api.php?action=query&generator=random&grnnamespace=0&grnlimit=10&prop=extracts&explaintext=1&exlimit=max&format=json&origin=*`;
      const Docs: SourceInput[] = [];
      let Batch: SourceInput[] = [];
      const Flush = async (): Promise<void> => {
        if (Batch.length > 0 && Options.OnRepoReady !== undefined) {
          Options.OnRepoStart?.(`Wikipedia batch (${Docs.length}/${Want})`); // Stop between batches
          await Options.OnRepoReady(`wikipedia-${Lang}`, Batch);
          Batch = [];
        }
      };

      // The random generator returns ~10 articles/request (and can repeat), so request until Want —
      // with a safety cap so an all-stub/all-dup run can't loop forever.
      const MaxRequests = Math.ceil(Want / 10) + 10;
      const Breaker = new CircuitBreaker(MaxConsecutiveFailures);
      for (let Request = 0; Request < MaxRequests && Docs.length < Want; Request++) {
        Options.OnRepoStart?.(`Wikipedia ${Lang} (${Docs.length}/${Want})`);
        let Json: WikiResponse;
        try {
          // Retry transient failures (429/5xx/network) with backoff that honors Retry-After; a real
          // 4xx (bad lang) is not retried. On success reset the breaker.
          Json = (await FetchWithBackoff(
            () => FetchJson(Api) as Promise<WikiResponse>,
            { Sleep: Options.Sleep, OnRetry: (Attempt, Delay, Reason) => Log(`[wiki] retry ${Attempt} in ${Delay}ms (${Reason})`) },
          )) as WikiResponse;
          Breaker.Success();
        } catch (Caught) {
          Log(`[wiki] fetch error: ${(Caught as Error).message}`);
          // Trip the breaker after too many consecutive failures so we stop instead of spinning.
          if (Breaker.Fail()) {
            Log(`[wiki] stopping: ${MaxConsecutiveFailures} consecutive request failures (endpoint down or rate-limited)`);
            break;
          }
          continue;
        }
        const Pages = Json.query?.pages ?? {};
        for (const Key of Object.keys(Pages)) {
          if (Docs.length >= Want) break;
          const Page = Pages[Key]!;
          const Extract = typeof Page.extract === "string" ? Page.extract.trim() : "";
          if (Extract.length < MinChars) continue; // skip stubs
          const Doc: SourceInput = {
            Source: `wikipedia-${Lang}`,
            License: "CC-BY-SA-4.0",
            Lang: `text-${Lang}`,
            Content: `${Page.title ?? ""}\n\n${Extract}`.trim(),
            Provenance: `wikipedia:${Lang}:${Page.pageid ?? Key}`,
            Origin: "curated",
          };
          Docs.push(Doc);
          Batch.push(Doc);
          if (Batch.length >= BatchSize) await Flush();
        }
      }
      await Flush();
      Log(`[wiki] ${Docs.length} ${Lang} articles collected`);
      return Options.OnRepoReady !== undefined ? [] : Docs;
    },
  };
}
