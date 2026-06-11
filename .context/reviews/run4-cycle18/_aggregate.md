# Aggregate review — Run-4 Cycle 18

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md`
- `security-reviewer-critic-verifier.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent;
nested Agent/Task spawning is unavailable in this context (same
documented constraint as run2/run3/run4-c1..c17). Each angle was
executed as a distinct full-inventory in-context pass; no angle
sampled. Inventory: line-level regression review of the three
cycle-17 fix commits (`c6091f2f`, `3b88cf97`, `68c9eb0c`); rotation
to the lowest-run-4-coverage surfaces by a fresh mention-count map
over run4-c1..c17 review texts — the **feeds cluster** (atom-feed,
feed-conditional, both feed.xml routes, sitemap), the **i18n/nav/
theme glue** (i18n-provider, nav-client, theme-provider,
locale-path), the **micro-libs** (backup-filename, download-filename,
upload-filenames, tag-records, tag-slugs, base56, download-tokens,
exif-datetime, action-result, csp-nonce, feature-flags), the **CLIP
cluster** (clip-embeddings, clip-inference, semantic route,
embeddings action), the **payments cluster** (stripe.ts,
license-tiers, checkout/download/webhook routes, sales action,
download-interstitial), **actions** settings/sharing, static shells
(not-found, icon, apple-icon), and the security micro-libs (audit,
mysql-cli-ssl, password-hashing).

## Context

C17 closed the OG charged-failure divergence. C18's rotation landed
on the feeds + payments clusters and found the run's recurring shape
twice more: a surface that bypasses the framework's shared guard
(route handlers bypass both the dotted-path middleware matcher AND
the layout locale gate) and a partially-applied cross-check (the
webhook SELECTs the image but only uses it for a warn, leaving the
FK-doomed INSERT to 500 into a Stripe retry loop).

## Cross-angle agreement

- **COR-R4C18-01** — code/tracer (primary; matcher + layout bypass
  trace), security (injection ruled out — escapeXml covers; endorses
  404), architect (records the "dotted routes self-validate locale"
  rule), test (TEST-R4C18-01 lock shape). **4/6 angles.**
- **COR-R4C18-02** — code/debugger (primary; FK + catch-all 500
  trace), security/verifier (availability not attack surface;
  signature-gated; endorses 200-permanent taxonomy), architect
  (TOCTOU requires the FK-specific catch), test (TEST-R4C18-02).
  **4/6 angles.**
- **DOC-R4C18-03 (+SEC-R4C18-04)** — document-specialist (primary),
  security/critic (adjudicated checkout/semantic as deliberately
  Pattern 2 — document, don't flip), architect (header is the
  pattern registry; c17 proved examples propagate). **3/6 angles.**

## Merged finding list

| ID | Sev/Conf | Title | Source angles | Disposition |
|----|----------|-------|---------------|-------------|
| COR-R4C18-01 | **MED-LOW/High (CONFIRMED)** | Topic feed route accepts ANY locale segment — `[locale]/(public)/[topic]/feed.xml/route.ts:32` never validates `locale`; the middleware matcher (proxy.ts:140) skips dotted paths and route handlers bypass the layout `notFound()` gate (layout.tsx:83). `GET /kr/{topic}/feed.xml` → 200 feed whose alternate + every entry link 404s for all subscribers, CDN-cached per arbitrary locale string. Fix: `isSupportedLocale(locale)` → 404 before DB work + source-contract lock. | 4/6 | SCHEDULE |
| COR-R4C18-02 | **MED/Medium-High (CONFIRMED)** | Stripe webhook paid-session-for-deleted-image → FK-violation INSERT (`entitlements.image_id` NOT NULL, schema.ts:280) → catch returns 500 → Stripe retries for days, every retry failing; no entitlement, no audit trail, ops noise. The route already SELECTs `currentImage` (route.ts:257) but only warns on tier drift. Fix: `!currentImage` → error-log (sessionId/imageId/tier/amount, "manual refund required") + 200; FK-specific `ER_NO_REFERENCED_ROW_2` catch (helper exists in lib/validation.ts) → same 200, covering the SELECT→INSERT race. Transient-DB 500 path preserved. | 4/6 | SCHEDULE |
| TEST-R4C18-01 | gap/High | feed-sized-derivative suite has no locale-validation lock — add source-contract assertions with the fix, proven failing pre-fix. | test | SCHEDULE (with COR-R4C18-01) |
| TEST-R4C18-02 | gap/Medium-High | stripe-webhook-source suite has no deleted-image lock — extend with the 200-permanent + FK-catch assertions; keep the transient-500 assertion. | test | SCHEDULE (with COR-R4C18-02) |
| DOC-R4C18-03 | LOW/High (CONFIRMED) | rate-limit.ts:1-31 header still says "Three rollback patterns"; the c17 charged-post-validation posture exists only in the rollbackOgAttempt docstring. The header is the registry new routes consult — the omission re-seeds the exact c17 divergence. Fix: add Pattern 4 + name the buckets, including WHY checkout/semantic deliberately remain Pattern 2 (SEC-R4C18-04 rationale). Comment-only. | 3/6 | SCHEDULE |
| SEC-R4C18-04 | LOW-MED/Medium | Checkout (route.ts:112-133) and semantic (route.ts:192,205) refund post-DB paths — the shape c17 eliminated on OG. Adjudicated DELIBERATE: their limiters guard the Stripe API budget / embedding CPU, which the refunded branches never consume; image existence/tier are public on /p/{id}; no fetch-amplification analogue. No behavior change; the distinction lands in DOC-R4C18-03's Pattern-4 text. | security, critic, architect | RECORD (decision documented via DOC-R4C18-03) |
| OBS-R4C18-A | LOW/High | Feed routes duplicate ~90 lines; R25-M1 (and now COR-R4C18-01) prove lockstep-edit cost. | perf/architect | DEFER (exit: next functional feed-route change or a third feed surface) |
| OBS-R4C18-B | INFO | Checkout `parseInt` accepts `12abc` (vs OG strict digits) — harmless; note for next edit of the file. | code | RECORD |
| OBS-R4C18-C | INFO | `clampSemanticTopK(null)` → 1 not default (Number(null)=0). Hand-crafted JSON only. | code | RECORD |
| OBS-R4C18-D | INFO | Empty-feed `<updated>` = request time → 304 never fires until first photo. Self-healing. | code | RECORD |
| OBS-R4C18-E | LOW-MED/High | `entitlements` cascade-deletes with the image — deleting a sold photo silently destroys sale records (email/session/amount) and invalidates un-downloaded paid tokens. Documented US-P54 design; paid flow is still a pre-email-pipeline scaffold. | code, security | DEFER (exit: paid downloads enter real production use — email pipeline ships or first real sale; then decide RESTRICT vs soft-delete) |
| NOTE-R4C18-D1 | INFO | Theme-cycle button announces action not state — same class as the histogram mode-cycle standing deferral (plan-286); folded there, not duplicated. | designer | RECORD (fold into existing deferral) |

