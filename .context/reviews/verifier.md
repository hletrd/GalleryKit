# Verifier — Cycle 3 Deep Review (2026-04-27)

**HEAD:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`

## Verification Matrix

Verified all claimed behaviors in CLAUDE.md against actual code.

| Claim | Verified | Notes |
|---|---|---|
| Argon2id password hashing | Yes | `auth.ts:144`, `admin-users.ts:144` use `argon2.argon2id` |
| HMAC-SHA256 session tokens | Yes | `session.ts:87` uses `createHmac('sha256', secret)` |
| timingSafeEqual verification | Yes | `session.ts:117` uses `timingSafeEqual` |
| Cookie httpOnly + secure + sameSite | Yes | `auth.ts:214-220`, `auth.ts:387-393` |
| SESSION_SECRET required in production | Yes | `session.ts:30-36` throws if missing |
| Path traversal prevention | Yes | `serve-upload.ts:8,54-60,82-84` |
| Symlink rejection | Yes | `serve-upload.ts:77` rejects `isSymbolicLink()` |
| UUID filenames (no user-controlled names) | Yes | `process-image.ts:239` uses `randomUUID()` |
| Privacy guard compile-time | Yes | `data.ts:206-209` type assertion |
| publicSelectFields separate reference | Yes | `data.ts:170-190` destructuring + new object |
| Blur data URL 3-point validation | Yes | Producer (`process-image.ts:305`), write (`images.ts:307`), read (`blur-data-url.ts:104`) |
| Rate limit pre-increment pattern | Yes | All 7 rate-limit surfaces verified |
| Advisory locks | Yes | 5 advisory locks verified (db_restore, topic_route_segments, admin_delete, upload_processing_contract, image-processing) |
| Unicode bidi/formatting rejection | Yes | `validation.ts:35`, applied in topics, tags, images, seo, csv |
| CSV formula injection prevention | Yes | `csv-escape.ts:49` prefixes `=`, `+`, `-`, `@` |
| Touch-target audit fixture | Yes | `touch-target-audit.test.ts` |
| Reduced-motion support | Yes | CSS transitions use `duration-300` (not instant), not verified via runtime |
| View count buffer swap | Yes | `data.ts:61-62` atomically swaps Map reference |
| CSP GA conditional | Yes | `content-security-policy.ts:59,67` conditional on `NEXT_PUBLIC_GA_ID` |
| Upload tracker TOCTOU pre-claim | Yes | `images.ts:193-197` creates entry before check |
| SQL restore scanner | Yes | `sql-restore-scan.ts` blocks DROP DATABASE, etc. |
| Image queue claim check | Yes | `image-queue.ts:237-241` verifies row exists and is unprocessed |
| `safeJsonLd()` escaping | Yes | `safe-json-ld.ts` escapes `<`, U+2028, U+2029 |
| `requireSameOriginAdmin()` on all mutating actions | Yes | Every mutating action in `app/actions/` calls it |
| `withAdminAuth` on all API admin routes | Yes | Verified via `check-api-auth.test.ts` |

## Findings (New)

No new verification failures found. All documented behaviors match the code implementation.
