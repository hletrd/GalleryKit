# Aggregate — Cycle 1 Fresh Review (2026-04-27)

## Run Context

- **HEAD:** `f68d50c docs(reviews): record cycle-5 RPF-loop convergence (zero new findings)`
- **Cycle:** 1/100 (fresh cycle, not a continuation of previous RPF loop)
- **Scope:** Full codebase deep review across 11 specialist angles

## Deduplicated Findings

Findings deduplicated across all reviewers, preserving highest severity/confidence. Cross-agent agreement noted.

### HIGH Severity (0)

None.

### MEDIUM Severity (4)

| ID | Finding | File | Agents | Confidence |
|---|---|---|---|---|
| C1-F01 | `width`/`height` fallback to 2048 stores misleading dimensions | `lib/process-image.ts:276-277` | CR, TE | Medium |
| C1-F02 | CSP `style-src` includes `'unsafe-inline'` in production | `lib/content-security-policy.ts:64` | SR | High |
| C1-F03 | Rate-limit logic duplicated across 5+ modules | `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `app/actions/public.ts` | AR | High |
| C1-F04 | `getClientIp` returns "unknown" when `TRUST_PROXY` not set — all users share one rate-limit bucket | `lib/rate-limit.ts:105-111` | SR | High |

### LOW Severity (15)

| ID | Finding | File | Agents | Confidence |
|---|---|---|---|---|
| C1-F05 | Indentation inconsistency in `uploadImages` try/finally | `app/actions/images.ts:178-431` | CR | High |
| C1-F06 | `deleteImageVariants` called with `[]` — intent ambiguous | `lib/process-image.ts:186`, `app/actions/images.ts:503` | CR | High |
| C1-F07 | `original_format`/`original_file_size` in `adminSelectFields` inflate listing queries | `lib/data.ts:466-488` | CR | Medium |
| C1-F08 | `buildContentSecurityPolicy` includes GA domains unconditionally | `lib/content-security-policy.ts:58-59` | CR | High |
| C1-F09 | Backup download reveals symlink existence via 403 vs 404 | `app/api/admin/db/download/route.ts:60-66` | SR | Medium |
| C1-F10 | `processImageFormats` atomic rename fallback 3 loses atomicity | `lib/process-image.ts:437-452` | CT, DB | Medium |
| C1-F11 | `pruneRetryMaps` eviction is FIFO, not LRU | `lib/image-queue.ts:74-85` | CT | Medium |
| C1-F12 | `getImagesLite` limit cap is 101 vs 100 in other functions | `lib/data.ts:376-377` | VR | High |
| C1-F13 | Session `expiresAt` comparison timezone assumption | `lib/session.ts:139` | CR | Low |
| C1-F14 | `publicSelectFields` vs `adminSelectFields` pattern requires 3-step update | `lib/data.ts:115-201` | AR | High |
| C1-F15 | `actions/images.ts` is a god module (432 lines) | `app/actions/images.ts` | AR | Medium |
| C1-F16 | No structured error types for server action results | `app/actions/*.ts` | AR | Medium |
| C1-F17 | Photo viewer sidebar transition uses `transition-all` (janky on slow devices) | `components/photo-viewer.tsx:416-417` | DSN | Medium |
| C1-F18 | `searchImages` runs up to 3 sequential DB queries | `lib/data.ts:793-880` | PR | High |
| C1-F19 | `getImage()` prev/next queries are complex and potentially slow | `lib/data.ts:514-583` | TR | Medium |

### INFO (3)

| ID | Finding | File | Agents | Confidence |
|---|---|---|---|---|
| C1-F20 | CLAUDE.md schema section omits `adminSettings`, `auditLog`, `rateLimitBuckets` | `CLAUDE.md` | DS | High |
| C1-F21 | CLAUDE.md deployment step 3 references `site-config.example.json` — existence needs verification | `CLAUDE.md` | DS | Medium |
| C1-F22 | Uncommitted `en.json`/`ko.json` changes are cosmetic text simplifications | `apps/web/messages/*.json` | CT | High |

### Test Gaps (4)

| ID | Finding | File | Agents | Confidence |
|---|---|---|---|---|
| C1-TG01 | No test for `width`/`height` fallback behavior | `lib/process-image.ts:276-277` | TE | High |
| C1-TG02 | No test for `processImageFormats` atomic rename fallback chain | `lib/process-image.ts:437-452` | TE | Medium |
| C1-TG03 | No test for `flushGroupViewCounts` backoff during DB outages | `lib/data.ts:16-96` | TE | Medium |
| C1-TG04 | No test for `searchImages` three-query sequential path | `lib/data.ts:774-880` | TE | Medium |

## Cross-Agent Agreement

No finding was flagged by more than 2 agents. The codebase is well-maintained with few overlapping concerns. The most-widely-noted pattern was the rate-limit duplication (C1-F03, noted by architect and implicitly by security reviewer via the in-memory-only concern for load-more).

## Verified Controls (No Issues Found)

1. Argon2id + timing-safe comparison for auth
2. Path traversal prevention (SAFE_SEGMENT + realpath containment)
3. Privacy guard (compile-time + separate field sets)
4. Blur data URL contract (3-point validation)
5. Rate limit TOCTOU fix (pre-increment pattern)
6. Advisory locks for concurrent operations
7. Unicode bidi/formatting rejection
8. CSV formula injection prevention
9. Touch-target audit fixture
10. Reduced-motion support

## Agent Failures

None. All 11 reviewer perspectives completed successfully.

## Summary

The GalleryKit codebase is well-engineered with strong security controls, comprehensive test coverage for critical paths, and thoughtful architectural decisions. The fresh review found 4 medium-severity issues and 15 low-severity issues, none of which represent immediate security vulnerabilities or data-loss risks. The most actionable medium-severity findings are:

1. **C1-F01** (misleading dimension fallback) — could cause visual artifacts
2. **C1-F02** (CSP unsafe-inline) — accepted trade-off with Tailwind/Radix
3. **C1-F03** (rate-limit duplication) — maintenance risk, not a bug
4. **C1-F04** (shared "unknown" IP bucket) — operational risk when TRUST_PROXY is misconfigured
