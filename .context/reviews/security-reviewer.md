# Security Review — Cycle 4 (review-plan-fix loop, 2026-04-25)

## Inventory

Reviewed: `apps/web/src/lib/{validation,sanitize,rate-limit,request-origin,action-guards,csv-escape,session,auth-rate-limit,db-restore,upload-paths,upload-tracker,upload-processing-contract-lock}.ts`, `apps/web/src/app/actions/{auth,topics,tags,images,public,admin-users,seo,sharing,settings}.ts`, `apps/web/src/app/api/admin/**/route.ts`, `apps/web/src/proxy.ts`, `apps/web/src/middleware/*`.

## Findings

### C4L-SEC-01 — `isValidTagName` permits Unicode bidi/invisible formatting characters [LOW] [Medium confidence]

- **File / line:** `apps/web/src/lib/validation.ts:43-46`
- **Issue:** `isValidTagName` rejects only `<>"'&\x00` and commas. It accepts the same high-codepoint formatting characters that the project explicitly hardened against in `isValidTopicAlias` (C3L-SEC-01) and CSV export (C7R-RPL-11 / C8R-RPL-01):
  - U+200B–U+200D, U+2060, U+FEFF, U+180E, U+FFF9–U+FFFB (zero-width / invisible formatting)
  - U+202A–U+202E, U+2066–U+2069 (Trojan-Source bidi overrides)
- **Failure scenario:** An admin saves a tag name containing `U+202E RLO`. The tag is rendered into admin UI lists (`/admin/tags`), photo viewers, and tag-pill components verbatim (React handles entity escaping but does not strip bidi controls), causing visual reordering of subsequent text. The slug derivation in `getTagSlug` (`tag-records.ts:5`) already strips these via `[^\p{Letter}\p{Number}-]+`, so the slug stays safe — but the **stored `name`** does not. This is the same defense-in-depth gap that C3L-SEC-01 closed for topic aliases.
- **Suggested fix:** Reject the same Unicode-formatting set in `isValidTagName` (factor `UNICODE_FORMAT_CHARS` from `validation.ts:37` into a shared exported constant). Add `validation.test.ts` coverage parallel to the topic-alias parity tests.
- **Confidence:** Medium (cosmetic-only impact; not a code-execution path. But a documented project-wide hardening posture exists, so the gap should be closed.)

## Cross-cutting checks (no findings)

- `withAdminAuth` wrappers and `requireSameOriginAdmin` guards — all admin routes/actions covered (per existing lint gates).
- Argon2id for password hashing, HMAC-SHA256 with `timingSafeEqual` for sessions.
- File upload safe-segment whitelisting and `lstat` symlink rejection — unchanged and intact.
- Rate limit pre-increment ordering (TOCTOU fix) — verified in `auth.ts`, `admin-users.ts`, `public.ts`, `sharing.ts`.
- CSV export hardening for control / bidi / zero-width characters — verified.

## Confidence summary

- C4L-SEC-01 — Medium

No security-critical or correctness-critical findings this cycle.
