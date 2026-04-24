# document-specialist — cycle 2 rpl

HEAD: `00000006e`.

## Doc/code alignment check

### DOC2R-01 — CLAUDE.md says "Session secret: SESSION_SECRET env var is required in production" and code does enforce this
- **Citation:** `apps/web/src/lib/session.ts:30-36`.
- **Verdict:** ALIGNED.

### DOC2R-02 — CLAUDE.md says "Last admin deletion prevented to avoid lockout" and code enforces this via advisory lock
- **Citation:** `apps/web/src/app/actions/admin-users.ts:185-200`.
- **Verdict:** ALIGNED.

### DOC2R-03 — CLAUDE.md says "Login rate limiting: 5 attempts per 15-minute window per IP" and code confirms
- **Citation:** `apps/web/src/lib/rate-limit.ts:6-7`. 15-minute window, 5 max attempts.
- **Verdict:** ALIGNED.

### DOC2R-04 — CLAUDE.md says "Max upload size: 200MB per file, 2 GiB total per batch by default, 100 files max"
- **Citation:** `apps/web/src/lib/process-image.ts:43` (200 MB = 200*1024*1024), `apps/web/src/app/actions/images.ts:116` (100 files max). Batch cap lives in `upload-limits.ts`.
- **Verdict:** ALIGNED.

### DOC2R-05 — CLAUDE.md says "GPS coordinates excluded from public API responses" and code enforces via compile-time guard
- **Citation:** `apps/web/src/lib/data.ts:197-200`.
- **Verdict:** ALIGNED.

### DOC2R-06 — AGENTS.md git-commit rules match the actual commit style on HEAD (semantic + gitmoji + GPG-signed + 7-zero mined prefix)
- **Citation:** `git log --oneline` shows prefixes like `0000000` and messages like `fix(auth): 🛡️ fail closed ...`.
- **Verdict:** ALIGNED.

### DOC2R-07 — Pending/open cycle-6-plan items on HEAD
- **Observation:** cycle 1 rpl's plan `plan/cycle1-rpl-review-fixes.md` explicitly subsumes the cycle-6 items (C6R-01..C6R-06) under new IDs. The `plan/done/cycle6-review-fixes.md` + `plan/done/cycle6-review-triage.md` moves are recorded as archived. No stale open plan.
- **Verdict:** CLEAN.

### DOC2R-08 — `CLAUDE.md` documents `lint:api-auth` as a gate, and `package.json` has the script
- **Citation:** `apps/web/package.json:18`.
- **Verdict:** ALIGNED. (And a matching `lint:action-origin` gate would be a natural next step — see TE2R-01.)

### DOC2R-09 — CLAUDE.md says "Docker liveness should probe /api/live"
- **Citation:** `apps/web/src/app/api/live/route.ts` exists and is tested in `live-route.test.ts`.
- **Verdict:** ALIGNED.

## Summary
All major claims in `CLAUDE.md` and `AGENTS.md` are consistent with HEAD on cycle 2 read-through. No doc/code drift to flag.
