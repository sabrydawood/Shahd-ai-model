# Shahd (شهد) — Roadmap: Toggleable Capabilities, Data Foundry, and Real Training

> Plan for the next phase (2026-07). Every capability is a switch that can be turned on/off and
> tuned; all collected data is stored in tiers that can be inspected, cleaned, and improved; and
> compute can drop from GPU to CPU at any time. Each milestone ships behind its own toggle and its
> own tests.

## 0. Baseline (honest)

- **Engine:** complete, from-scratch, gradcheck-verified (autograd, transformer, optimizers, BPE,
  KV-cache, safety, tools, reasoning). **96 tests green.**
- **Model capability is minimal today.** The shipped/demo models are **0.2M–1.1M parameters**,
  trained on a few KB of toy corpus for ~120–250 CPU steps. Capability scales with
  (parameters × data × compute); none of the three is large yet. For reference, GPT-2 small is 124M
  and a "useful" code model is ≈1B+. The engine is real; the fuel is not there yet.
- **The three levers and their blockers:**
  1. **Parameters** (target 10–100M): cheap to configure, expensive to train.
  2. **Data** (target permissive GB-scale): the Data Foundry (M3) builds acquisition + curation.
  3. **Compute** (need GPU): blocked on a Float32 path (M2), then a GPU kernel (M5).

## 1. Unifying principle — every capability is controllable

Extends the existing safety/tools gate philosophy to the whole system:

- **One central config** decides what is on, off, or throttled — deny-by-default for anything risky.
- **Every external surface is injected and swappable** (filesystem, network, GPU, database) and is
  absent by default.
- **All collected data is provenance-tracked and tiered** (raw → filtered → rejected) and inspectable.
- **Compute is runtime-switchable** GPU→CPU with automatic fallback, so a machine without a working
  GPU still runs.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Web data scope | **Permissive-first + general web in an ISOLATED tier** | Store everything for inspection; train ONLY on permissive/licensed content. General web stays raw/flagged, never trained until licensed. |
| GPU path | **Float32 compute seam first → WebGPU kernel later** | Float32 is the shared prerequisite (the engine is Float64 today, and WebGPU has no Float64 type). WebGPU is portable across GPU vendors and keeps the stack owned. |
| Database | **PostgreSQL + pgvector** (Docker + Drizzle) | Rich queries for quality/provenance plus native embeddings for semantic dedup/search. Kept behind a thin data-access layer so it is swappable; the model never depends on the database. |
| Inspection | **Visual dashboard** (Bun-served) over the database | See tiers, quality distributions, license/language breakdowns, and browse samples to clean and improve them. |

### Compute reality

The engine is **Float64**. Most GPU compute (and the WebGPU spec entirely) targets **Float32**, and
double precision is dramatically slower on typical hardware. Therefore any GPU use requires a
**Float32 path** first (mixed precision: Float32 for the hot matmuls, Float64 preserved for gradient
checking and precision-critical parts). The compute layer is hardware-agnostic and falls back to CPU
automatically, so the same code runs on a small experimentation GPU or a large training GPU with no
change.

## 3. Milestones (each behind a toggle, each tested)

### M0 — Docs + Roadmap ✅ (this milestone)
Add `README`, `LICENSE`, this roadmap, and architecture/conventions docs, so the project is
documented and evolvable.

### M1 — Smart Compact
`ChatSession.Compact` currently truncates. Make it **summarize**: an injected `Summarizer` extracts
the key points of the dropped turns (a deterministic extractive default; an optional model-backed
summarizer can be wired). Structural truncation remains only as the no-summarizer fallback.

### M2 — Toggleable Float32 compute seam (GPU prerequisite + real CPU speedup)
- Add a **Float32 compute path** (matmul + hot ops) alongside Float64; a mixed-precision bridge
  converts at the seam, and Float64 stays available for gradient checking.
- **`Config.Compute.Backend = Ts | GoFfi | Gpu`** with a **capability probe and automatic CPU
  fallback** (turn GPU off any time → CPU). Wire the active backend into `Ops/MatMul` so the existing
  Go 2–8× speedup actually accelerates training.
- Tests: backend parity within Float32 tolerance, toggle changes behavior, fallback works.

### M3 — Data Foundry (Postgres + pgvector)
- **Docker** Postgres + pgvector; **Drizzle** schema: `documents(tier, source, license, lang,
  quality, content, embedding, reject_reason, provenance, hashes…)`.
- **Tiered ingestion:** local directories (always) plus **web behind a toggle** — permissive sources
  are eligible for training; general web search is stored **isolated/flagged**, inspect-only.
  Everything is license-detected and provenance-stamped.
- **Curation:** the existing `CorpusBuilder` filters (license/quality/dedup/decontamination/FIM)
  write the tiers; **quality reports** per tier/language/license; embeddings power semantic
  near-dedup and "find similar".
- **Export:** training reads materialized **permissive** shards (clean model/database separation).

### M4 — Inspection Dashboard
A Bun-served web UI over the Foundry: tier counts, quality-score distributions, license/language
breakdowns, and a sample browser with reject reasons — to watch data quality and clean/improve it.

### M5 — GPU backend (WebGPU)
A Float32 WebGPU matmul kernel behind the M2 seam, with **CPU fallback** if WebGPU is unavailable or
toggled off. Portable to any GPU with no code change.

## 4. Sequencing

`M0 → M1` are quick and self-contained. `M2` is the linchpin: it speeds up CPU training now and is
the shared prerequisite for GPU. `M3–M4` build the data engine and its inspection surface (the real
fuel). `M5` proves the GPU path on real hardware. Each milestone is independently shippable and
reversible via its toggle.

## 5. Environment requirements

- **M3:** a running Postgres (Docker) and, for web ingestion, network access plus confirmed sources.
- **M5:** a GPU with a working WebGPU runtime. Large real training needs a strong GPU and a large
  permissive corpus; a small GPU is enough to validate the path end-to-end.
