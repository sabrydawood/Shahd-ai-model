// General local-folder provider (data engine, Phase 2) — ingest EVERY text file under one or more
// folders on disk, of ANY type, not just code. This is the on-disk counterpart to the web sources: the
// user downloads a corpus (e.g. all of Project Gutenberg, since gutenberg.org is unreachable from the
// collector) and points the Learn run at the folder. Unlike CreateLocalRepoProvider — which is
// code-only (CodeFileFilter + repo-level quality gate) — this keeps every readable UTF-8 file, so books,
// articles, transcripts, and mixed corpora all land. Binary files are skipped (a NUL byte is the tell);
// oversized files are capped. The target KIND (books/knowledge/…) and LICENSE are chosen by the caller,
// since a folder's contents are known to the user. Origin is "owned" — the user's local copy, trained
// on regardless of license (same trust model as our own repos).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import type { WebProvider, RepoSink } from "./WebSource.ts";
import type { SourceInput } from "./Ingest.ts";

export type LocalFolderOptions = {
  Roots: string[]; // folders to ingest recursively
  License?: string; // recorded on every doc (default "public-domain" — the Gutenberg case)
  Lang?: string; // doc language tag (default "text")
  MaxFilesPerRoot?: number;
  MaxBytesPerRoot?: number; // total byte budget per root
  MaxContentBytes?: number; // per-file cap (a huge file is skipped, not truncated mid-word)
  MinChars?: number; // skip near-empty files
  StripBookBoilerplate?: boolean; // strip Project Gutenberg header/footer (default true)
  BatchSize?: number;
  SkipRoot?: (Name: string) => boolean;
  OnRepoStart?: (Name: string) => void;
  OnRepoReady?: RepoSink;
  Log?: (Message: string) => void;
};

// Project Gutenberg wraps each book in "*** START OF THE PROJECT GUTENBERG EBOOK … ***" and a matching
// "*** END OF …" plus a long legal license after it. Keep only the body between them so we train on the
// actual text, not the boilerplate. If the markers are absent (not a Gutenberg file) the text is
// returned unchanged. Public-domain works stay public domain; only the wrapper is removed.
export function StripBookBoilerplate(Text: string): string {
  const Start = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/i;
  const End = /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i;
  let Body = Text;
  const S = Body.match(Start);
  if (S && S.index !== undefined) Body = Body.slice(S.index + S[0].length);
  const E = Body.match(End);
  if (E && E.index !== undefined) Body = Body.slice(0, E.index);
  return Body.trim();
}

// Read one file as UTF-8 text, or null if it is binary (contains a NUL byte) / too big / unreadable.
function ReadTextFile(Full: string, MaxContentBytes: number): string | null {
  try {
    if (statSync(Full).size > MaxContentBytes) return null; // skip oversized without reading it all
    const Buf = readFileSync(Full);
    if (Buf.includes(0)) return null; // NUL byte => binary, not text
    return Buf.toString("utf8");
  } catch {
    return null;
  }
}

function WalkFolder(Root: string, MaxFiles: number, MaxBytes: number, MaxContentBytes: number): { Path: string; Content: string }[] {
  const Out: { Path: string; Content: string }[] = [];
  let Bytes = 0;
  const Walk = (Dir: string): void => {
    if (Out.length >= MaxFiles || Bytes >= MaxBytes) return;
    let Entries: import("node:fs").Dirent[];
    try {
      Entries = readdirSync(Dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const Entry of Entries) {
      if (Out.length >= MaxFiles || Bytes >= MaxBytes) return;
      const Full = join(Dir, Entry.name);
      if (Entry.isDirectory()) {
        if (Entry.name === "node_modules" || Entry.name.startsWith(".")) continue; // skip vendored / dot-dirs
        Walk(Full);
      } else if (Entry.isFile()) {
        const Content = ReadTextFile(Full, MaxContentBytes);
        if (Content === null) continue; // binary / oversized / unreadable
        Out.push({ Path: relative(Root, Full).split("\\").join("/"), Content });
        Bytes += Content.length;
      }
    }
  };
  Walk(Root);
  return Out;
}

export function CreateLocalFolderProvider(Options: LocalFolderOptions): WebProvider {
  const License = Options.License ?? "public-domain";
  const Lang = Options.Lang ?? "text";
  const MaxFiles = Options.MaxFilesPerRoot ?? 1_000_000;
  const MaxBytes = Options.MaxBytesPerRoot ?? 50_000_000_000; // effectively "all of it" by default
  const MaxContentBytes = Options.MaxContentBytes ?? 20_000_000; // 20 MB/file cap (a whole book fits easily)
  const MinChars = Options.MinChars ?? 100;
  const Strip = Options.StripBookBoilerplate ?? true;
  const BatchSize = Options.BatchSize ?? 200;
  const Log = Options.Log ?? ((Message: string): void => console.log(Message));

  return {
    Name: "local-folder",
    Semantics: "bounded", // a fixed set of on-disk files — a full collect exhausts it
    Fetch: async (): Promise<SourceInput[]> => {
      const Out: SourceInput[] = [];
      for (const Root of Options.Roots) {
        const Name = basename(Root) || Root;
        if (Options.SkipRoot?.(Name) === true) continue;
        Options.OnRepoStart?.(Name); // signal work before walking (large folders take a moment)
        Log(`[folder] walking ${Root}…`);
        const Files = WalkFolder(Root, MaxFiles, MaxBytes, MaxContentBytes);
        Log(`[folder] ${Name}: ${Files.length} text file(s)`);
        const Inputs: SourceInput[] = [];
        for (const File of Files) {
          const Content = (Strip ? StripBookBoilerplate(File.Content) : File.Content).trim();
          if (Content.length < MinChars) continue; // skip near-empty
          Inputs.push({ Source: Name, License, Lang, Content, Provenance: `${Root}/${File.Path}`, Origin: "owned" });
        }
        if (Options.OnRepoReady !== undefined) {
          for (let Start = 0; Start < Inputs.length; Start += BatchSize) {
            Options.OnRepoStart?.(`${Name} batch ${Math.floor(Start / BatchSize) + 1}`); // Stop between batches
            await Options.OnRepoReady(Name, Inputs.slice(Start, Start + BatchSize));
          }
        } else {
          Out.push(...Inputs);
        }
        Log(`[folder] ${Name}: ${Inputs.length} docs ingested`);
      }
      return Out;
    },
  };
}
