# Tracer Report — CLIP / Semantic Search Subsystem

- HEAD verified: `1a325fa6` (run-6, post-cycle)
- Agent: tracer (oh-my-claudecode:tracer)
- Date: 2026-06-17

---

## Scope

Four execution paths traced through the CLIP semantic-search subsystem:

1. Seed → offline image-load (SW / PWA path — not semantic, confirmed orthogonal)
2. POST `/api/search/semantic` — text-to-image search (production + stub modes)
3. GET `/api/search/similar/[id]` — image-to-image similarity
4. Upload real-embed hook — `backfillClipEmbeddings()` server action

---

## Trace Report

### Observation

The `backfillClipEmbeddings()` server action (US-P51) selects images that lack an embedding row using a `notExists` subquery that filters only on `imageId`, not on `modelVersion`. The sidecar script `scripts/backfill-clip-embeddings.ts` performing the equivalent operation filters on both `imageId` AND `modelVersion`. The two implementations are inconsistent.

The similar-photos enrichment SELECT in `apps/web/src/app/api/search/similar/[id]/route.ts` omits `lens_model` and `capture_date` columns that the semantic text-search route (`apps/web/src/app/api/search/semantic/route.ts`) explicitly includes (annotated `AGG-C10-11a`).

---

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 (M1) | `backfillClipEmbeddings()` notExists subquery missing modelVersion filter causes stub rows to block production-version backfill | High | Strong — direct source read, sidecar script comparison | Code at lines 92-98 of embeddings.ts shows the filter; sidecar at lines 125-132 shows the correct two-condition form |
| 2 (L1) | similar/[id] enrichment SELECT omits lens_model and capture_date, producing blank fields if rendered with semantic-result card component | High | Strong — direct column-list comparison between the two route files | similar/route.ts lines 185-201 vs semantic/route.ts lines 284-300 |
| 3 (I1) | Per-IP rate limiting on semantic endpoint degrades to single shared bucket when TRUST_PROXY is unset | High (operator dependency) | Strong — comment in semantic/route.ts lines 199-206 documents the known gap explicitly | Not a code defect; operator configuration gap |

---

### Evidence For

**M1 — notExists missing modelVersion:**
- `apps/web/src/app/actions/embeddings.ts` lines 92-96: the `notExists` inner SELECT filters only on `eq(imageEmbeddings.imageId, images.id)`. No `modelVersion` predicate is present.
- `apps/web/scripts/backfill-clip-embeddings.ts` lines 125-131: the equivalent `notExists` inner SELECT filters on BOTH `eq(imageEmbeddings.imageId, images.id)` AND `eq(imageEmbeddings.modelVersion, TARGET_MODEL_VERSION)`.
- The action computes `modelVersion` at line 103 — after the query that should use it.
- Consequence: any image row with an existing embedding (regardless of version) is excluded from the pending list. A stub-mode row (modelVersion = STUB_MODEL_VERSION) permanently blocks re-embedding with the production model. The action is currently unwired from UI, so there is no live impact today.

**L1 — similar route missing lens_model / capture_date:**
- `apps/web/src/app/api/search/similar/[id]/route.ts` lines 185-201: SELECT list contains `id, title, description, filename_jpeg, width, height, topic, topic_label, camera_model`. No `lens_model`, no `capture_date`.
- `apps/web/src/app/api/search/semantic/route.ts` lines 284-300: SELECT list additionally includes `lens_model` and `capture_date`, with explicit `AGG-C10-11a` annotation explaining the intent.
- The similar route's type annotation at lines 167-178 does not declare `lens_model` or `capture_date` either, so the omission is internally consistent — both the query and the type match — but diverge from the semantic route's richer shape.

**I1 — TRUST_PROXY single-bucket risk:**
- `apps/web/src/app/api/search/semantic/route.ts` lines 199-206: inline comment documents the known gap: "when TRUST_PROXY is unset, getClientIp returns 'unknown' for EVERY client, so all anonymous callers collapse into ONE shared 30/min bucket."

**Paths confirmed sound:**
- `apps/web/src/lib/clip-model.ts` lines 101-104: `loadPromise` is nulled on catch, so a model-load error retries rather than caching a failed promise.
- Same-origin guard, rate-limit, body validation, and rollback-on-early-return chain in semantic/route.ts and similar/route.ts are structurally correct.

