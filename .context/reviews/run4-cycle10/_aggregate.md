# Aggregate review — Run-4 Cycle 10

Per-angle provenance files in this directory:
- `security-reviewer-critic-verifier.md`
- `code-reviewer-debugger-tracer.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c9 — see `run4-cycle9/_aggregate.md`).
Each angle was executed as a distinct full-inventory pass in-context; no
angle sampled. Inventory this cycle: independent line-level regression
review of ALL five cycle-9 fix commits (`edac55f4`, `3adbd2d4`, `a46b8ca3`,
`d676e1aa` + SW version bump); rotation to the privacy-critical GPS-strip
parser ONE structural layer beyond the c9 ExtendedXMP fix (post-EOI JPEG
trailers); the auth/admin-delete + audit-FK surface; CSP/session/restore
re-checks; TWO empirical experiments that converted hypotheses into proven
defects — (1) a synthetic two-image JPEG through the real
`stripGpsFromJpegBuffer`, (2) the exact `deleteAdminUser` SQL sequence
against the live `gk-e2e-mysql` MySQL 8 — plus pattern sweeps (unguarded
`JSON.parse` ×5 all guarded, `parseInt` radix, server timers, EN/KO parity
826/826) and a LIVE production header probe of https://gallery.atik.kr.

## Context
C9 closed the ExtendedXMP overflow leak inside the primary image and the
timeline privacy-mirror drift. C10's two highest-signal findings are both in
freshly-hardened or rarely-exercised privilege/privacy surfaces and both were
provable only by constructing the adversarial shape rather than reading
happy-path tests: GPS hidden in a JPEG's post-EOI trailer (motion photo /
MPF), and the audit-FK that silently blocks deleting any admin who has logged
in.

## Cross-angle agreement
- **SEC-R4C10-01** — security (segment-walk `break` trace + empirical repro),
  code (rebuild-path verbatim trailer copy), test (suite blind to multi-image
  JPEGs), document (JPEG-coverage docblock overstates). Four angles, one root
  cause: the lossless scrubber is single-image-only but reports success on
  multi-image inputs.
- **COR-R4C10-01** — security/verifier (live MySQL errno-1451 repro), code
  (FK + delete-sequence trace), test (no admin-with-audit delete fixture),
  document (delete contract understated), designer (misleading
  `failedToDeleteUser` toast). Five angles, one root cause: `deleteAdminUser`
  never detaches the target's audit rows before the FK-guarded delete.

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| SEC-R4C10-01 | MED/High | GPS in a post-EOI JPEG trailer (MPF secondary / Samsung·Pixel Motion Photo) survives `stripGpsFromJpegBuffer` — the walker breaks at the first SOS/EOI and copies the trailer verbatim while returning `stripped:true`, so the stored original on the paid-download path keeps coordinates and the safe tier-2 re-encode never fires. Empirically proven (trailer GPSLatitude=37 SURVIVED). Fix: detect a non-trivial post-EOI trailer (first `FF D9` from the scan region) and return `null` → tier-2 re-encode drops it. | security, code, verifier, test, document |
| COR-R4C10-01 | MED/High | `deleteAdminUser` cannot delete any admin who has ever logged in: every `login_success` writes `audit_log(user_id=self)`, the FK is `ON DELETE NO ACTION`, and the delete touches `sessions` but not `audit_log` → errno 1451 → generic `failedToDeleteUser`. Empirically reproduced against live MySQL 8. Fix: `UPDATE audit_log SET user_id = NULL WHERE user_id = ?` inside the existing advisory-locked transaction before the admin delete (column already nullable — no migration). | security, code, verifier, test, document, designer |
| TEST-R4C10-01 | gap/High | GPS-strip suite has no post-EOI trailer fixture — folds into SEC-R4C10-01 | test |
| TEST-R4C10-02 | gap/High | No test deletes an admin with audit history — folds into COR-R4C10-01 | test |
| DOC-R4C10-01 | LOW/High | gps-exif-strip JPEG-coverage docblock omits trailer handling — folds into SEC-R4C10-01 | document |
| DES-R4C10-01 | LOW/High | admin-delete misleading `failedToDeleteUser` toast — resolved by COR-R4C10-01 fix | designer |

## Non-scheduled LOW observations (record in deferred ledger)
- **COR-R4C10-LOW-B** — `stripGpsFromOriginal` tier routing still trusts the
  user-supplied file extension (carried from DEF-R4C9-B; privacy never
  compromised — tier 2 strips all metadata; only mislabeled-file fidelity
  suffers). Unchanged this cycle. (code, LOW/Medium)
- **COR/DES-R4C10-LOW-C** — OnThisDay "today" is the server's calendar day
  (carried DEF-R4C9-A; inherent SSR limitation, product decision to fix).
  Unchanged this cycle. (designer, LOW/Medium)

## Regression review of cycle-9 commits
All five re-reviewed independently at line level: **sound** (per-commit
traces in the code + security angle files). The c9 ExtendedXMP read bounds
are correctly guarded; the timeline guard reuses the single exported
`PrivacySensitiveKeys` union; the SW lazy-revalidate keeps
`isSensitiveResponse` gating; OnThisDay OptimisticImage preserves the R20-M2
base-filename contract. The two residual defects found this cycle are NOT
regressions of the fixed behaviors — SEC-R4C10-01 is the next structural
layer of the same single-image-scrubber limitation, and COR-R4C10-01 is a
pre-existing FK gap in an unrelated surface.

## Gate baseline (clean tree)
- vitest **1739/1739 PASS** (181 files) · EN/KO parity 826/826
- typecheck / eslint / scanners / build / e2e: run during PROMPT 3 after fixes.

## HARD-SCOPE check
No finding proposes edit / culling / scoring / preset features. Both
scheduled fixes strengthen existing privacy/correctness guarantees on the
photographer-deliverable original and the admin-management surface.

## AGENT FAILURES
None. All angles completed in-context (single-subagent constraint documented
above); no spawn retries required.
