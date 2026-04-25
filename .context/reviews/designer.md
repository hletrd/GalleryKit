# Designer — Cycle 7 (review-plan-fix loop, 2026-04-25)

## Lens

UI/UX, accessibility, error messaging, internationalization. Findings from the cycle-8 designer pass that remain open are tracked in their own deferred plans; this cycle re-checks status without re-running the browser harness.

## Findings

### C7L-UX-01 — `invalidTagNames` error is generic and does not say which tag was bad
- File: `apps/web/src/app/actions/images.ts:147-149`
- Severity: LOW
- Confidence: Medium
- Issue: Admin uploads with five tags, one bad → entire upload aborts with no signal which tag was bad. UX hurt: admin must guess which tag failed validation.
- Fix: Optionally include the rejected tag(s) in the error message or warning. Defer if i18n churn is high.

### C7L-UX-02 — Partial-success on uploads silently buries `failedFiles`
- File: `apps/web/src/app/actions/images.ts:410-415`
- Severity: INFO
- Confidence: Medium
- Issue: Returning `success: true` with a `failed` array can mislead UI to show a cheerful success toast even when half the batch failed.
- Status: Pre-existing; UI side likely already surfaces the array. No change this cycle without a UI audit.

### C7L-UX-03 — Restore-maintenance toasts are uniform across actions
- File: every action's `getRestoreMaintenanceMessage(t('restoreInProgress'))` call
- Severity: INFO
- Confidence: High
- Status: Consistent; admins see the same message across all surfaces. Good.

### C7L-UX-04 — i18n keys for new validations
- File: `apps/web/messages/en.json`, `ko.json`
- Severity: INFO
- Confidence: Medium
- Status: All Unicode-rejection error keys (`invalidLabel`, `invalidTitle`, `invalidDescription`, `seoTitleInvalid`, etc.) are in place from earlier cycles. No new gaps detected.

## Carry-forwards from cycle-8 designer pass

- UX8-01 admin auth heading, UX8-02 mobile photo info sheet focus, UX8-03 duplicate H1, UX8-04 admin dashboard responsive table, UX8-05 CSP nonce on theme script, UX8-06 RTL — most have been addressed in commits e715bde / 1312d29 / 5d774b1. No new UX regressions surfaced this cycle.
