# Aggregate review — Run-3 Cycle 3 (PAT upload divergence cluster, final pass)

Multi-angle review (security/correctness, code, test-engineering, perf, designer,
architect, doc-consistency) conducted directly. The PAT upload path was audited
constraint-by-constraint against `uploadImages()` per the cycle directive.
Per-angle provenance: `security-reviewer.md`, `code-reviewer.md`,
`test-engineer.md`.

## Headline: the PAT divergence cluster is now FULLY enumerated

Most constraints reach the PAT path for free through the shared
`saveOriginalAndGetMetadata` helper: **per-file 200 MB cap, empty-file
rejection, decompression-bomb `limitInputPixels`, RAW rejection (rejection
itself), and SAFE_SEGMENT/UUID filename sanitization are all at PARITY** because
both paths funnel through that one helper. The cycle-1 (HDR gate) and cycle-2
(on-disk GPS strip) fixes closed the two material gaps. This cycle confirms the
remaining divergences are: two MED metadata-integrity bugs, one LOW
correctness-invariant gap, one LOW cosmetic message gap, plus the 3 already-
documented LOW deferrals.

## Actionable findings (dedup'd, highest severity/confidence preserved)

| ID | Sev/Conf | Cross-agent | Summary |
|----|----------|-------------|---------|
| SEC-C3-01 | **MED / High** | security, doc | PAT route omits `icc_profile_name` AND pollutes `color_space` with the ICC name (CLAUDE.md says `color_space` is NOT the ICC name). Browser path: `icc_profile_name: data.iccProfileName` + `color_space` from `exifDb`. **Fix this cycle.** |
| SEC-C3-02 | **MED / High** | security | PAT route leaves `uploaded_by` NULL though `tokenUserId` is known → Atom per-entry `<author>` attribution dead on the primary non-browser ingest. **Fix this cycle.** |
| CR-C3-01 | LOW / Med | code, architect | PAT route does not acquire `gallerykit_upload_processing_contract` lock → first-image-vs-`image_sizes`-change race the lock exists to prevent. Cheap to mirror. **Fix this cycle (cheap parity).** |
| CR-C3-02 | LOW / High | code | PAT route collapses `RawFileError` into a generic 422 instead of the specific "RAW not supported" message. Rejection still happens; only the message diverges. **Fix this cycle (one-line `instanceof`).** |
| TE-C3-01 | gap | test | Extend `lr-upload-hdr-gate.test.ts` to lock `icc_profile_name`/`uploaded_by`/`color_space`/contract-lock parity. **Do with the fixes.** |

## Already-deferred (carried, severity preserved) — re-evaluated, deferral still valid

From `.context/plans/run3-cycle2/_deferred.md`:
- **DEF-C2-01** (LOW) restore-maintenance window not checked on PAT path — re-eval:
  the contract-lock fix (CR-C3-01) does NOT cover restore maintenance (separate
  process-local flag). Deferral rationale (single-writer, short windows, trusted
  scope) holds. **Remains deferred.**
- **DEF-C2-02** (LOW) 1 GB disk pre-check skipped — UX-only; ENOSPC surfaces as a
  clean 422. **Remains deferred.**
- **DEF-C2-03** (LOW) cumulative upload-tracker window not enforced on PAT path —
  per-IP anonymous-abuse control, doesn't map to a trusted PAT. **Remains
  deferred.** Note: this is distinct from CR-C3-01 (contract lock) which IS being
  fixed.

## Net-new sweep (non-PAT surfaces) — no new findings
- i18n key parity en↔ko: 812/812, zero drift.
- serve-upload / share routes / Stripe webhook / auth-rate-limit / DB restore:
  no net-new issues this pass (exhaustively covered in R27-R29 + run2 cycles).

## SCOPE GUARD
No finding proposes edit/culling/scoring/develop/preset features. All findings
are faithful-delivery / metadata-integrity / parity hardening — in scope.

## AGENT FAILURES
None. The project agent registry is minimal (no `.claude/agents/` reviewer set;
only a global `perf-reviewer.md`); the review was conducted directly across all
mandated angles rather than spawning unregistered subagent types, which would
have silently no-op'd. All angles covered; aggregate written.
