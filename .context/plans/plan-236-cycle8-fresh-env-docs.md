# Plan 236 — Cycle 8 fresh: document missing env knobs in `.env.local.example`

**Source finding:** AGG8F-23 (2 agents: architect, document-specialist)
**Severity:** LOW
**Confidence:** High

## Problem

Five runtime env knobs are referenced in code but absent from `.env.local.example`:

- `AUDIT_LOG_RETENTION_DAYS` (default 90, `lib/audit.ts:52`)
- `IMAGE_MAX_INPUT_PIXELS` (default 256M, `lib/process-image.ts:26-29`)
- `IMAGE_MAX_INPUT_PIXELS_TOPIC` (default 64M, `lib/process-image.ts:34-39`)
- `SHARP_CONCURRENCY` (default = available cores - 1, `lib/process-image.ts:20`)
- `QUEUE_CONCURRENCY` (default 2, `lib/image-queue.ts:120`)

Without examples, operators do not discover these knobs. CLAUDE.md mentions some but not all.

## Fix shape

Add a commented section to `.env.local.example` listing each knob with default and one-line description. Mention in CLAUDE.md that the example file is canonical.

## Implementation steps

1. Read `apps/web/.env.local.example` and confirm absence of each knob.
2. Append a new section to the example file:
   ```env
   # ── Optional tuning knobs (defaults shown) ──────────────────────────
   # Concurrency for libvips/Sharp worker threads. Default: cores - 1.
   # SHARP_CONCURRENCY=
   # Concurrency for the image-processing PQueue. Default: 2.
   # QUEUE_CONCURRENCY=2
   # Max input pixels for full-image processing (decompression-bomb cap). Default: 268435456 (256M).
   # IMAGE_MAX_INPUT_PIXELS=
   # Max input pixels for topic-image processing (smaller, default: 67108864 = 64M).
   # IMAGE_MAX_INPUT_PIXELS_TOPIC=
   # Audit log retention in days. Default: 90.
   # AUDIT_LOG_RETENTION_DAYS=90
   ```
3. (Optional) Update CLAUDE.md "Environment Variables" section to point to the example file as canonical.

## Done criteria

- All gates pass (the file is not parsed at build time but `lint` should not flag).
- `git diff` cleanly adds the section and updates CLAUDE.md.
- Operators reading the example file see the new knobs with sane defaults.

## Risk assessment

- Pure documentation; no runtime change.
