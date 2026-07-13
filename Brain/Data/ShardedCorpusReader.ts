// Streaming corpus reader for scale: reads shard files ONE AT A TIME (the whole corpus is never
// all resident as text at once). The Phase-1 InMemoryDataLoader still needs the encoded token
// array in memory, so EncodeAll accumulates ids — but it reads shard text lazily. True
// never-resident streaming training is a Phase-3 concern.

import { readFileSync, existsSync } from "node:fs";
import type { Tokenizer } from "../Tokenizer/TokenizerTypes.ts";

export class ShardedCorpusReader {
  private Paths: string[];

  constructor(Paths: string[]) {
    this.Paths = Paths.filter((P) => existsSync(P));
  }

  /** Yield each shard's text, one shard resident at a time. */
  *Shards(): Generator<string> {
    for (const Path of this.Paths) yield readFileSync(Path, "utf8");
  }

  /** Encode every shard into one token array (reads shards lazily; ids accumulate in memory). */
  EncodeAll(Tokenizer: Tokenizer): number[] {
    const Out: number[] = [];
    for (const Text of this.Shards()) {
      for (const Id of Tokenizer.Encode(Text)) Out.push(Id);
    }
    return Out;
  }
}
