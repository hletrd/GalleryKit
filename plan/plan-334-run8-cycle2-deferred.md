# Plan 334 — Run-8 Cycle-2 deferred findings (record-only)

**Source:** `.context/reviews/_aggregate.md` (run-8 cycle-2 fan-out).
**Rule compliance:** Per the orchestrator's STRICT deferred-fix rules and CLAUDE.md: every review finding is either scheduled (plan-333) or recorded here. No finding is silently dropped. Each entry records file+line, ORIGINAL severity/confidence (NOT downgraded), concrete reason for deferral, and the exit criterion that re-opens it. Security/correctness/data-loss findings are deferred ONLY where the repo's own rules explicitly permit (quoted below). Deferred work, when picked up, remains bound by repo policy (GPG-signed commits, Conventional Commits + gitmoji, no `--no-verify`, no force-push, latest toolchain pins).

This list contains ONLY existing review findings. No new refactors/features are introduced under the deferred label.

---

## Deferred 1 — AGG-R8-A1 / PERF-2: Atom feed `updated_at DESC` filesort (no covering index)

- **Severity/Confidence (original, preserved):** LOW / High.
- **Where:** `apps/web/src/lib/data.ts:771-794` (`getImagesForFeed`) orders by `updated_at DESC, created_at DESC, id DESC` filtered on `processed=true`; `images` indexes (`apps/web/src/db/schema.ts:114-118`) lead with `capture_date`/`created_at`/`user_filename`/`uploaded_by` — none covers `updated_at`. MySQL filesorts the processed set per request.
- **Reason for deferral:** bounded by `FEED_LIMIT=50` and the route's `Cache-Control: max-age=600, s-maxage=1800` (`apps/web/src/app/feed.xml/route.ts:15`); the feed is a low-frequency endpoint and the sort runs only on an origin cache miss. The cost is real but small and amortized. A new index adds write-amplification and a migration (with the journal-monotonicity ceremony) for a marginal read win on a cold, infrequent path. Not a correctness or data-loss issue.
- **Exit criterion:** re-open if (a) feed traffic becomes material (e.g. a CDN/aggregator polls it frequently) and slow-query logs show the filesort as a hotspot, OR (b) an unrelated migration is already touching the `images` indexes and the `(processed, updated_at, created_at, id)` index can ride along at no extra migration cost.

## Deferred 2 — AGG-R8-A2 / PERF-03: decode-once-per-format (fresh `sharp()` per format×size)

- **Severity/Confidence (original, preserved):** LOW / High.
- **Where:** `apps/web/src/lib/process-image.ts:1052-1097` opens a fresh `sharp(inputPath, …)` per (format × size) — up to ~18 decodes per image. The `lastRendered` hard-link dedup (`:1060`) partially mitigates repeat sizes.
- **Reason for deferral:** the architect explicitly REFUTED the prior "unsafe" justification — WI-14 cross-format isolation applies to PARALLEL formats, not within-format sequential clones, so a decode-once-then-clone optimization is SAFE. The genuine reason to defer is scope/CPU-only: this runs on the BACKGROUND processing queue (default `QUEUE_CONCURRENCY=1`), not in any request path, so it costs encoder CPU/wall-time on upload, never user-facing latency. Not a correctness or data-loss issue. Re-architecting the fan-out to decode once and `clone()` across formats+sizes is a non-trivial change to the most security-sensitive pipeline file and is not justified by the LOW user-impact this cycle.
- **Exit criterion:** re-open if (a) upload-processing throughput becomes a bottleneck (large batch ingests timing out / queue backlog), OR (b) the encoder file is already being refactored for another reason and the decode-once change can land with full color-pipeline regression coverage (the decision matrix + 10-bit AVIF gating tests must stay green).

## Deferred 3 — AGG-R8-A3: inherent single-pool / single-writer tradeoffs (A1/A3/A4)

