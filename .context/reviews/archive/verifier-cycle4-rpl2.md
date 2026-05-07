# Verifier — Cycle 4 RPL (2026-04-23, loop 2)

Reviewer focus: evidence-based correctness check against stated behavior.

## Verified behavior

| Claim (from CLAUDE.md / code comments) | Evidence | Verdict |
|---|---|---|
| Argon2id password hashing | `auth.ts:128`, `auth.ts:65`, `auth.ts:335`, `auth.ts:342` | CONFIRMED |
| HMAC-SHA256 session + `timingSafeEqual` | `session.ts:87`, `session.ts:117` | CONFIRMED |
| `stripControlChars` applied to all form inputs | Grep across actions modules shows 40+ invocations, each followed by validation | CONFIRMED |
| Path traversal rejection via `lstat` + `startsWith` | `serve-upload.ts:75-84`, `api/admin/db/download/route.ts:51-59` | CONFIRMED |
| `requireSameOriginAdmin()` on every mutating server action | Grep confirms presence in 8 action modules + db-actions.ts | CONFIRMED |
| `isAdmin()` on every admin route handler | `api-auth.ts` wraps `/api/admin/*` plus each action calls `isAdmin()` first | CONFIRMED |
| Compile-time privacy guard `_SensitiveKeysInPublic` | `data.ts:197-200` | CONFIRMED |
| `unstable_rethrow(e)` in every outer catch of auth.ts | `auth.ts:219`, `auth.ts:224`, `auth.ts:390` — all before any side-effect branching | CONFIRMED (test asserts via regex at `auth-rethrow.test.ts`) |
| Pre-increment TOCTOU-safe rate limit (login/share/admin-create/search/upload) | `auth.ts:136-144`, `sharing.ts:54-67/104-115`, `admin-users.ts:83-106`, `public.ts:54-90`, `images.ts:170-176` | CONFIRMED |
| Admin advisory lock against concurrent delete of last admin | `admin-users.ts:193-224` | CONFIRMED |
| DB restore advisory lock (single-session GET_LOCK/RELEASE_LOCK) | `db-actions.ts:269-305` | CONFIRMED |
| SQL restore scanner blocks `GRANT`, `CREATE USER`, etc. | `sql-restore-scan.ts:1-31` | CONFIRMED |
| Upload tracker settles pre-claimed quota | `images.ts:307-313`, `upload-tracker.ts` | CONFIRMED |
| Image processing claims row before processing, cleans up orphans | `image-queue.ts:177-183/239-248` | CONFIRMED |

## Gaps / unverified claims

### C4R-RPL2-VER-01 — CLAUDE.md says "Session tokens: HMAC-SHA256 signed, verified with `timingSafeEqual`" — session-secret dev-mode behavior not documented

The repo enforces `SESSION_SECRET` in production, falling back to DB-stored secret in dev. CLAUDE.md mentions this briefly but a new contributor might assume the DB fallback is safe in prod. **Docs could be clearer** about the strict production requirement. Non-blocking.

### C4R-RPL2-VER-02 — `safeJsonLd` only escapes `<`

Claim in comments: "escaping `<` to prevent XSS via `</script>`". True, but the function's name suggests broader "safety" which U+2028/U+2029 would violate (see CQ-03). Either rename or harden. See SEC-01.

### C4R-RPL2-VER-03 — db/index.ts `SET group_concat_max_len` claim

`db-actions.ts:56-59` comment says "group_concat_max_len is already set to 65535 on every pool connection via poolConnection.on('connection', ...)". **Partially verified:** the listener exists but its query is fire-and-forget without error handling — transient failure silently reverts the connection to the default 1024 bytes. See CQ-01.

## Confidence Summary

- 0 HIGH, 0 MEDIUM, 3 LOW verification gaps.
