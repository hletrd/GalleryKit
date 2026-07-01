# Cycle 94 Code-Quality Review

Review target: `33eca7b5e4102bd5097777dbb926ee2cb94c6d71`

## Inspected Files

- `AGENTS.md`
- `CLAUDE.md`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/__tests__/client-source-contracts.test.ts`
- `apps/web/src/__tests__/load-more-source-contracts.test.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

## Findings

### MEDIUM: Server-side token-label validation still reports as toast-only feedback

- File/lines: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:64`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:188`, `apps/web/src/app/actions/lr-tokens.ts:55`
- Confidence: High
- Failure scenario: The client now associates the empty-label error with `#token-label`, but only on the local `!newLabel.trim()` branch. If an admin pastes a non-empty label containing rejected Unicode formatting/control characters, `createLrToken()` sanitizes it and returns `lrTokenInvalidLabel`; the client handles every server-side create failure with only `toast.error(result.error)`. The dialog remains open, but `labelError` is not set, `aria-invalid` stays false, and the `role="alert"` field error is absent. Screen-reader/keyboard users therefore still get an unassociated toast-only validation failure for a real label-validation path.
- Suggested fix: Return or derive a structured field error for token label validation and call `setLabelError(result.error)` for that branch before showing the toast. Keep non-field failures such as unauthorized, maintenance, or generic create failure as global errors. Add a regression test that covers the server-invalid-label path, not only the empty-label source shape.

## Validation

Static review only. I did not run tests because this review was constrained to a single write path for the output artifact.