## Regression review of cycle-17 commits — SOUND

All three fix commits verified line-level against the live tree (two
rollbacks both pre-DB + flipped lock; labels/toast/i18n keys; generic
-key warnings with no value echo). No follow-on findings.

## Clean-pass surfaces this cycle

Full lists in the per-angle files. Highlights: atom-feed RFC
conformance (incl. the Person-construct fix lineage); feed-conditional
RFC 7232 second-precision; locale-path; photo-title; image-url;
base56 rejection sampling; download-tokens constant-time chain;
download route's open-before-claim ordering with handle hygiene on
all failure paths; webhook's signature→paid→shape→allowlist→zero
-amount→idempotency chain (insertId disambiguation); sales refund
convergence; sharing dual-bucket symmetric rollback; settings
contract-lock finally-release; CLIP stubs + mode-gated semantic
route; sitemap ISR + build-time fallback; audit purge negative
-retention guard; mysql-cli-ssl; password-hashing shared policy;
nav-client/not-found/interstitial a11y (44 px, ARIA, color-scheme).

## Standing deferrals re-audit (exit criteria)

Diff since the c17 review commit (`c2aa4617..HEAD`) touches the c17
fix surfaces + plan/SW stamps only — no deferral surface modified:
- DEF-R4C17-A (OG loopback fetch), DEF-R4C17-B (caption stub slice) —
  un-triggered; carried.
- DEF-R4C16-A (`db/seed.ts` owner sign-off), DEF-R4C16-B (manifest
  dark splash) — un-triggered; carried.
- DEF-R4C15-A (map clustering), DEF-R4C15-B (loading.tsx
  sessionStorage) — un-triggered; carried.
- RISK-R4C14-03 + TEST-R4C14-02 (iOS 17+ dimg-only gain-map fixture)
  — un-triggered; carried.
- DEF-R4C11-A; DEF-R4C10-A/B; DEF-R4C1-01/DEF-R4C2-01/DEF-R4C3-01 (LR
  PAT — no LR change); OPS-R4C6-01 (host nginx); DEF-R4C8-A/B/C/D;
  histogram mode-cycle aria-label (NOTE-R4C18-D1 folds in);
  OBS-R4C12-B/C/D/E; DOC-R4C13-01/02 — all un-triggered; carried.

## Gate baseline (clean tree)

Cycle-17 close: all 8 gates green; deploy verified live (SW
`68c9eb0c-p7`). All 8 gates re-run during PROMPT 3 after this cycle's
fixes land.

## HARD-SCOPE check

No finding proposes edit / culling / scoring / preset features. All
scheduled fixes tighten existing surfaces: route-handler input
validation parity (feed locale), payment-webhook failure taxonomy
(deleted-image 200), and the rate-limit pattern registry.

## AGENT FAILURES

None — all six angle passes completed (single-subagent in-context
execution; no nested agent spawns attempted because the Agent tool is
unavailable in this environment, per the documented run-wide
constraint).
