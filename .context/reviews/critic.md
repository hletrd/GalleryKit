# Critic Deep Review — Run 5 Cycle 1 (Whole-State, Multi-Perspective)

Reviewer: oh-my-claudecode:critic
Date: 2026-06-11
Scope: Whole current state of GalleryKit (apps/web). Focus per assignment: product-coherence gaps,
doc↔code drift, risky assumptions, half-finished features (storage abstraction, HDR WI-09, CLIP
embeddings, Stripe entitlements, Lightroom PATs, smart collections, auto alt-text), operational
risk (single-writer topology, in-memory state, deploy pipeline), and blind spots the prior 20
cycles plausibly anchored past.

## Mode

Operated in THOROUGH mode. Did NOT escalate to ADVERSARIAL: the security-critical surfaces
(Stripe webhook, paid-download, LR PAT upload, semantic route, smart-collection compiler) are
unusually well-hardened — dozens of cited prior-cycle fixes, defense-in-depth, fail-closed
patterns throughout. The findings below are concentrated in the HALF-FINISHED / STUB feature
seams the prior photographer-anchored cycles toured less, exactly where the assignment pointed.

## Pre-commitment Predictions (made before deep reading)

1. CLIP/semantic public route is a stub but reachable in some config → **CONFIRMED (CRT-R5C1-01)**.
2. Stripe webhook signature/refund/async edge cases → checked, found robust. Not a finding.
3. Lightroom PAT upload weaker than admin routes → checked, found at PARITY with browser path. Not a finding.
4. Smart-collection executes admin-controlled query fragments on a public page → checked,
   parameter-bound + allowlisted + processed-gated + is_public-gated. Not a finding.
5. Storage abstraction partially wired and leaks → checked, ZERO non-test imports. Genuinely
   unintegrated, matches docs. Not a finding (but see CRT-R5C1-05 for the doc-debt angle).

Net: the predicted Stripe/PAT/smart-collection hazards were already closed by prior cycles. The
real residue is in the STUB ML features (semantic search, auto alt-text) and dead feature-flag
scaffolding — the surfaces that were added late and reviewed least.

---

## CRITICAL Findings

### CRT-R5C1-01 — `semantic_search_mode = 'production'` is selectable in admin UI but serves RANDOM stub results to the public
- Severity: **CRIT** · Confidence: **High** · Classification: **confirmed**
- Evidence:
  - `src/app/api/search/semantic/route.ts:18-19` docblock: "WARNING: The stub encoder returns
    RANDOM results. Do NOT enable semantic_search_mode in production until the stub is replaced
    with real ONNX inference."
  - `route.ts:169-174` only rejects when mode `!== 'production'`. When mode **is** `'production'`,
    the route proceeds to `embedTextStub(query)` (`route.ts:190`).
  - `src/lib/clip-inference.ts` is a pure stub: `deterministicEmbedding` from a SHA-256 of the
    input. `embedTextStub` produces a vector with **no semantic relationship** to image content.
  - `src/app/[locale]/admin/(protected)/settings/settings-client.tsx:540` renders
    `<SelectItem value="production">` — an admin can pick it. The only guard is a soft amber
    paragraph (`settings-client.tsx:544-548`) reading "search results will be semantically random"
    (`messages/en.json:727`). Nothing in code prevents the selection or the save.
  - `gallery-config-shared.ts:168` validator ACCEPTS `'production'` as a valid stored value.
- Why it matters: A single admin mis-click (or an operator who reads "Production (requires ONNX)"
  in `messages/en.json:726` and assumes "production-ready") flips a PUBLIC, same-origin,
  rate-limited-but-unauthenticated endpoint into serving cosine-ranked **noise** as
  "semantic search results" — complete with enriched thumbnails/titles. End users get
  authoritative-looking, wrong results. This is a public correctness failure gated only by prose.
- Concrete failure scenario: Photographer enables semantic search to "try it," picks the only
  option labelled production-grade, saves. Visitors search "sunset" and receive a deterministic
  but content-unrelated set of photos that looks intentional. No error, no telemetry, no rollback.
- Suggested fix: Make `'production'` **unselectable** until real inference exists. Concretely:
  (a) gate the `<SelectItem value="production">` behind a runtime capability probe
  (`onnxruntime-node` present AND model files on disk), OR (b) reject `'production'` in
  `isValidSettingValue('semantic_search_mode', …)` while the stub is the only encoder, returning
  the value to `'stub'`, AND (c) in the route, treat `'production'` as 503 when the real encoder
  module is absent (capability check, not config check). The current "warn and allow" posture is
  the documented anti-pattern this codebase otherwise avoids everywhere (fail-closed elsewhere).
