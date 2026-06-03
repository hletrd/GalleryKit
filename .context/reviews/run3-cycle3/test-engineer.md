# Test-engineer review — Run-3 Cycle 3

## Existing LR-path coverage
- `src/__tests__/lr-upload-hdr-gate.test.ts` — source-contract test locking the
  HDR gate + GPS-strip wiring on the PAT route. This is the established pattern
  (per `stripe-webhook-source.test.ts`, `og-route-source-contracts.test.ts`)
  for guarding the heavy multipart+Sharp+DB+queue route against refactor drift.

## TE-C3-01 (gap) — no contract test locks `icc_profile_name` / `uploaded_by` parity
The cycle-3 fixes (SEC-C3-01, SEC-C3-02) must be locked by extending the
existing source-contract test so a future refactor can't silently re-drop them:
- Assert the PAT route insert sets `icc_profile_name: data.iccProfileName`.
- Assert the PAT route does NOT write `color_space: data.iccProfileName` (i.e.
  `color_space` is sourced from `exifDb`, matching the browser path).
- Assert the PAT route sets `uploaded_by` from the verified token user id.
This keeps the divergence-cluster guardrail growing in lockstep with the fixes,
matching the cycle-1/cycle-2 precedent.

No other test gaps surfaced this pass; i18n parity 812/812.
