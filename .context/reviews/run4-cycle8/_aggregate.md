# Aggregate review — Run-4 Cycle 8

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md`
- `security-reviewer-critic-verifier.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c7). Each angle was executed as a
distinct full-inventory pass in-context; no angle sampled. Inventory
this cycle: independent regression review of all cycle-7 fix commits;
rotation to the LEAST-run-4-covered surfaces (photo-viewing client
stack: photo-viewer / lightbox / image-zoom / photo-navigation /
histogram / home-client / load-more; color pipeline core:
process-image full, color-detection, image-queue full); public pages
p/[id] + g/[key]; serve-upload + data.ts cursor machinery re-checks;
vendored Sharp 0.34.5 source verification; FOUR empirical experiments
(2× node/sharp GPS+format behavior, 1× ISOBMFF box walk, 1× live
Chromium playwright run covering probe decode / picture fallback /
preload fetch counts) that converted four hypotheses into facts;
pattern sweeps (parseInt radix, setInterval unref, IME census,
dangerouslySetInnerHTML, JSON.parse guards).

## Context
Run-4 c1-c5 saturated actions/API/admin-DB; c6 took interaction +
delivery; c7 took the paid-download journey. C8 rotated to the
photo-VIEWING stack and the color-pipeline core — the product's
premise surface — and found the cycle's highest-signal cluster there:
three separate "the feature is documented, reviewed, and DEAD"
defects (GPS strip, AVIF probe, picture fallback), each provable only
by executing the real dependency (Sharp / a real browser) rather than
reading code comments.

## Cross-angle agreement
- **COR-R4C8-01 (GPS strip inert + lossy)** — security (privacy leak on
  the paid path), code (Sharp API semantics), verifier (two empirical
  proofs), test (the derivative-only test illusion), document
  (docblock contradicts Sharp docs). Five angles, one root cause:
  `withMetadata()` keeps EXIF.
- **COR-R4C8-02 (dead AVIF probe)** — code (box walk), designer
  (audit-UI impact), test (no constant-validity pin), verifier
  (Chromium FAILS/LOADS A-B proof).
- **PERF-R4C8-03 (preload multi-fetch)** — perf (cost model), architect
  (dual-layer single-source violation), designer (mobile LCP), document
  (R13-H1 comment's false mechanism), verifier (request-count proof).
- **COR-R4C8-05 (picture fallback)** — code + designer + verifier
  (currentSrc/naturalWidth proof).

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| COR-R4C8-01 | HIGH/High | `strip_gps_on_upload` does not strip GPS from the stored original (`withMetadata` keeps EXIF — empirically proven) AND lossily re-encodes the paid-download original (jpeg q80 / heif q50 defaults). Fix: lossless byte-level GPS-IFD scrub for JPEG; metadata-free high-quality re-encode (autoOrient + keepIccProfile) for other formats; behavioral tests | security, code, verifier, test, document |
| COR-R4C8-02 | MED-HIGH/High | `AVIF_PROBE_DATA_URL` is structurally invalid (no iloc/av1C/mdat; bogus `pbal` box) — fails to decode in every browser, so the histogram's P3/AVIF audit path is permanently dead. Fix: valid sharp-generated 1×1 AVIF + decode-validity unit test | code, designer, test, verifier |
| PERF-R4C8-03 | MED-HIGH/High | Neighbor preloads multi-fetch: server hints (jpeg+avif+webp ×2 neighbors, fixed 1536, fetchPriority=high) + client responsive preloads (avif+webp) — Chromium fetches ALL (preload `type` gates MIME support only). Fix: drop server hints; client emits ONE format per neighbor via the (fixed) AVIF-support promise; source-contract tests | perf, architect, designer, document, verifier |
| COR-R4C8-04 | MED/High | Histogram canvas blanks when crossing the 768 px breakpoint — draw effect deps omit `canvasDims`; attribute change clears the buffer with no redraw. Fix: add dep + contract pin | code, designer |
| COR-R4C8-05 | MED/High | Lightbox + photo-viewer `<picture>` onError base-JPEG swap is ineffective while `<source>` rows match (proven: currentSrc stays the 404 AVIF) — legacy/mid-backfill photos render a broken-image glyph full-screen. Fix: state-driven source removal then base JPEG | code, designer, verifier |
| COR-R4C8-06 | LOW-MED/High | 8-bit AVIF per-image retry inherits `heifBitdepth: 10` from the cloned pipeline (sharp setters merge); documented fallback unsatisfiable. Fix: explicit `bitdepth: 8` | code |
| COR-R4C8-07 | LOW/Medium | WI-15 pixel gate mixes post-orientation width × pre-orientation height for rotated sources (mis-evaluates the 50 MP cap). Fix: `autoOrient: true` on the inputMeta read | code |
| QUAL-R4C8-08 | LOW/High | home-client dead `queryVersionRef` + misleading staleness comment (LoadMore owns the real guard). Fix: delete | code |
| DOC-R4C8-09 | LOW/High | CLAUDE.md default image-sizes drift (4 listed vs 6 actual incl. 5120/7680) + comment corrections folded into the fixes above | document |
| TEST-R4C8-10 | gap/High | No behavioral stripGps test (derivative-only illusion), no probe-validity pin, no preload single-format contract, no picture-fallback contract, no draw-deps pin. Folds into the fixes above | test |

## Non-scheduled LOW observations (recorded in the deferred ledger)
- Paid-download GET error bodies are unlocalized text/plain on a
  customer journey (designer #1; c7 deliberately preserved taxonomy).
- Interstitial double-submit navigates the loser to a plain 410
  (designer #2; integrity unaffected).
- ImageZoom passive-listener `preventDefault` no-ops produce Chromium
  intervention console noise; behavior correct via `touch-action: none`
  (designer #3).
- Dynamic Tailwind `columns-${n}` classes are safelisted only by a
  comment block (designer #4; cascade currently covers all clamps).

## Regression review of cycle-7 commits
All re-reviewed independently: **sound** (per-commit traces in the code
angle file; interstitial security re-audit in the security angle file).

## Gate baseline (clean tree)
- vitest 1701/1701 PASS (177 files) · typecheck PASS
- eslint / scanners / build / e2e: run during PROMPT 3 after fixes.

## HARD-SCOPE check
No finding proposes edit/culling/scoring/preset features. Every fix
restores an already-documented contract (GPS strip, P3 audit, preload
economy, fallback rendering). 10 findings → fix tasks + 4 recorded
LOW observations; security/correctness findings are scheduled, not
deferred, per the non-deferrable rule.

## AGENT FAILURES
None. Nested-agent spawning unavailable in the subagent context
(documented constraint, same as run2/run3/run4-c1..c7); all angles
executed in-context with full inventory and per-angle provenance files
above.