---

### Evidence Against / Gaps

**M1:** The action is not currently reachable from any UI surface (unwired). No live user can trigger it today. If it were surfaced and stub rows exist, re-running would simply report 0 processed for those images — no data corruption, no crash. The fix is mechanical and low-risk.

**L1:** No evidence that any component currently renders similar-search results with a subtitle component that expects `lens_model` or `capture_date`. The omission is a consistency gap; it would only manifest visually if a shared result-card component renders those fields. No privacy or correctness concern.

**I1:** This is an operator configuration dependency, not a code defect. The comment acknowledges it; the rate limit still applies to the shared bucket even without TRUST_PROXY, which is the documented safe-default posture.

---

### Rebuttal Round

**Best challenge to M1 (the leader):** One could argue that in practice the action will never be called while stub rows exist, because the admin would only enable stub mode in development and production mode in production — these environments would have disjoint embedding tables. Therefore the cross-version blocking scenario is purely theoretical.

**Why M1 still stands:** The argument assumes deployment hygiene that is not enforced by the code. A single instance toggled from stub → production mode in production would have stub rows in the same table and the action (once wired) would silently skip all images with stub rows. The sidecar script has already been hardened against this exact scenario (lines 125-131), confirming the maintainer acknowledged the risk. The action-sidecar divergence is the defect, regardless of how likely the trigger is today.

---

### Convergence / Separation Notes

M1 and L1 are distinct defects with different root causes (missing filter predicate vs missing column selection) and different code paths. They do not reduce to a common root cause.

I1 is an operator configuration dependency documented inline; it shares the same rate-limit infrastructure as M1's action but is not causally related.

---

### Current Best Explanation

**M1 (MEDIUM):** `backfillClipEmbeddings()` in `apps/web/src/app/actions/embeddings.ts` lines 92-98 — the `notExists` subquery used to identify images without an embedding is missing a `modelVersion` filter. Images with any existing embedding row (including stub-version rows) are excluded from the pending list. This means stub rows silently block production-version backfill. The sidecar script at `apps/web/scripts/backfill-clip-embeddings.ts` lines 125-131 correctly applies the two-condition filter. The action is currently unwired from UI so there is no live impact, but the defect would manifest silently if the action were surfaced before stub rows are cleaned up.

Fix: add `eq(imageEmbeddings.modelVersion, modelVersion)` to the inner `notExists` WHERE at `apps/web/src/app/actions/embeddings.ts` line 95, analogous to the sidecar pattern. The `modelVersion` variable is available at line 103 — it must be moved above the query, or the notExists must be constructed dynamically.

**L1 (LOW):** `apps/web/src/app/api/search/similar/[id]/route.ts` lines 185-201 — enrichment SELECT omits `lens_model` and `capture_date` that the semantic text-search route includes. If similar-result cards are rendered with a component that expects these fields, they will appear blank. No privacy or correctness concern.

**I1 (INFO):** `apps/web/src/app/api/search/semantic/route.ts` — per-IP rate limiting degrades to a single shared `'unknown'` bucket when `TRUST_PROXY` is unset. Documented inline; operator must set `TRUST_PROXY=true` in production behind a reverse proxy. No code change required.

---

### Critical Unknown

Whether `backfillClipEmbeddings()` is planned to be wired to an admin UI surface in a near-term cycle. If yes, M1 becomes an active correctness defect before it ships.

---

### Discriminating Probe

Check the admin settings / backfill UI for any in-progress work item that would surface `backfillClipEmbeddings()`. If found, M1 must be fixed before that surface ships. If not found, M1 remains a latent defect to fix before the action is wired.

---

### Uncertainty Notes

- The similar-route type annotation (lines 167-178) omits `lens_model` / `capture_date`, so this is an internally consistent omission — it would require a deliberate caller-side change to surface. Low urgency.
- The `modelVersion` variable placement at embeddings.ts line 103 (after the query at lines 86-99) confirms the notExists subquery cannot reference it in its current form — this is a structural confirmation of M1, not just an oversight.
