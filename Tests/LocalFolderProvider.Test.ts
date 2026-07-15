import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CreateLocalFolderProvider, StripBookBoilerplate } from "../Foundry/LocalFolderProvider.ts";
import type { SourceInput } from "../Foundry/FoundryBarrel.ts";

test("StripBookBoilerplate keeps only the body between the Gutenberg markers", () => {
  const Raw = [
    "The Project Gutenberg eBook of Frankenstein",
    "*** START OF THE PROJECT GUTENBERG EBOOK FRANKENSTEIN ***",
    "It was on a dreary night of November that I beheld the accomplishment of my toils.",
    "*** END OF THE PROJECT GUTENBERG EBOOK FRANKENSTEIN ***",
    "This eBook is for the use of anyone anywhere ... the full license follows.",
  ].join("\n");
  const Body = StripBookBoilerplate(Raw);
  expect(Body).toBe("It was on a dreary night of November that I beheld the accomplishment of my toils.");
  // A non-Gutenberg text is returned unchanged (just trimmed).
  expect(StripBookBoilerplate("  just some text  ")).toBe("just some text");
});

test("local folder provider ingests every text file, skips binary/empty, strips book boilerplate", async () => {
  const Dir = mkdtempSync(join(tmpdir(), "shahd-folder-"));
  try {
    mkdirSync(join(Dir, "sub"));
    writeFileSync(
      join(Dir, "book.txt"),
      "*** START OF THE PROJECT GUTENBERG EBOOK X ***\n" + "A genuine paragraph of book text long enough to pass the minimum. ".repeat(4) + "\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\nlicense boilerplate",
    );
    writeFileSync(join(Dir, "sub", "notes.md"), "Some markdown notes that are comfortably longer than the minimum character threshold this provider enforces before it will ingest a file into the corpus.");
    writeFileSync(join(Dir, "tiny.txt"), "hi"); // below MinChars -> skipped
    writeFileSync(join(Dir, "image.bin"), Buffer.from([0x41, 0x00, 0x42, 0x00])); // NUL byte -> binary -> skipped
    mkdirSync(join(Dir, ".hidden"));
    writeFileSync(join(Dir, ".hidden", "secret.txt"), "this dot-dir must be skipped entirely by the walker no matter how long.");

    const Batches: SourceInput[] = [];
    const Provider = CreateLocalFolderProvider({ Roots: [Dir], License: "public-domain", Lang: "text", OnRepoReady: async (_S, Docs) => { Batches.push(...Docs); } });
    expect(Provider.Semantics).toBe("bounded");
    await Provider.Fetch("", 0);

    const Provs = Batches.map((B) => B.Provenance).sort();
    expect(Batches.length).toBe(2); // book.txt + sub/notes.md ; tiny + binary + dot-dir all skipped
    expect(Provs.some((P) => P.endsWith("book.txt"))).toBe(true);
    expect(Provs.some((P) => P.endsWith("sub/notes.md"))).toBe(true);
    const Book = Batches.find((B) => B.Provenance.endsWith("book.txt"))!;
    expect(Book.Content).not.toContain("START OF THE PROJECT GUTENBERG"); // boilerplate stripped
    expect(Book.Content).not.toContain("license boilerplate");
    expect(Book).toMatchObject({ License: "public-domain", Lang: "text", Origin: "owned" });
  } finally {
    rmSync(Dir, { recursive: true, force: true });
  }
});
