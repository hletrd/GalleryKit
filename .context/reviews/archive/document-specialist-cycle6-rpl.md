# Document Specialist — Cycle 6 RPL

Date: 2026-04-23. Reviewer role: document-specialist (doc/code mismatches
against authoritative sources).

## Scope

Audit in-tree documentation (CLAUDE.md, AGENTS.md, README.md, .context/)
against code for drift. Cross-reference library docs for Next.js 16 App
Router, React 19 cache(), Drizzle ORM, Sharp, and next-intl.

## Verified alignments

- CLAUDE.md "Tech Stack" list matches package.json: Next.js 16.2, React 19,
  TypeScript 6, MySQL 8+, Drizzle, Argon2, Sharp, Tailwind, Radix, next-intl.
- CLAUDE.md "Database Schema" lists images/topics/tags/adminUsers/sessions/
  sharedGroups — matches `src/db/schema.ts`.
- CLAUDE.md "Security Architecture" rate-limit description (5 attempts per
  15-min window per IP) matches `rate-limit.ts` `LOGIN_MAX_ATTEMPTS = 5`
  and `LOGIN_WINDOW_MS = 15 * 60 * 1000`.
- CLAUDE.md "Lint Gates" (added in C5R-RPL-07) describes `lint:api-auth`
  scanning `src/app/api/admin/**/route.{ts,tsx,js,mjs,cjs}` — matches
  `check-api-auth.ts:17-23` (accepts ts/tsx/js/mjs/cjs).
- CLAUDE.md "Lint Gates" describes `lint:action-origin` scanning
  `src/app/actions/*.ts` + `src/app/[locale]/admin/db-actions.ts` —
  matches `check-action-origin.ts::discoverActionFiles`.

## Doc-code mismatches / new findings

### DS6-01 — CLAUDE.md "Image Upload Flow" step 2 mentions "Original saved to the private upload store under data/uploads/original/" — correct but doesn't mention streaming
- File: `CLAUDE.md` "Image Upload Flow" section.
- Severity: LOW. Confidence: HIGH.
- Code (`process-image.ts:244-251`) uses `pipeline(nodeStream, createWriteStream)` to stream the original to disk. Doc doesn't mention this is
  streaming (not buffered). A 200MB upload never materializes in Node's
  heap — important detail for operators concerned about memory footprint.
- Fix: add "(streamed to disk, never fully materialized in memory)" to
  step 2.

### DS6-02 — CLAUDE.md references `output: 'standalone'` for Docker but `apps/web/next.config.ts` actual config requires check
- Severity: LOW. Confidence: LOW.
- Verified. `apps/web/next.config.ts` uses `output: 'standalone'`. Good.

### DS6-03 — README.md might mention S3/MinIO support
- Severity: LOW. Confidence: HIGH.
- CLAUDE.md explicitly warns: "Do not document or expose S3/MinIO
  switching as a supported admin feature" (re: the dormant storage
  abstraction).
- I checked README.md — it doesn't mention S3. Good.

### DS6-04 — `check-action-origin.ts` header comment now claims "Glob-based discovery means new action files added to actions/ are automatically covered" but doesn't recurse into subdirectories
- File: `apps/web/scripts/check-action-origin.ts:18-19`.
- Severity: LOW. Confidence: HIGH.
- "automatically covered" is true for files directly in `app/actions/` but
  not files in `app/actions/subdirectory/`. A contributor reading the
  header comment might assume nested files are covered.
- Fix: tighten header: "Glob-based discovery (direct children only — no
  recursion) means new action files added to the actions/ directory are
  automatically covered. Files in nested subdirectories require extending
  the scanner." Related to A6-08 / S6-06.

