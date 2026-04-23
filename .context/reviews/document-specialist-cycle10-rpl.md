# document-specialist — cycle 10 rpl

HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Scope: doc/code mismatches. Cross-checked all documented claims in CLAUDE.md and AGENTS.md against source.

## Findings

### D10R-RPL-DOC01 — CLAUDE.md Authentication section completeness [VERIFIED ACCURATE]

Lines 119-125 describe:
- Argon2 password hashing.
- HMAC-SHA256 sessions.
- Cookie attributes.
- SESSION_SECRET requirement.
- Expired-session hourly purge.
- Per-IP + per-account rate limits.

All items cross-verified against `auth.ts`, `session.ts`, `auth-rate-limit.ts`. The account-scoped key prefix `acct:<sha256-prefix>` matches `auth-rate-limit.ts`'s `buildAccountRateLimitKey` and the account check at `auth.ts:122`.

**Resolves cycle 9 rpl AGG9R-RPL-04 deferral** (which claimed this was missing; it's actually present).

Confidence: High.

### D10R-RPL-DOC02 — CLAUDE.md Race Condition Protections section completeness [VERIFIED ACCURATE]

Lines 179-191 describe six race protections plus the advisory-lock scope note. The image-processing advisory lock (`gallerykit:image-processing:{jobId}`) is explicitly listed at lines 190-191.

**Resolves cycle 9 rpl AGG9R-RPL-05 deferral**.

Confidence: High.

### D10R-RPL-DOC03 — CLAUDE.md "Max upload size" wording [VERIFIED ACCURATE]

Line 209: `Max upload size: 200 MB per file; batch byte cap (\`UPLOAD_MAX_TOTAL_BYTES\`, default 2 GiB) and batch file-count cap (\`UPLOAD_MAX_FILES_PER_WINDOW\`, default 100) are separate limits that both apply to every upload`.

This is accurate and explicit about the dual-cap semantics (cycle 7/8 clarification).

Confidence: High.

### D10R-RPL-DOC04 — CLAUDE.md "Image Upload Flow" section lists flow as 5 steps [LOW / LOW]

Lines 109-115 describe the upload flow in 5 steps. Actual ordering is correct. Only quibble: "4. EXIF extracted" happens inside step 3's async queue worker, not as a discrete serial step. Minor.

Same observation as code-reviewer C10R-RPL-04. Low priority.

Confidence: Low.

### D10R-RPL-DOC05 — AGENTS.md is minimal (3 lines) [OK]

File: `AGENTS.md` (113 bytes). Contains minimal git workflow directive. Intentional — project-level directives are in CLAUDE.md.

Confidence: High.

### D10R-RPL-DOC06 — README.md and CLAUDE.md on JPEG "conversion" language [LOW / LOW]

README.md uses "optimization" language; CLAUDE.md uses "conversion". Both are technically accurate (Sharp does both). No drift.

Confidence: High.

## Summary

- 2 doc items ALREADY DONE (cycle 9 rpl AGG9R-RPL-04, AGG9R-RPL-05 — verified present).
- 1 minor wording nit carried from code-reviewer (C10R-RPL-04).
- No new drift detected.

**Primary action for cycle 10**: remove AGG9R-RPL-04 and AGG9R-RPL-05 from the deferred-items list in plan-218 carry-forward, mark them as completed.