- **Severity/Confidence (original, preserved):** MED / High (recorded as observations, not defects).
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:105-142` (pool reserve protects one `getImage` fan-out); `apps/web/src/lib/data.ts:1015-1061` (`getImage` issues 3 concurrent range scans under `revalidate=0`); `apps/web/src/lib/image-queue.ts:166` + backfill PQueue share libvips with no shared CPU budget.
- **Reason for deferral:** these are inherent properties of the SHIPPED single-web-instance / single-writer Docker topology, which CLAUDE.md documents explicitly ("The shipped Docker Compose deployment is a single web-instance / single-writer topology … do not horizontally scale the web service unless those coordination states are moved to a shared store"). The `revalidate=0` freshness choice is likewise deliberate and documented ("public routes currently set `revalidate = 0` so asynchronous image processing and metadata updates are visible immediately"). These are NOT defects — they are the documented design envelope. **Repo rule quoted (CLAUDE.md, Runtime topology):** the single-writer assumption is the documented operating mode.
- **Exit criterion:** re-open ONLY if the project decides to support horizontal scaling — at which point coordination state (restore flags, upload quota, image-queue, backfill state, rate-limit Maps, view-count buffer) must move to a shared store as a deliberate, planned effort. No action while single-writer remains the supported topology.

## Deferred 4 — AGG-R8-OWNED-1 / AGG-R7-13: Stripe `async_payment_succeeded` never writes an entitlement

- **Severity/Confidence (original, preserved — NOT downgraded):** HIGH / High.
- **Where:** `apps/web/src/app/api/stripe/webhook/route.ts:88,105` handles only `checkout.session.completed` + `payment_status==='paid'`; `apps/web/src/app/api/download/[imageId]/route.ts:166` returns 404 forever for ACH/bank-transfer settled payments.
- **Reason for deferral (with the repo rule that permits it):** this is a correctness finding, which is normally NON-deferrable. CLAUDE.md EXPLICITLY scopes the support boundary and assigns ownership: *"`checkout.session.async_payment_succeeded` is not yet handled — delayed payment methods (bank transfer / ACH) complete checkout but never receive an entitlement row; only card / immediate-payment methods are fully supported until plan-316 CRT-R5C1-04 ships."* Per the deferred-fix rule, security/correctness findings may be deferred when the repo's own rules explicitly allow it — this one does, and assigns it to plan-316. No DATA LOSS: funds settle in Stripe and the entitlement row is recoverable manually; the webhook correctly mints NO false entitlement for unpaid funds (verified by security-reviewer + tracer this cycle). Interim operator mitigation: disable async payment methods in Stripe Checkout.
- **Exit criterion (unchanged):** plan-316 CRT-R5C1-04 is picked up, OR a real settled-but-undownloadable ACH/bank-transfer purchase is reported in production → escalate immediately (no longer deferrable once a real customer is affected).

## Deferred 5 — AGG-R8-13 / SEC-1: home OG route omits `sanitizeForOg` (IF not done as plan-333 Item 10)

- **Severity/Confidence (original, preserved):** LOW / Low.
- **Where:** `apps/web/src/app/api/og/route.tsx:77` — `siteTitle` (and `topicLabel`/tags) rendered without the `sanitizeForOg` wrap the per-photo sibling (`api/og/photo/[id]/route.tsx:98`) uses.
- **Reason for deferral (conditional):** scheduled as plan-333 Item 10 (optional, capacity-permitting). It is deferrable per CLAUDE.md ONLY because it is non-exploitable defense-in-depth hygiene, not a live vulnerability: `seo.title` is admin-controlled and `containsUnicodeFormatting`-rejected at write time; topic/tag values pass `isValidTopicAlias`/`isValidTagName` (reject `<>"'&\x00` + formatting chars); and the output is a Satori-rendered JPEG/PNG (text nodes, no script/`</script>` sink in an image response). There is no exploit with current validation — only a future regression (loosened SEO validator or a non-admin string routed here) would matter. This is hygiene, NOT a security-class vulnerability, so deferral does not violate the "security findings not deferrable" rule.
- **Exit criterion:** implement when plan-333 Item 10 capacity allows, OR re-open immediately if the SEO/topic/tag validators are ever loosened (the symmetric-defense gap would then become live). Pin with a fixture asserting both OG routes strip a bidi-laden `seo.title`.

---

## Progress

| Entry | Disposition | Status |
|---|---|---|
| Deferred 1 (feed updated_at index) | LOW perf — bounded+cached | RECORDED |
| Deferred 2 (decode-once perf) | LOW perf — scope/CPU-only, safe | RECORDED |
| Deferred 3 (single-pool/single-writer) | MED observations — documented topology | RECORDED |
| Deferred 4 (Stripe ACH) | HIGH — already plan-316, repo-rule-permitted | RECORDED |
| Deferred 5 (OG home sanitize) | LOW security hygiene — scheduled plan-333 Item 10 else recorded | RECORDED |