- Realist Check: Realistic worst case is reputational/quality, not data-loss or security; results
  are noise, not a breach. Detection is **silent** (looks intentional). Mitigated only by the soft
  warning and that the feature is off by default. The silent-detection + public-facing + "looks
  legitimate" combination keeps it CRIT despite no security impact: a quality gate that can be
  crossed with one click and no signal is exactly the false-approval class this role guards.

---

## MAJOR Findings

### CRT-R5C1-02 — Auto alt-text stub leaks the literal `[AUTO] ` engineering prefix into PUBLIC photo titles/headings and SEO
- Severity: **MAJOR** · Confidence: **High** · Classification: **confirmed**
- Evidence:
  - `src/lib/caption-generator.ts:27` `ALT_TEXT_STUB_PREFIX = '[AUTO] '`; `:33-40`
    `generateCaptionStub` returns `"[AUTO] Photo taken with <camera>"` or `"[AUTO] Photo"`.
  - `generateCaption(input, autoAltTextEnabled)` (`:50-61`) writes that string to
    `alt_text_suggested` when `auto_alt_text_enabled === 'true'` (`gallery-config-shared.ts:39,105`).
  - `src/lib/data.ts:263-264`: `alt_text_suggested` is explicitly marked **PUBLIC** and is in
    `publicSelectFields`.
  - `src/lib/photo-title.ts:104-105`: when a photo has no meaningful title and no tags,
    `getPhotoDisplayTitle` returns `image.alt_text_suggested.trim()` **verbatim** — `[AUTO] ` and all.
  - `getPhotoDisplayTitle` feeds public surfaces: `src/components/photo-viewer.tsx:174` (the photo
    page heading + document `<title>` via `getPhotoDocumentTitle`) and
    `src/components/info-bottom-sheet.tsx:157` (mobile info sheet heading).
- Why it matters: This is a developer/debug marker reaching the **end-user-visible** photo title,
  the browser tab title, and (through metadata) SEO. The product premise is "deliver the
  photographer's intent accurately"; shipping "[AUTO] Photo taken with Canon EOS R5" as a public
  heading is the opposite of that premise. It is also indexable.
- Concrete failure scenario: Photographer enables auto alt-text (a plausible a11y/SEO win), uploads
  untitled/untagged photos. Public photo pages now render headings and `<title>` tags literally
  prefixed with "[AUTO] ". Google indexes them.
