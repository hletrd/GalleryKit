# Critic Review — Cycle 5 Manual Fallback

_Manual fallback after child-agent timeout._

## Highest-signal critique

### K5-01 — The restore contract still over-promises what the code enforces
- **Severity:** HIGH
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:227-230,235-279`, `apps/web/src/app/actions/*.ts` mutators, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:57-79,158-180`
- The code and UI now imply a maintenance-style restore window, but the implementation is only partial: queue + buffered views are quiesced, while other live writes remain possible and the restore size limit is only partially enforced.
- Suggested fix: make restore either a fully enforced maintenance boundary or explicitly scope/document the remaining gaps.

### K5-02 — The product still has split branding sources
- **Severity:** LOW
- **Confidence:** Medium
- **Citations:** `apps/web/src/app/global-error.tsx:1-3,45-52`, `apps/web/src/app/[locale]/layout.tsx:15-48`
- Live SEO settings drive the happy path; `site-config.json` still drives the fatal shell. That is easy to miss now that most branding moved to DB-backed settings.
