# Conventions

These rules are enforced by the continuous-integration gate (`bun run ci`). They exist to keep the
codebase readable, consistent, and free of hidden duplication as it grows.

## The five hard rules

1. **PascalCase for everything we declare** — functions, variables, parameters, types, enum members,
   files. Only externally-shaped names are exempt (imports; object-literal/type keys that mirror JSON,
   Web APIs, or config). Enforced by `check:naming` and an ESLint `naming-convention` rule.
2. **Excellent module architecture** — small, single-purpose modules with an acyclic import graph and
   explicit named barrels. No `index.ts`. No grab-bag files (`Utils`, `Helpers`, `Common`, `Misc`).
3. **No file exceeds 600 lines** — enforced by `check:length`. Split by responsibility before you hit
   the cap.
4. **DRY-strict** — zero duplicated functions or constants. Search for an existing implementation
   before writing a new one; extend it instead of copying. Shared helpers have exactly one home.
5. **Centralized, detailed constants** — every default lives once in `Config/Constants.ts`, heavily
   commented. Configuration is validated by Zod in a single schema; the schema carries no defaults, so
   nothing is defaulted in two places.

## Modules and naming

- Files are PascalCase and named for their responsibility (`MultiHeadAttention.ts`, `CorpusBuilder.ts`).
- Each subsystem exposes an explicit barrel (`OpsBarrel.ts`, `ToolsBarrel.ts`) listing its public
  surface.
- Tests are colocated in `Tests/` as `Name.Test.ts`.

## Configuration

- `Constants.ts` holds defaults; `ValidateConfig.ts` holds the Zod schema and cross-field invariants;
  `ConfigTypes.ts` infers types from the schema so types and validation never drift.
- Config is merged (defaults → JSON preset → programmatic → CLI), validated, derived, hashed, and
  deep-frozen. The resolved config is immutable and self-describing.
- New knobs are added to the schema and to `Constants.ts` together, never one without the other.

## Safety and capabilities

- Safety and performance are first-class and live in dedicated, controllable places
  (`Brain/Safety/`, and the `Safety`, `Limits`, `Tools`, and future `Compute` config sections).
- Anything that can touch the filesystem, run code, reach the network, or use a GPU is behind a config
  gate and is off or read-only by default. Dangerous surfaces are injected and swappable, and absent
  by default.

## Definition of done

A change is done only when `bun run ci` passes: type-checking, the length and naming checks, linting,
gradient checking, and the full test suite. New behavior ships with tests. Numeric changes ship with a
gradient check or a parity check against the reference path.