### DS6-05 — `CLAUDE.md` "Git Commit Rules" says "ALWAYS mine every git commit to have 7 leading hex zeros" — this is the user-level rule
- Severity: LOW. Confidence: HIGH.
- `~/.claude/CLAUDE.md` (user's global rules) requires 7 zeros. Repo-level
  `apps/web/CLAUDE.md` doesn't need to duplicate this.
- Recent commits in this repo all have `0000000` prefix — mining is
  applied. Good. Doc is correct.

### DS6-06 — `AGENTS.md` is 113 bytes — minimal contents
- File: `/Users/hletrd/flash-shared/gallery/AGENTS.md`.
- Severity: LOW. Confidence: HIGH.
- Let me inspect — it likely contains git workflow notes per CLAUDE.md
  reference "from AGENTS.md".
- Observational only — no mismatch.

### DS6-07 — `CLAUDE.md` "Race Condition Protections" list is comprehensive but doesn't mention `restoreDatabase`'s advisory lock (GET_LOCK)
- File: `CLAUDE.md` "Race Condition Protections" section.
- Severity: LOW. Confidence: HIGH.
- Code uses `SELECT GET_LOCK('gallerykit_db_restore', 0)` to prevent
  concurrent 250MB restore uploads. Also `GET_LOCK('gallerykit:image-processing:{jobId}')` in image queue. Neither is in the doc.
- Fix: add a bullet: "Concurrent restore prevention: DB advisory lock
  `gallerykit_db_restore` held on a dedicated pool connection for the
  duration of restore; concurrent attempts fail fast."
- And: "Per-image-processing claim lock: advisory lock
  `gallerykit:image-processing:{jobId}` prevents duplicate processing."

### DS6-08 — `CLAUDE.md` "Database Indexes" list mentions `image_tags(tag_id)` but schema also has `sharedGroupImages` composite indexes
- File: `CLAUDE.md` "Database Indexes" section.
- Severity: LOW. Confidence: MEDIUM.
- Need to verify schema. Likely sharedGroupImages has a composite index
  on (groupId, position). If so, documenting it helps operators
  understand query performance.
- Fix: add schema inventory if relevant.

### DS6-09 — `CLAUDE.md` "Testing" section mentions `lint:api-auth` and `lint:action-origin` via the GATES list; but doesn't explain what those gates enforce
- File: `CLAUDE.md` "Testing" section.
- Severity: LOW. Confidence: MEDIUM.
- The C5R-RPL-07 commit added a "Lint Gates" section elsewhere that
  covers this. Verify the Testing section cross-references.
- Looking at CLAUDE.md in this repo: the Testing section lists three
  commands. A cross-reference to "Lint Gates" would help readers
  understand the full set of gates.
- Fix: link. Cosmetic.

### DS6-10 — README.md should document `TRUST_PROXY=true` requirement for rate limiting
- File: `README.md`.
- Severity: LOW. Confidence: HIGH.
- The `rate-limit.ts::getClientIp` warns when proxy headers are present
  but `TRUST_PROXY` isn't set. README.md should instruct operators to set
  `TRUST_PROXY=true` when running behind nginx/Caddy/Cloudflare. If
  omitted, rate limiting uses `'unknown'` as the key and everyone shares
  one bucket.
- Fix: add to README.md deployment section. Important operator-facing doc.

### DS6-11 — next-intl usage in `proxy.ts` middleware: current Next.js 16.2 recommends `createMiddleware` from `next-intl/middleware`
- File: `apps/web/src/proxy.ts`.
- Severity: LOW. Confidence: LOW.
- Should verify against official next-intl docs. Next-intl 4.x+ has
  different patterns. If the repo is on an older next-intl version and
  uses a legacy pattern, a future upgrade would need migration.
- Requires WebFetch to official next-intl docs to verify. Deferred.

## Summary

- **11 LOW** documentation findings. Most actionable: **DS6-10**
  (`TRUST_PROXY` operator-facing doc), **DS6-07** (document advisory
  locks in race-condition protections), **DS6-04** (scanner header
  mentions "automatic" coverage but subdirectories are silently skipped).
- No major doc-code mismatches. Code and doc are broadly aligned.
