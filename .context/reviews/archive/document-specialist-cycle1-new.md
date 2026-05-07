# document-specialist — cycle 1 (new)

Scope: doc/code mismatches against authoritative sources.

## Findings

### DOC1-01 — `CLAUDE.md` claims "Every server action independently verifies auth via `isAdmin()`" — verified holds
- **Citation:** `CLAUDE.md` Security Architecture; server actions
- **Evidence:** `isAdmin()` is called at the top of every mutation server action. No mismatch.

### DOC1-02 — `CLAUDE.md` claims "Middleware auth guard checks admin_session cookie" — verified holds
- **Citation:** `apps/web/src/proxy.ts`; `CLAUDE.md`
- **Evidence:** Middleware matches `/admin/*` sub-routes with an auth guard that falls through to login for unauth.

### DOC1-03 — `CLAUDE.md` says "Processed images are stored in `apps/web/public/uploads/`" — verified
- **Citation:** `apps/web/src/lib/upload-paths.ts`
- **Evidence:** `UPLOAD_ROOT` reflects the documented path.

### DOC1-04 — `CLAUDE.md` says "Require `SESSION_SECRET` in production; dev/test can fall back to DB-stored secret" — verified
- **Citation:** `apps/web/src/lib/session.ts`

### DOC1-05 — `CLAUDE.md` says "E2E fixture generation should honor configured image sizes" — this is a stated invariant but the seed script diverges
- **Citation:** `CLAUDE.md` does not literally assert "honor configured image sizes", but `apps/web/scripts/seed-e2e.ts:77` hard-codes them. Noted under CR1F-06.

### DOC1-06 — `plan/cycle6-review-fixes.md` exists but is unfinished on HEAD
- **Citation:** `plan/cycle6-review-fixes.md`; git log shows the plan was committed but not implemented.
- **Disposition:** This cycle's plan should resolve by either implementing or explicitly superseding it.

### DOC1-07 — README / CLAUDE both warn about historical `.env.local.example` secrets
- **Citation:** `README.md`; `CLAUDE.md` Environment Variables section
- **Evidence:** Both documents explicitly warn operators to rotate if they seeded from historical examples. Matches security-reviewer finding 1's operational closure.

### DOC1-08 — No mismatch found in image-queue, rate-limit, or backup sections
- **Evidence:** Code and docs align on claim and conditional UPDATE, 5/15-minute login limit, `data/backups/` path, authenticated download route.
