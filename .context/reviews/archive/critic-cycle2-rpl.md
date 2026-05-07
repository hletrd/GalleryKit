# critic — cycle 2 rpl

HEAD: `00000006e`.

## Multi-perspective critique
Having re-read the entire change surface, the cycle 1 rpl work is solid: the same-origin default is now fail-closed, password-change rate limit clears only after commit, admin chrome is skipped on login, normalized values are returned + rehydrated, and the seed scripts are corrected. The lint:api-auth gate exists, the privacy contract is enforced with a compile-time guard, and EXIF/ICC parsing has bounds checks.

But two orthogonal patterns are still uneven on HEAD and warrant pushback:

### CRIT2R-01 — Same-origin enforcement is uneven across the server-action surface
- **Observation:** cycle 1 rpl correctly fixed `login` and `updatePassword` to require explicit origin metadata, and the `/api/admin/db/download` route already opts into `allowMissingSource: false`. Every other mutating server action — `deleteImage`, `deleteImages`, `updateImageMetadata`, `createTopic`, `updateTopic`, `deleteTopic`, `createAdminUser`, `deleteAdminUser`, `updateSeoSettings`, `updateGallerySettings`, `updateTag`, `deleteTag`, `addTagToImage`, `removeTagFromImage`, `batchAddTags`, `batchUpdateImageTags`, `createPhotoShareLink`, `createGroupShareLink`, `revokePhotoShareLink`, `deleteGroupShareLink`, `restoreDatabase`, `dumpDatabase`, `exportImagesCsv` — relies on `isAdmin()` only. The framework-level CSRF guard is a moving target across Next.js majors and, if removed/weakened, the defense-in-depth asymmetry here becomes a single hinge.
- **Critique:** calling this "deferred" in D1-02 is consistent with repo policy (AGENTS.md: keep diffs small), but the deferral has now carried through 7 review cycles. Recommend scheduling it explicitly next cycle, as a single mechanical refactor, rather than re-deferring cycle after cycle.
- **Severity / confidence:** MEDIUM / MEDIUM.

### CRIT2R-02 — `unstable_rethrow` usage is inconsistent across the server-action surface
- **Observation:** only `login` in `auth.ts` uses `unstable_rethrow`. Every other catch block (including `updatePassword`, all of `images.ts`, `topics.ts`, `tags.ts`, `sharing.ts`, `admin-users.ts`, `seo.ts`, `settings.ts`) swallows all errors. Next.js uses thrown sentinel errors (`NEXT_REDIRECT`, `NEXT_NOT_FOUND`, dynamic-bailout signals) to drive control flow from server code; suppressing them silently breaks redirect/notFound semantics when added later.
- **Critique:** the pattern in `login` proves the repo author knows about `unstable_rethrow`. Either it should be applied everywhere (single 1-line line in each outer catch) or the use in `login` is the outlier and should be removed. Inconsistency is the bug — it indicates none of the other actions have been stress-tested against control-flow signals.
- **Severity / confidence:** LOW / HIGH.

### CRIT2R-03 — The plan directory is a graveyard of 170+ cycle-specific files
- **Observation:** `plan/` has 170+ files with overlapping semantics (`cycle1-fixes`, `cycle1-ultradeep`, `cycle1-rpl`, `cycle1-performance`, `cycle1-review`, plus subscribed `deferred-cycle*`). Index file is `README.md`. Active/deferred split in `plan/cycle1-rpl-review-fixes.md` and `plan/cycle1-rpl-deferred.md` is good; but historical context is spread across dozens of barely-differentiated files.
- **Critique:** this is a process-hygiene issue, not a code issue. The aggregate index is maintainable, but would benefit from a single-snapshot deferred register that supersedes every earlier cycle-specific deferred file. Current approach accretes; the archive policy in `plan/done/` is working, so this is not urgent.
- **Severity / confidence:** LOW / MEDIUM. Informational only.

## Cross-cutting risks to watch for next cycle
1. When the mutation-surface origin check is finally scheduled, make sure the check is added BEFORE any expensive DB/IO work (not after `isAdmin`) so rate-limit semantics stay consistent with the login path.
2. If `unstable_rethrow` is added to every catch, run the full e2e suite to confirm no action accidentally relies on swallowing the internal signal for a toast-style fallback.

## Summary
Two meaningful meta-level findings (CRIT2R-01, CRIT2R-02), each agreeing with code-reviewer + security-reviewer output.
