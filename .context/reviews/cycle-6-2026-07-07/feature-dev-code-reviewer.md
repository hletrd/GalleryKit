# feature-dev:code-reviewer review — cycle 6

## Summary

Reviewed committed HEAD (`583277fb`) for bugs, logic errors, security vulnerabilities, and
project-convention adherence, focused on files outside the declared peer-dirty set (the second
session is actively editing `data.ts`, `image-queue.ts`, `public.ts`, `topics.ts`, the embeddings/
timeline/CLIP surfaces, and their tests). Covered nearly all server actions, several API routes,
the auth/restore/upload security-critical `lib/` modules, the DB pool wrapper, and a set of
recently-touched frontend components (photo viewer, image zoom, photo navigation, masonry card,
search, footer, not-found, map page). No new high-confidence CRIT/HIGH bug or security defect was
found in this scope. `npm run lint`, `npm run typecheck`, and all three architectural gates
(`lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`) pass cleanly against HEAD.
Two LOW-severity, LOW-priority observations are recorded below for completeness.

## Findings

### F1 — `/api/og` error-path response omits `X-Content-Type-Options: nosniff` (unlike its sibling routes)  [SEV: LOW | CONF: Low | apps/web/src/app/api/og/route.tsx:260-269]

The catch-all error response in `GET` (`apps/web/src/app/api/og/route.tsx:264-269`) returns a bare
string (`Failed to generate the image`) with only `Cache-Control` set — no `Content-Type` and no
`X-Content-Type-Options: nosniff`. Every other public route reviewed this cycle (`/api/health`,
`/api/live`, `/api/og/photo/[id]`'s fallback response, `serve-upload.ts`) explicitly sets
`X-Content-Type-Options: nosniff`. The response body is a static literal (no user input reflected),
so this is not exploitable today, but it is an inconsistency with the repo's own defense-in-depth
convention on every other response-header site.

**Fix:** add `'X-Content-Type-Options': 'nosniff'` to the error-path headers in
`apps/web/src/app/api/og/route.tsx` for parity with the sibling per-photo OG route and the other
public routes.

### F2 — Modified test files not covered by the cycle's declared peer-dirty list  [SEV: INFO | CONF: High | process note, not a code defect]

The briefing's peer-dirty test list names `client-source-contracts`, `data-tag-names-sql`,
`data-timeline`, `deploy-script-contract`, `maintenance-scheduler-source`,
`photo-title-stub-prefix-strip`, `semantic-embedding-storage-contract`, `topics-actions`. The live
working tree also shows uncommitted modifications to `cycle-10-source-contracts.test.ts`,
`migrate-reconcile-coverage.test.ts`, and `public-actions.test.ts`, which are not in that list.
This does not affect committed-HEAD review conclusions (the review baseline), but future cycles'
peer-dirty lists should double check `git status` rather than a hand-maintained enumeration, so a
reviewer lane doesn't inadvertently propose edits to a file the other session is mid-editing.

## Files examined (inventory)

Server actions (non-peer-dirty): `auth.ts`, `images.ts`, `collections.ts`, `lr-tokens.ts`,
`admin-users.ts`, `sharing.ts`, `tags.ts`, `seo.ts`, `settings.ts`, `admin-backfill.ts`.

API routes: `api/admin/db/download/route.ts` (inventoried via lint gate + source), `api/health/route.ts`,
`api/live/route.ts`, `api/og/route.tsx`, `api/og/photo/[id]/route.tsx`. (`api/admin/lr/upload/route.ts`
inventoried via the api-auth gate; not separately deep-read this cycle.)

`admin/db-actions.ts` (backup/restore, full read).

`lib/` (non-peer-dirty, deep read): `serve-upload.ts`, `content-security-policy.ts`,
`smart-collections.ts`, `background-db-writes.ts`. `db/index.ts` (pool wrapper).

Components: `photo-viewer.tsx`, `image-zoom.tsx`, `photo-navigation.tsx`, `masonry-card.tsx`,
`search.tsx`, `footer.tsx`, `not-found.tsx` (locale root), `(public)/map/page.tsx`.

Verification commands run against HEAD: `npm run lint`, `npm run typecheck`, `npm run lint:api-auth`,
`npm run lint:action-origin`, `npm run lint:public-route-rate-limit` — all passed with no findings.

Cross-referenced against `.context/plans/deferred-carry-forward.md` and `.context/reviews/_aggregate.md`
to avoid re-reporting known/deferred items; no overlap found with the files inspected this cycle
(the aggregate's open items concentrate in `data.ts`/`data-timeline.ts`/nginx/migrate.js/CLIP
surfaces, which are either peer-dirty or already tracked).

## Final sweep (commonly-missed) notes

- Checked every mutating server action read this cycle for the standard four-part guard
  (`getRestoreMaintenanceMessage` → `requireSameOriginAdmin` → `acquireAdminMutationSlot` →
  `isAdmin`) — all present and correctly ordered, matching the documented convention in CLAUDE.md.
- Checked rate-limit pre-increment-before-expensive-work ordering (login, password change,
  user create, share-link creation) — consistently applied with TOCTOU-safe patterns and symmetric
  rollback on infrastructure failure vs. legitimate-input rejection.
- Checked `smart-collections.ts` compiler for injection risk given it builds a dynamic SQL predicate
  from an admin-authored JSON AST — confirmed all leaf values flow through Drizzle's `sql` tagged
  templates / helper functions (parameterized), column names are allowlisted, and scalar-value
  enforcement (`isScalarValue`) prevents the mysql2 object-expansion class of bug documented in the
  file's own R4C4 HARD-R4C4-07 comment.
- Checked the two OG image routes for the SSRF/open-redirect classes noted in CLAUDE.md (fetch
  origin pinned to `BASE_URL`, not request-derived; OG image URL redirect validated same-origin) —
  both protections are intact and fail closed when the canonical URL is unparseable.
- No `dangerouslySetInnerHTML` sink found outside the existing JSON-LD `<script>` tags (all render
  server-computed, sanitized JSON, not raw user input).
- No TODO/FIXME/HACK markers found outside comment text unrelated to unfinished work.
- Did not find evidence of a missed `await`, swallowed rejection changing control flow, or
  off-by-one/boundary bug in any of the files listed above.
