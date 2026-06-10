# Aggregate review — Run-4 Cycle 9

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md`
- `security-reviewer-critic-verifier.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent;
nested Agent/Task spawning is unavailable in this context (same
documented constraint as run2/run3/run4-c1..c8). Each angle was
executed as a distinct full-inventory pass in-context; no angle
sampled. Inventory this cycle: independent line-level regression
review of ALL cycle-8 fix commits (the 515-line `gps-exif-strip.ts`
binary parser as priority target — brand-new privacy-critical code);
rotation to the LEAST-run-4-covered surfaces: service-worker stack
(sw.template.js full + build-sw + register-service-worker +
serve-upload header contract), timeline/OnThisDay stack
(data-timeline.ts + on-this-day-widget + map GPS surface), public
worker JS (histogram-worker), upload-tracker, entrypoint.sh; ONE
empirical experiment (synthetic ExtendedXMP JPEG through the real
scrubber) that converted a hypothesis into a proven privacy defect;
pattern sweeps (unguarded JSON.parse, parseInt radix, Math.random,
setInterval unref, i18n en/ko parity 826/826).

## Context
C8 fixed the GPS-strip inertness with new byte-surgery code; c9's
highest-signal finding is the residual gap in exactly that new code —
provable only by constructing the adversarial container shape
(ExtendedXMP) rather than reading the happy-path tests. The SW image
strategy's documented 304 economy was also proven not to exist
(eager fetch), and the home page ships multi-MB thumbnails for 48-px
tiles.

## Cross-angle agreement
- **SEC-R4C9-01** — security (paid-path GPS leak), code (dropXmp
  trigger trace), verifier (empirical repro), test (suite
  structurally blind to the shape), document (header claim made true
  by the fix). Five angles, one root cause: only std-XMP packets are
  token-tested.
- **PERF-R4C9-02** — perf (per-view churn cost model), architect
  (meta R/W race multiplier), document (false R11-M1 comment).
- **PERF-R4C9-03** — perf (bytes), designer (mobile data/INP),
  architect (OptimisticImage is the existing right-shaped component).

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| SEC-R4C9-01 | MED-HIGH/High | GPS carried only in ExtendedXMP APP1 segments survives `stripGpsFromJpegBuffer` (std packet with `HasExtendedXMP` pointer → `stripped:false`; empirically proven). Stored original on the paid-download path retains coordinates while DB looks clean. Fix: token-test ext-XMP segments (per-segment + concatenated reconstruction), reuse existing drop pass; behavioral regression tests | security, code, verifier, test, document |
| PERF-R4C9-02 | MED/High | sw.template.js starts the revalidate GET eagerly (line 149) — the documented R11-M1 "304 short-circuits the revalidate body fetch" does not exist. Per repeat view: redundant cache.put of identical bytes + full LRU-meta JSON rewrite (×N concurrent on gallery pages), and after the 1 h TTL a doubled network roundtrip. Fix: lazy revalidate closure; on 304 serve cached + touch LRU timestamp only; comment becomes true | perf, architect, document |
| PERF-R4C9-03 | MED-LOW/High | OnThisDay widget loads full-resolution base JPEG (2-6 MB) per 48-px thumbnail ×6 on the home page. Fix: OptimisticImage client island with smallest-size src + base-JPEG fallbackSrc (R20-M2 legacy-row correctness preserved) | perf, designer, architect |
| TEST-R4C9-04 | MED(gap)/High — **UPGRADED during PROMPT 3 to a live MED/High contract violation** | `timelineSelectFields` privacy mirror has NO compile-time guard and NO fixture pin (unlike data.ts). Implementation found the predicted drift had ALREADY happened: `color_space` and `bit_depth` (admin-only per R27-CP-HIGH-1 / R8-H3) were still selected on every public timeline / year-in-review / OnThisDay request (no consumer rendered them — select-layer violation, zero wire serialization observed). Fix: remove both fields (zero-behavior-change), add the data.ts-style type guard against the exported `PrivacySensitiveKeys`, extend the privacy fixture suite with omit + subset-of-public pins | test, security |
| TEST-R4C9-05 | gap/High | GPS-strip suite has no ExtendedXMP fixture (all XMP cases put GPS in the std packet) — folds into SEC-R4C9-01 | test |
| DOC-R4C9-05 | LOW/High | sw.template.js 304-short-circuit comment is false — folds into PERF-R4C9-02 | document |

## Non-scheduled LOW observations (to record in the deferred ledger)
- **DES-R4C9-B** — OnThisDay "today" is the server's calendar day
  (UTC in the shipped compose); KST visitors see the previous day's
  anniversaries until 09:00 local (LOW/Medium, designer).
- **COR-R4C9-LOW-A** — `stripGpsFromOriginal` tier routing is by
  user-supplied extension: PNG bytes named `.jpg` get a lossy q95
  JPEG re-encode (alpha flattened) and an APNG re-encode keeps only
  the first frame, when strip_gps is enabled (LOW/Medium, code).

## Regression review of cycle-8 commits
All re-reviewed independently at line level: **sound** (per-commit
traces in the code angle file; call-site ordering and parity verified
in the security angle file). The one residual defect found
(SEC-R4C9-01) is a coverage gap in the new code, not a regression of
the fixed behaviors.

## Gate baseline (clean tree)
- vitest 1729/1729 PASS (181 files) · typecheck PASS
- eslint / scanners / build / e2e: run during PROMPT 3 after fixes.

## HARD-SCOPE check
No finding proposes edit/culling/scoring/preset features. Every fix
restores or enforces an already-documented contract (GPS strip
completeness, SW revalidation economy as documented, R20-M2 thumbnail
correctness at honest byte cost, the data.ts privacy-guard pattern).
4 fix clusters + 2 recorded LOW observations; the security finding is
scheduled, not deferred, per the non-deferrable rule.

## AGENT FAILURES
None. Nested-agent spawning unavailable in the subagent context
(documented constraint, same as run2/run3/run4-c1..c8); all angles
executed in-context with full inventory and per-angle provenance
files above.