- Suggested fix: Drop the `[AUTO] ` prefix from any value that can reach a public display path, OR
  exclude `alt_text_suggested` from the `getPhotoDisplayTitle` *visible-title* fallback (keep it
  for the `alt=""` attribute only, which is its stated purpose per the `data.ts:263` comment "SEO +
  a11y fallback"). The prefix belongs only in the admin bulk-editor "suggested" column, never in a
  rendered title. If the prefix is needed for admin disambiguation, strip it at the public read
  boundary in `photo-title.ts`.
- Realist Check: Off by default; only fires on untitled+untagged photos; admin-visible in the
  bulk editor so a careful admin would notice. Detection is moderate (admin might see it; visitors
  certainly do). Stays MAJOR not CRIT because it is opt-in, cosmetic, and trivially reversible —
  but it is a genuine public-honesty/coherence defect, not a preference.

### CRT-R5C1-03 — Doc claim "HDR badge gated until WI-09" rests on a feature flag that gates NOTHING (dead scaffolding) — and WI-09 does not exist
- Severity: **MAJOR (as doc-integrity / half-finished-feature drift)** · Confidence: **High** · Classification: **confirmed**
- Evidence:
  - `src/lib/feature-flags.ts:10`: `export const HDR_FEATURE_ENABLED =
    process.env.NEXT_PUBLIC_HDR_FEATURE_FLAG === 'true';` with a comment "WI-08 / WI-09: HDR AVIF
    delivery … Defaults to false until the HDR encoder (WI-09) is implemented."
  - `grep` across `src/` and `scripts/`: **zero** other references to `HDR_FEATURE_ENABLED` or
    `NEXT_PUBLIC_HDR_FEATURE_FLAG`. The constant is exported and never consumed.
  - `grep` for `avifenc` / `_hdr.avif` / `deriveHdrAvifFilename`: **zero** hits in src or scripts.
    WI-09 (the HDR encoder shell-out described in CLAUDE.md "HDR ingest") is not implemented.
  - `src/lib/hdr-filenames.ts` (documented "reserved for WI-09"): **zero** non-self importers —
    dead code.
- Why it matters: Two coupled doc-integrity problems. (1) CLAUDE.md presents `HDR_FEATURE_ENABLED`
  and `hdr-filenames.ts` as the mechanism that will switch on HDR delivery; in reality the flag is
  inert and flipping `NEXT_PUBLIC_HDR_FEATURE_FLAG=true` changes nothing — a future engineer wiring
  HDR will reasonably assume the flag already guards real gating and ship a half-connected feature.
  (2) The honesty invariant ("`is_hdr`/`transfer_function` stay admin-only until WI-09 ships") is
  currently enforced ONLY by the privacy guard (`privacy-fields.test.ts`), NOT by the flag the docs
  credit. The flag is decorative. The good news: because the flag gates nothing, flipping it is
  NOT a public-honesty hazard today (so this is not CRIT).
- Concrete failure scenario: A contributor implements WI-09, sees `HDR_FEATURE_ENABLED` "already
  exists," wires the encoder behind it, sets the env var — and discovers the badge gating, the
  `<picture media="dynamic-range:high">` source, and the public-field exposure were never connected
  to it. Or worse, partially connects it and ships unfulfilled HDR badges.
- Suggested fix: Either (a) delete `feature-flags.ts`'s `HDR_FEATURE_ENABLED` and `hdr-filenames.ts`
  as premature scaffolding and let WI-09 introduce its own wiring, OR (b) add an explicit
  "DEAD/RESERVED — not wired" banner to both and to the CLAUDE.md "HDR ingest" section so no one
  treats the flag as a live gate. Update CLAUDE.md to state plainly that the admin-only honesty
  invariant is enforced by the privacy guard, not by any flag.
- Realist Check: No runtime impact today (dead code). Severity is for the latent trap it sets for
  the WI-09 implementer + the doc claiming a non-existent gate. MAJOR as drift, not as a live bug.

---

## MINOR Findings

### CRT-R5C1-04 — Stripe webhook is missing the `checkout.session.async_payment_succeeded` handler it documents as needed
- Severity: **MINOR** · Confidence: **High** · Classification: **confirmed**
- Evidence: `src/app/api/stripe/webhook/route.ts:96-99` explicitly notes async-paid flows (ACH,
  bank transfer, OXXO, Boleto) arrive `'unpaid'` and "a future cycle should add a handler for
  `checkout.session.async_payment_succeeded`." Only `checkout.session.completed` is handled; the
  async-succeeded event is silently ignored (falls through to the final `received: true`).
- Why it matters: If an operator ever enables a delayed-payment method in Stripe, the customer pays,
  funds settle, Stripe fires `async_payment_succeeded` — and **no entitlement is ever minted**. The
  customer paid and can't download. This is latent because USD card-only checkout (the current
  config) never produces these events. Documented and bounded, hence MINOR.
- Suggested fix: Add the `async_payment_succeeded` case (reuse the completed-path entitlement
  insert), OR add an explicit Stripe-dashboard guardrail note that delayed-payment methods are
  unsupported until that handler lands.

### CRT-R5C1-05 — `@/lib/storage` abstraction is fully unintegrated dead code (3 files, ~13 KB) with zero call sites
- Severity: **MINOR** · Confidence: **High** · Classification: **confirmed**
- Evidence: `src/lib/storage/{index,local,types}.ts` exist; `grep "from '@/lib/storage"` excluding
  the dir itself and tests returns **zero** hits. CLAUDE.md:109 correctly warns it is "Not Yet
  Integrated" — so this is honest, but it is unexercised surface area carried indefinitely.
- Why it matters: Dead abstractions rot — they drift from the real local-FS code paths
  (`upload-paths.ts`, `serve-upload.ts`) and create a false impression of S3/MinIO readiness for
  anyone scanning `lib/`. Low risk, but it is unverified-by-use code in a security-sensitive area
  (file serving / path containment).
- Suggested fix: Either delete it until S3 work is actually scheduled, or add a top-of-file
  `// UNUSED — not wired into the upload/serve pipeline (see CLAUDE.md)` banner to each file so a
  reviewer doesn't mistake it for a live path.

### CRT-R5C1-06 — Deploy host path drift between docs and `deploy.sh`
- Severity: **MINOR** · Confidence: **Medium** · Classification: **needs-manual-validation**
- Evidence: `apps/web/deploy.sh:5` comments "Must be run from the repo root (e.g.,
  /home/ubuntu/gallery)"; CLAUDE.md "Backfill" block hardcodes `/home/ubuntu/gallery/...` mounts;
  AGENTS.md:18 says the deploy host is `gallery.atik.kr` / `ubuntu@atik.kr`. These are consistent
  IF the checkout lives at `/home/ubuntu/gallery` on `atik.kr`, but the README "Remote Deploy
  Helper" derives the path from `DEPLOY_PATH` in gitignored `.env.deploy`, which could diverge.
