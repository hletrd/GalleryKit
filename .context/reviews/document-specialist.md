# Document Specialist — Cycle 7 (review-plan-fix loop, 2026-04-25)

## Lens

Doc drift, lineage comments, public-facing docs vs. implementation.

## Findings

### C7L-DOC-01 — `validation.ts:21-32` lineage is comprehensive after C6L
- File: `apps/web/src/lib/validation.ts:21-32`
- Severity: INFO
- Confidence: Low
- Status: Lineage now lists six entries. Cycle 7 added no new Unicode-policy surface; list does not grow this cycle. **No change needed.**

### C7L-DOC-02 — `CLAUDE.md` accurately documents single-instance topology and AGG8R-05 advisory-lock scoping
- File: `CLAUDE.md`
- Severity: INFO
- Confidence: High
- Status: Confirmed. No drift this cycle.

### C7L-DOC-03 — `upload-tracker.ts:14` parameter naming
- File: `apps/web/src/lib/upload-tracker.ts:14-19`
- Severity: INFO
- Confidence: Medium
- Issue: Function signature documents `ip: string` as the third positional parameter, but actual key used by callers is `${userId}:${ip}`. Renaming `ip` → `key` would self-document.
- Fix: Cosmetic rename if cycle has time; otherwise defer.
