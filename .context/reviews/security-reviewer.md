# security-reviewer — Cycle 3 (HEAD `839d98c`, 2026-04-26)

## Inventory

Walked auth (`lib/auth.ts`, session, rate-limit), upload
(`lib/process-image.ts`, `actions/images.ts`), CSV/Trojan-Source
(`lib/csv-escape.ts`, `lib/validation.ts`), CSP, DB restore, and the
cycle-2 blur-data-url validator.

## Findings

### SR3-LOW-01 — `assertBlurDataUrl` warn output is not rate-limited

- **File:** `apps/web/src/lib/blur-data-url.ts:58-75`
- **Confidence:** Medium / **Severity:** Low

Warn line is correctly redacted (cycle-1 SR1-LOW-01 fix), but no per-id
throttle. A poisoned `blur_data_url` that survives a DB restore would
log on every page load. Recommendation: LRU-cache "already warned" tuples
(typeof,len,head) for the process lifetime, warn at most once per tuple.

### SR3-INFO-01 — no production write-time enforcement that the column holds `data:image/...`

- **File:** `apps/web/src/db/schema.ts:51`
- **Confidence:** High / **Severity:** Informational

Column is `text('blur_data_url')` with no DB-level constraint. We rely
on `assertBlurDataUrl()` at the producer (`actions/images.ts:307`) and
the consumer (`photo-viewer.tsx`). A direct SQL UPDATE or DB restore can
seed arbitrary content. A CHECK constraint
`CHECK (blur_data_url IS NULL OR blur_data_url LIKE 'data:image/%;base64,%')`
would close the residual gap (MySQL 8.0.16+ enforces CHECK). Filed
informational because both write paths are admin-only and existing
guards block the common attack surface.

## Verdict

1 NEW LOW, 1 NEW INFO. No new HIGH/MEDIUM security findings.
