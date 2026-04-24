# Critic — Cycle 14 (current run)

**Reviewer:** critic (multi-perspective challenge of the whole change surface)
**Scope:** Sanity-check whether cycles 12-13's "zero findings" verdict is honest, plus the historical 2026-04-19 cycle 14 findings.

## Methodology

Tried to break the consensus:
- Cross-checked the cycle 13 aggregate's "areas reviewed with no new issues" list against the actual files I read this cycle.
- Re-walked the 2026-04-19 historical findings to see which still apply to current code.
- Looked for emerging risks introduced by the recent doc-only commits (none — they are .md files only).
- Inspected the deploy script and nginx config — orchestrator-flagged under-covered areas.

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| (none new) | The convergence verdict is honest. Recent commit history is doc-only (cycles 12 and 13's bookkeeping commits, plus this cycle 14's pending bookkeeping commit). | — | — | — |

### Historical findings re-evaluated

- **CRI-14-01 (`publicSelectFields` decorative).** Already fixed — current `data.ts:161-181` destructures into a NEW object via destructure-omit. The compile-time guard `_privacyGuard` (line 198-200) enforces sensitive keys never leak. The fix moves the privacy split from "decorative" to "real defense-in-depth." NO ACTION.
- **CRI-14-02 (tracker negative).** Already fixed — `settleUploadTrackerClaim` clamps via `Math.max(0, ...)` in `lib/upload-tracker.ts:23-24`. NO ACTION.
- **CRI-14-04 (`getTagSlug` duplicated).** Already fixed — `getTagSlug` is now imported from `lib/tag-records.ts` (no inline duplicate in `images.ts`). NO ACTION.
- **CRI-14-05 (`getImageByShareKey` missing `blur_data_url`).** Re-verified: `data.ts:558-560` still missing `blur_data_url`. Genuine LOW-severity UX inconsistency. DEFER.
- **CRI-14-03/07/09.** Re-checked, all NO ACTION (already fixed or naming-only).

### Challenges I tried, all resolved

1. **"Maybe the deploy script leaks credentials."** `scripts/deploy-remote.sh` sources `.env.deploy` (gitignored), uses `printf %q` to escape, exec's `bash -lc`. Not exploitable.
2. **"Maybe nginx XFF spoofing bypasses rate limits."** `getClientIp` walks the chain right-to-left with `proxy_add_x_forwarded_for`. Defended.
3. **"Maybe storage backend switching has a race."** `lib/storage/index.ts` defers disposing the old backend until the new one's init resolves. Internally consistent.
4. **"Maybe the audit log can OOM on huge metadata."** `lib/audit.ts:24-29` truncates at 4096 bytes. Defended.
5. **"Maybe the drizzle migration ordering breaks idempotency."** Single `ALTER TABLE images ALTER COLUMN processed SET DEFAULT false` in `0002_fix_processed_default.sql` is idempotent at MySQL 8.

## Verdict

Convergence is real. No "manufactured" finding.
