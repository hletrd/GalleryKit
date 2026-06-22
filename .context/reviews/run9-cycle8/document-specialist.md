# Document-Specialist — Run-9 Cycle-8 (docs vs code)

**Repo:** GalleryKit · **HEAD:** `4e132b03` · READ-ONLY doc-vs-code verification.

## High-entropy claim checks (all MATCH unless noted)

| Claim (CLAUDE.md) | Actual (file:line) | Verdict |
|---|---|---|
| IMAGE_PIPELINE_VERSION = 7 | gallery-config-shared.ts:21 | MATCH |
| COLOR_IMPACTING_KEYS = 9 | settings-hash.ts:42-54 (array of 9) | MATCH (citation ":41-53" is 1 line off — editorial tolerance) |
| HASH_LENGTH = 8 | settings-hash.ts | MATCH |
| React cache() wraps 10 (9 *Cached + getSeoSettings) | data.ts (named list verified) | MATCH |
| VIEW_RETENTION_DAYS = 395 | view-retention.ts | MATCH |
| 6 advisory lock names | advisory-locks.ts:19-44 | MATCH |
| NCLX maps (matrix 8=YCgCo, transfer 5=gamma28, etc.) | color-detection.ts:170-220 | MATCH |
| nginx caps 2M/64K/250M/216M/216M | nginx/default.conf | MATCH |
| admin tunable defaults (avif_effort=6, 90/85/90, 50M, etc.) | gallery-config-shared.ts | MATCH |
| upload limits 200MB/file, 2GiB batch, 100 files | config | MATCH |
| schema 18 tables / 50 images columns | schema.ts ↔ migrate.js | MATCH |
| connection pool 10 / queue 20 | db/index.ts | MATCH |
| 20/20 key-file table paths exist | filesystem | MATCH |

## Adjudications requested by lead

### "19 privacy fields" claim — PHANTOM (NOT a defect)
Exhaustive grep of CLAUDE.md for any "19" adjacent to "privacy / field / sensitive / admin-only / omit" returns **zero matches**. The only "19" tokens are "React 19", "process-image.ts:1019-1097", Unicode code-point ranges (U+202A-202E etc.), and "run-9" refs. CLAUDE.md makes NO numeric claim about privacy-field count. The actual SENSITIVE_KEYS / _PrivacySensitiveKeys count is **20**, correctly guarded — but since the doc never states a count, there is no false claim. The architect agent fabricated this; the critic was correct. **PHANTOM — not a finding.**

### "process-image.ts:1019-1097" line citation (CLAUDE.md:219) — IMPRECISE BUT NOT FALSE (POLISH)
The claim's substance ("fresh decode per output / fresh sharp() instance per format to eliminate cross-format contamination") is TRUE. The cited 1019-1097 span genuinely contains the relevant code: the fresh-decode setup at :1019 (`inputMeta`/`basePixels`), the R8-R8 "shared image variable removed — every format now gets a fresh sharp() instance" comment within the range (~:1050), through to the link/copyFile fallback at the range's end. The span is wider than ideal (an 80-line range for a concept anchored at one comment), but the cited region DOES contain what is claimed — line 1050 (the fresh-instance comment) falls within 1019-1097. This is navigability imprecision, not a factually false claim. A tighter citation (e.g. :1048-1052 or :1093-1097) would be more useful. **POLISH, not a false-doc-claim DEFECT.**

## DISPOSITION: 0 false-doc-claim DEFECTS, 1 POLISH (the 1019-1097 line-citation imprecision).
- (a) "19 privacy fields": PHANTOM — no such claim exists in CLAUDE.md; actual code count is 20; doc states no count. Not a defect.
- (b) "1019-1097" line citation: POLISH — imprecise-but-not-false; the cited range contains the documented behavior (fresh-instance comment at :1050 falls within the span). Not a DEFECT.
