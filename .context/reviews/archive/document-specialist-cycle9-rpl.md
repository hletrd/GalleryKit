# document-specialist — cycle 9 rpl

HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f`.

## Doc-vs-code mismatches

### D-1. CLAUDE.md claims CSV escape handles `\t` and `\r` as formula-injection escapes [LOW / HIGH]
- CLAUDE.md "Database Security" section: "CSV export escapes formula injection characters (`=`, `+`, `-`, `@`, `\t`, `\r`)".
- Actual behavior at `csv-escape.ts:34`: the C0/C1 control-char strip removes `\t` and `\r` entirely. The prefix-with-apostrophe applies only to `=`, `+`, `-`, `@` (csv-escape.ts:49).
- Impact: a reviewer reading the docs might think `\t` and `\r` are preserved but escaped; they are actually stripped. Contradicts the stated behavior.
- Fix: revise CLAUDE.md section to: "CSV export strips C0/C1 control chars (incl. `\t`, `\r`, `\n`), strips Unicode bidi overrides and zero-width chars, collapses remaining CR/LF to space, and prefixes `=`, `+`, `-`, `@` with an apostrophe (OWASP CSV injection guidance)".

### D-2. CLAUDE.md does not document the account-scoped login rate limit [LOW / MEDIUM]
- `auth.ts:118-130` adds a username-keyed rate-limit bucket to prevent distributed brute-force. CLAUDE.md's "Authentication & Sessions" section only documents IP-based login rate limiting.
- Fix: add a bullet: "Account-scoped rate limit: in addition to IP-based throttling, per-username bucket (SHA-256 hashed, 'acct:' prefixed) enforces the same 5/15m budget to defeat distributed brute-force across rotating IPs."

### D-3. CLAUDE.md does not document the `gallerykit:image-processing:<jobId>` advisory lock [LOW / MEDIUM]
- `image-queue.ts:123-153` uses MySQL GET_LOCK for per-job processing claim. Multi-process deployments rely on this to prevent duplicate processing. CLAUDE.md mentions `gallerykit_db_restore` and `gallerykit_topic_route_segments` and `gallerykit_admin_delete` advisory locks but not the per-job image processing lock.
- Fix: add the job-lock name to CLAUDE.md's "Race Condition Protections" list.

### D-4. CLAUDE.md says "hourly background job" purges expired sessions, but actual cadence is 60 minutes from bootstrap [LOW / LOW]
- `image-queue.ts:357-363`: `setInterval(..., 60 * 60 * 1000)` — correct but the first run happens AT bootstrap, not on the hour boundary.
- Fix: minor wording tweak — "hourly from app bootstrap".

### D-5. CLAUDE.md "Permanently Deferred" section still says "2FA/WebAuthn: Not planned" [confirmed still intentional]
- No action needed; kept for reviewer awareness.

### D-6. `upload-tracker.ts` has no leading comment documenting the "pre-register before await" contract [LOW / MEDIUM]
- The file contains only the `UploadTrackerEntry` type and `settleUploadTrackerClaim` helper. The TOCTOU fix lives in `images.ts:135-139` but a reviewer jumping to `upload-tracker.ts` first sees a trivial file. Add a module-level comment explaining why this is non-trivial.

### D-7. README.md deploy section vs. actual deploy helper [not a mismatch, but worth documenting]
- CLAUDE.md documents `npm run deploy` (reads `.env.deploy`). Confirmed `scripts/deploy.mjs` exists but no CLAUDE.md reference to the script file path for debugging.

## Positive confirmations

- CLAUDE.md correctly documents the Argon2id + Argon2 password hashing.
- CLAUDE.md correctly documents the HMAC-SHA256 session token + timingSafeEqual.
- CLAUDE.md correctly documents the 200MB per-file and 100 files-per-batch limits, with the "configurable via UPLOAD_MAX_TOTAL_BYTES" note.
- CLAUDE.md correctly documents the Argon2 hash + `SESSION_SECRET` env var production requirement.
- CLAUDE.md correctly documents the "ensure both public/uploads and private data volume persisted in Docker" note.
- AGENTS.md "Git Workflow" aligns with actual behavior (gitmoji, GPG signing, mined commits).

## Doc-drift mitigation

The codebase has a strong pattern of annotating fixes with cycle IDs (C46-01, C8R-RPL-02, etc.) directly in code comments. Proposal: add a reverse index (`.context/fix-index.md`) mapping cycle IDs → file:line → one-line summary. This would make it easier to verify at review time whether a fix is still intact.
