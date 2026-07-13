// Shared CLI-arg helper for the entry scripts (single-source, rule #4).

export function ReadArg(Prefix: string, Fallback: string): string {
  const Found = process.argv.slice(2).find((A) => A.startsWith(Prefix));
  return Found ? Found.slice(Prefix.length) : Fallback;
}