- Why it matters: The backfill sidecar command in CLAUDE.md hardcodes `/home/ubuntu/gallery/...`
  read-only mounts. If `DEPLOY_PATH` differs from `/home/ubuntu/gallery`, an operator copy-pasting
  the documented backfill command mounts the wrong source tree (or empty dirs) and the
  `--rm tsx` run silently no-ops or fails opaquely.
- Suggested fix: Make the CLAUDE.md backfill block reference `$DEPLOY_PATH` (or a documented var)
  instead of a hardcoded absolute path, and cross-link it to the `.env.deploy` `DEPLOY_PATH` field.

---

## What's Missing (gaps / unhandled edges / unstated assumptions)

- **No capability probe separates "config says production" from "encoder can actually do production"**
  for either ML feature. Both `semantic_search_mode` and `auto_alt_text_enabled` trust an admin
  string with no check that the underlying model/binary exists. The repo otherwise loves
  capability gates (10-bit AVIF libheif probe, fail-closed config reads) — these two stub features
  are the exception. This is the through-line behind CRT-R5C1-01 and CRT-R5C1-02.
- **No automated test asserts that `alt_text_suggested` cannot reach a public *visible title*** (only
  that it's "public" — which it is by design for the `alt` attribute). The title-fallback path in
  `photo-title.ts:104` is untested for the prefix-leak case.
- **No lint/test gate prevents adding a third stub-ML "production" mode footgun.** The pattern
  (UI select → config validator accepts → public route trusts it) is now established in two places
  and will be copied.
- **Embeddings backfill scalability assumption unstated:** `embeddings.ts` uses `notExists`
  per-batch and the public route scans `SEMANTIC_SCAN_LIMIT=5000` most-recent rows doing in-process
  cosine over base64-decoded vectors on every request. At 5000 rows × 512 floats per request this
  is a CPU-bound public endpoint on the single-writer box — fine at small scale, but there is no
  documented ceiling tying it to the single-instance topology. (Not scored — it is rate-limited
  30/min/IP and gated behind the production mode that CRT-R5C1-01 says shouldn't be reachable.)

## Multi-Perspective Notes

- **Executor**: The half-finished ML features have crisp TODO trails (clip-inference.ts,
  caption-generator.ts) — an implementer has enough to finish them. The trap is the *enabling
  surfaces shipped ahead of the engines* (CRT-01/02): the UI/config/public-route are live while the
  engine is a stub, inverting the safe "engine first, switch last" order.
- **Stakeholder**: Product premise is delivery-honesty ("photographer's intent, accurately").
  CRT-01 (random results presented as search) and CRT-02 ("[AUTO]" in public titles) both directly
  contradict that premise — they are coherence failures, not just bugs.
- **Skeptic**: The strongest counter-argument is "all of these are off by default and CLAUDE.md
  documents them." True — but the assignment explicitly says be skeptical of "documented as
  intentional." A soft amber warning that ends in "...will be semantically random" is documentation
  of a footgun, not a guard. The codebase's own doctrine elsewhere is fail-closed; these three
  features fail-open-with-a-note. That inconsistency is the finding.

## Verdict

**REVISE** — The security-critical core (auth, paid downloads, webhook, PAT upload, smart-collection
compiler, privacy guard) is genuinely strong and I could not fault it after thorough verification;
a clean bill there carries real signal. But three real product-coherence defects sit in the
stub-ML / dead-scaffolding seams the prior 20 cycles toured least: a one-click path to serving
random public search results (CRT-01, CRIT), an engineering prefix leaking into public titles
(CRT-02, MAJOR), and a documented-but-inert HDR gate that will mislead the WI-09 implementer
(CRT-03, MAJOR). None block the existing shipped product (all opt-in/dead), so this is REVISE not
REJECT — but CRT-01 should be closed before the semantic feature is ever exposed, and CRT-02 before
auto alt-text is recommended to any operator.

## Open Questions (unscored)

- Does any production deployment currently have `semantic_search_mode` or `auto_alt_text_enabled`
  set to a non-default? (DB-state, not verifiable from source.) If yes, CRT-01/02 are live, not latent.
- Is `DEPLOY_PATH` on atik.kr actually `/home/ubuntu/gallery`? (CRT-06 hinges on this.)
- Is the 5000-row in-process cosine scan acceptable at the largest expected gallery size on the
  single-instance box, or should ANN/index be planned alongside real ONNX? (Performance, deferred.)
