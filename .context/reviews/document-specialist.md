# Document-Specialist Review — Cycle 15 (R15C15)

**Agent:** document-specialist (sonnet) · **HEAD:** 2f886351 · **Verdict:** Four stale line-citations + one wrong exact byte value in CLAUDE.md; all architectural invariants, counts, names, and defaults verified correct.

## FINDING 1 — Wrong byte value for `NEXT_UPLOAD_BODY_MAX_BYTES` default — LOW, High conf
CLAUDE.md "Optional Operational Variables" table claims default `279620608`. Actual (`upload-limits.ts:1-6`): `max(200 MiB, 250 MiB) + 16 MiB = 266 MiB = 278921216` bytes — derived dynamically, not the stale literal. The "~266 MiB" descriptor in the same cell is correct.
**Fix:** replace `279620608` with `278921216` (keep "~266 MiB").

## FINDING 2 — Stale line cite for fresh-decode-per-format comment — LOW, High conf
CLAUDE.md `process-image.ts` row cites `process-image.ts:1131-1135` for the WI-14 fresh-decode-per-format note. Actual location is **line 1157**; lines 1131-1145 are the C4F-11 hard-link dedup block (unrelated). Cycle 13/14 growth shifted it down.
**Fix:** `process-image.ts:1131-1135` → `process-image.ts:1157`.

## FINDING 3 — Off-by-one cite for ProPhoto → gamma18 path — LOW, High conf
CLAUDE.md cites `lib/color-detection.ts:99-107` for the ProPhoto gamma18 path. The ProPhoto-specific return is at **line 108** (one line outside the range); line 100 returns gamma18 only for generic `'gamma 1.8'` strings.
**Fix:** `lib/color-detection.ts:99-107` → `:99-108` (or `line 108`).

## FINDING 4 — settings-hash.ts cite off by one at both ends — LOW, cosmetic
CLAUDE.md cites `settings-hash.ts:41-53` for `COLOR_IMPACTING_KEYS`. Actual array spans **lines 42-54** (declaration at 42, `] as const;` at 54). Count (9) and all key names correct.
**Fix:** `settings-hash.ts:41-53` → `:42-54`.

## All other checkable claims VERIFIED correct
`IMAGE_PIPELINE_VERSION=7`; 9 COLOR_IMPACTING_KEYS + names; 10 `cache()` fns (9 `*Cached` + `getSeoSettings`); NCLX primaries/transfer/matrix maps; 7 COLOR_PIPELINE_DECISIONS; 6 advisory-lock names; nginx body caps (2M/64K/250M/216M/216M/2M); Argon2id params (65536/3/4); backfill cap formula (=2); `POOL_CONNECTION_LIMIT=10`; `HEAD_REVALIDATE_TIMEOUT_MS=300`; `OG_PHOTO_MAX_BYTES=1MiB`; blur@16px; `MAX_BLUR_DATA_URL_LENGTH=4096`; `SEMANTIC_SCAN_LIMIT=2000`/`SEMANTIC_TOP_K_MAX=50`/default 20; `IMAGE_MAX_INPUT_PIXELS` defaults; upload limits; retention defaults; `TRUSTED_PROXY_HOPS=1`; backfill concurrency defaults; quality/chroma/effort defaults; `x-gk-admin-render:1`; Node `>=24`; Next `^16.2.9`, React `^19.2.5`, TS `^6`, Sharp `^0.34.5`; WIDE_GAMUT_PRIMARIES set.

**AGENTS.md vs CLAUDE.md:** no contradictions.

**Net:** 4 navigational line-cite drifts + 1 wrong byte literal, all LOW. On-disk doc is otherwise well-maintained.
