# Cycle 10b Security Review

Reviewer: security-reviewer
HEAD reviewed: `f4faad29f1b90984e352677c66d832239787b855` (docs-only commit; no `apps/web/src` or `apps/web/scripts` diff since `d985f549` — verified via `git diff --stat d985f549 HEAD -- apps/web/src apps/web/scripts`, empty output)
Risk Level: **LOW** (highly converged codebase; no new confirmed findings)

## Scope and dedupe method

This is the same application code the peer's own cycle-29 security review (`.context/reviews/run10-cycle29/security-reviewer.md`) audited at `d985f549` — the two doc-only commits between that HEAD and this one (`0877df85`, `83830e1d`, `04c784a6`, `f4faad29`) touch only `.context/reviews/**`. I did not treat that prior report as ground truth; I independently re-derived findings by reading source at `git show HEAD:<path>` and re-running the security lint/audit gates myself (fresh evidence below), then cross-checked overlap against cycles 20-29 and `.context/plans/deferred-carry-forward.md` before writing anything up as "new."

Per the task brief, the three peer-dirty files (`apps/web/scripts/check-action-origin.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/cycle-28-source-contracts.test.ts`) were treated as in-flight WIP — I ran the action-origin lint against the working tree (it uses the peer's version and still reports every mutating action as covered) but did not review their diff as "current state" for reporting purposes; nothing in this report depends on their uncommitted content.

## Fresh Validation Evidence (this pass)

- `npm run lint:api-auth --workspace=apps/web` → `OK` for both `/api/admin/db/download` and `/api/admin/lr/upload`.
- `npm run lint:public-route-rate-limit --workspace=apps/web` → all 10 scanned public route files `OK` (rate-limit helper present or documented exemption).
- `npm run lint:action-origin --workspace=apps/web` → every mutating server action reports same-origin coverage or a reasoned exemption; no `FAIL` lines.
- `npm audit --workspace=apps/web --audit-level=moderate` → `found 0 vulnerabilities`.
- Targeted secret-literal grep (`api[_-]?key|secret|password|token` assigned to a ≥12-char literal) across `apps/web/src` and `apps/web/scripts`, excluding tests → no hits after filtering placeholders/env-var reads.

## Independent Deep-Dive Areas (not itemized in cycle-29's inventory)

I deliberately spent this pass on surfaces cycle-29 summarized only briefly or didn't name explicitly, to maximize the chance of finding something genuinely new rather than re-confirming the same list. All came back clean:

1. **Smart-collection query compiler** (`apps/web/src/lib/smart-collections.ts`) — the JSON-AST → SQL compiler for `/c/[slug]`. Verified: column allowlist (`ALLOWED_COLUMNS`/`isAllowedDirectColumn`) rejects unknown columns before touching Drizzle; `MAX_DEPTH=4`, `MAX_AST_NODES=512`, `MAX_GROUP_CHILDREN=64`, `MAX_IN_VALUES=100`, `MAX_QUERY_JSON_BYTES=64KB` bound the AST; every predicate value is enforced scalar (`isScalarValue`) at parse time so a stored `{value: {...}}` object can't expand into an unparameterized SQL fragment (documented as R4C4 HARD-R4C4-07's exact threat model); all leaf SQL uses Drizzle's `eq/gt/gte/lt/lte/inArray` or tagged `sql\`...\`` template literals with bound values — no string concatenation. The tag-subquery path (`compileTagPredicate`) and `containsLike` (`apps/web/src/lib/sql-like.ts`) both parameterize and `%`/`_`/`!`-escape LIKE wildcards. `apps/web/src/app/actions/collections.ts` gates create/update/delete behind restore-maintenance + same-origin + mutation-slot + `isAdmin()`, and the public read paths (`apps/web/src/app/actions/public.ts:218-220`, `apps/web/src/app/'[locale]'/(public)/c/[slug]/page.tsx:90-93` and its `generateMetadata`) all check `collection.is_public` before compiling/serving — a private (`is_public=false`) collection 404s identically to a missing one, so no enumeration signal. No injection or IDOR path found.
2. **PAT token verification** (`apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/api-auth.ts`) — lookup is by SHA-256 hash equality (not plaintext) via a parameterized query, followed by an explicit `timingSafeEqual` re-check (`tokenHashesEqual`); rate-limit pre-increment (`preIncrementAdminTokenAuthAttempt`) runs *before* `verifyToken()` so brute-forcing the hash space is throttled at the network layer, not just after DB lookup cost. `revokeToken`/`listTokensForUser` scope every operation to the acting `userId`, so one admin cannot enumerate or revoke another admin's PAT via this surface (stricter than the doc'd "any admin can manage any admin" model — a safe direction, not a gap). Scope enforcement (`tokenHasScope`) confirmed correct: only `lr:upload` has a wired route; `lr:read`/`lr:delete` have zero route call sites (`grep` confirmed), matching the documented reserved-scope status.
3. **Admin backup download** (`apps/web/src/app/api/admin/db/download/route.ts`) — `Content-Disposition: attachment; filename="${file}"` reflects a user-supplied query param, which would be a header/response-splitting vector if `file` allowed quotes or control characters. Checked `isValidBackupFilename` (`apps/web/src/lib/backup-filename.ts`): `BACKUP_FILENAME_PATTERN = /^backup-\d{4}-\d{2}-\d{2}T[\d-]+Z(?:-[0-9a-f]{8})?\.sql$/i` is a closed allowlist with no quote/CRLF/path characters possible — not exploitable. Path containment double-checked via `path.resolve` prefix check pre-open and `realpath` prefix re-check post-open (symlink-safe).
4. **GPS EXIF strip binary parsers** (`apps/web/src/lib/gps-exif-strip.ts`) — hand-rolled JPEG/TIFF/ISOBMFF/WebP box walkers are a classic source of buffer-overread/integer-overflow bugs. Traced every offset arithmetic path (`inBounds` closures, `MAX_IFD_CHAIN=8`/`MAX_IFD_ENTRIES=1024` cycle/entry bounds, ISOBMFF `walkChildren` 64-bit-size `MAX_SAFE_INTEGER` guard, `iloc` `itemCount>4096`/`extentCount>64` caps, and the `walkAborted` fail-closed flag that forces the lossy re-encode fallback on any structural anomaly instead of silently reporting "no GPS found"). All arithmetic stays within safe-integer bounds and every walker returns `null` (not a partial result) on any anomaly. No new gap found; this matches the documented SEC-R4C8/R4C9/R4C10/R19C19/R20C20 hardening lineage in `CLAUDE.md`.
5. **JSON-LD injection surfaces** — grepped every `dangerouslySetInnerHTML` call site (`(public)/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `c/[slug]/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`): all six route through `safeJsonLd()` (`apps/web/src/lib/safe-json-ld.ts`), which escapes `<`/`>` (blocks a `</script>` breakout) and U+2028/U+2029. No call site bypasses the helper.
6. **Admin user deletion / password change** (`apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/auth.ts:331-455`) — `deleteAdminUser` uses a dedicated pooled connection with `GET_LOCK('gallerykit_admin_delete', 5)`, a transaction, explicit last-admin (`count<=1`) and self-delete guards, parameterized raw SQL throughout, and destroys (rather than releases) the connection on a lock-acquire error so the table-wide lock can't leak onto a reused pooled session. `updatePassword` is strictly self-scoped (`where(eq(adminUsers.id, currentUser.id))`, keyed off `getCurrentUser()`, never a client-supplied user id) and rotates all sessions for that user on success — no IDOR path to reset another admin's password.
7. **Share-link key generation** (`apps/web/src/app/actions/sharing.ts`) — `generateBase56` at 10 chars gives 56^10 ≈ 3.0×10^17 possible keys; combined with the documented nginx edge `zone=public` rate limiting on `/s/[key]`/`/g/[key]` GETs, brute-force enumeration is not practical. Revoke/rotate paths use conditional `UPDATE ... WHERE share_key = oldKey` (optimistic concurrency, not a blind overwrite) so a racing rotate can't silently discard a concurrently-issued new key.
8. **ReDoS scan** — read every regex in `apps/web/src/lib/validation.ts` and `apps/web/src/lib/sanitize.ts`; all are single-pass character-class patterns (`[a-z0-9_-]+`, Unicode-range classes, etc.) with no nested/overlapping quantifiers — no catastrophic-backtracking shape found.
9. **Prototype-pollution / unsafe-deserialization scan** — enumerated every `JSON.parse` call site in `apps/web/src` (`admin-tokens.ts` scopes, `smart-collections.ts` AST, `image-queue.ts` internal settings snapshot, `wide-gamut-hint.tsx` client localStorage read, `search/semantic/route.ts` request body). Every site either (a) only reads a small allowlisted set of primitive fields off the parsed object (never spreads the whole object into a sensitive sink) or (b) runs through the smart-collection structural validator described above. No `__proto__`/`constructor.prototype` pollution path found.

## Confirmed New Findings

**None.** I found no reproducible authorization bypass, IDOR, path-traversal, SSRF, SQL/formula/header injection, timing-exploitable comparison, PAT scope bypass, secret leakage, unsafe-deserialization, advisory-lock race, or privacy-field leak at current HEAD. This is a genuinely converged result, not a shallow pass — see the validation evidence and nine independent deep-dive areas above, several of which (smart-collection compiler, GPS EXIF binary parsers, JSON-LD escaping, ReDoS, prototype pollution) were not itemized in the peer's cycle-29 report.

## Still-Open Deferred Items (not re-filed as new; tracked elsewhere)

Both remain accurately tracked in `.context/plans/deferred-carry-forward.md` and are unchanged since cycle-29 (no code touched the relevant files):

1. **`C27-02`** (Medium / Medium-High, `.context/plans/run10-cycle27/deferred.md`) — a concurrent restore-database request still passes `isAdmin()` (`apps/web/src/app/[locale]/admin/db-actions.ts:421-428`) before the code observes an already-active restore window (the restore lock acquisition happens later, `:464-548`). A second overlapping restore request can therefore touch auth-table state briefly before the code returns `restoreInProgress`. Deliberately not re-scored here since the exit criterion (owner-signal design) has not changed and no new exploitability evidence surfaced this pass.
2. **`C28-08`** (Medium, `.context/plans/run10-cycle28/deferred.md`) — the shipped `zone=public`/`zone=nextimage` nginx edge rate limiters key on `$binary_remote_addr`, which is only correct if the deploy host's nginx sees the true client IP (real-IP/PROXY-protocol config, matching `TRUSTED_PROXY_HOPS`). This is an operator-topology validation item, not an application code defect — CLAUDE.md's `TRUST_PROXY`/`TRUSTED_PROXY_HOPS` docs already describe the fail-safe-but-degraded behavior when misconfigured.

Neither is scored as a *new* Cycle 10b finding; both are pre-existing, already-ledgered, operator/design-level items.

## Reviewed Surface Inventory (files read at HEAD this pass)

Auth/session/API-auth: `lib/session.ts`, `lib/request-origin.ts`, `lib/api-auth.ts`, `lib/admin-tokens.ts`, `app/actions/auth.ts`, `app/actions/lr-tokens.ts`, `proxy.ts`.
Server actions: `app/actions/admin-users.ts`, `app/actions/admin-backfill.ts`, `app/actions/collections.ts`, `app/actions/sharing.ts`, `app/actions/images.ts` (spot-checked), `app/actions/public.ts` (spot-checked).
API routes: `app/api/admin/db/download/route.ts`, `app/api/admin/lr/upload/route.ts` (spot-checked), `app/api/search/semantic/route.ts`.
Data/SQL: `lib/smart-collections.ts`, `lib/sql-like.ts`, `lib/data.ts` (privacy field split, spot-checked), `app/[locale]/admin/db-actions.ts` (spot-checked against cycle-29's line references).
Upload/privacy/binary parsing: `lib/gps-exif-strip.ts` (full read), `lib/backup-filename.ts`, `lib/validation.ts`, `lib/sanitize.ts` (regex/ReDoS pass).
Output encoding: `lib/safe-json-ld.ts` plus all six `dangerouslySetInnerHTML` call sites.

## Security Checklist

- [x] No hardcoded secrets (fresh grep this pass)
- [x] All inputs validated (smart-collection AST, backup filename, admin-user fields spot-checked)
- [x] Injection prevention verified (SQL: parameterized/Drizzle everywhere touched; LIKE-escaped; header injection closed by allowlist regex)
- [x] Authentication/authorization verified (PAT scope enforcement, session self-scoping, admin-delete advisory lock, lint:api-auth + lint:action-origin both green)
- [x] Dependencies audited (`npm audit` — 0 vulnerabilities)
