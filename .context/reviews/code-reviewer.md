# Code Reviewer — Run-6 Cycle-1 Fan-out (GalleryKit)

**Reviewer:** `code-reviewer` agent (Opus, two-stage: spec-compliance -> code-quality)
**Scope:** code quality, logic correctness, error-handling, SOLID, maintainability, data-flow/state-consistency, type-safety, dead code.
**Baseline:** HEAD `8fc403a2` + working tree. **Gates re-verified live this pass:** `npm run lint` -> exit 0, zero findings; `npm run typecheck` -> exit 0 (app + scripts). `timeout` is unavailable on this macOS host, so the earlier `===EXIT:0===` lines were short-circuited bogus values — I re-ran both gates WITHOUT `timeout` and confirmed clean output.

---

## Headline: the orchestrator's premise is factually wrong on the items I was told to verify

I was instructed that AGG-8 and AGG-13 are "still unfixed at HEAD." **Both are already implemented.** So are the three plan-328/329 items in the working tree, and AGG-16. Verifying these (and confirming the prior aggregate's claims do NOT match the code) is itself the highest-signal output of this pass — re-scheduling already-done work would be wasted cycles. Evidence below.

| Item | Claimed state | ACTUAL state at HEAD | Evidence |
|---|---|---|---|
| AGG-8 (TriState guard in `bulkUpdateImages`) | "still unfixed (~877-937), 500s on malformed payload" | **DONE — committed `652add51`** | `images.ts:907-916` — `isTriState()` helper narrows `mode` + requires string `value` on `'set'`; the `if (!isTriState(topic) || ...) return { error: t('invalidInput') }` guard runs immediately after the `ids` validation, BEFORE any `.mode` deref. |
| AGG-13 (semantic-mode `<Select>` blank on legacy `'production'`) | "still unfixed (~602), `|| 'disabled'`" | **DONE** | `settings-client.tsx:622` already uses value-COERCION `['disabled','stub'].includes(settings.semantic_search_mode) ? settings.semantic_search_mode : 'disabled'` — exactly the prescription. The amber legacy warning below (637+) still reads the RAW stored value. |
| AGG-1 (backfill honesty) | plan-328 item 2 | **DONE** (`13ae79ca`) | `AdminBackfillState.processed/errors` added + reset at run start (`runner:154-163, 558-559`), continuously mirrored (`657-658`), final-flushed (`688-689`), fatal-catch sets `state.lastError` (`652`); `getBackfillStatus` exposes both (`admin-backfill.ts:109-111`); UI reads `backfillStatus.processed` directly + surfaces `errors` (`settings-client.tsx:286-288`). |
| AGG-2 (ESLint gate + AGG-15 leak) | plan-328 item 1 | **DONE** (`5b5de9d3`) | Live `npm run lint` exit 0, zero output lines. |
| AGG-4 (`sanitizeForOg` global strip) | plan-328 item 4 | **DONE** (`170297ed`) | Both twins use `stripUnicodeFormatting(value) ?? ''`: `og/photo/[id]/route.tsx:37` (+ trailing `OG_C0_CONTROL_CHARS`) and `p/[id]/page.tsx:43`. |
| AGG-16 (touch-target gate Link/anchor + root files) | plan-329 item 6, "still-open" | **DONE** | `touch-target-audit.test.ts` `SCAN_ROOTS` block adds `global-error.tsx`/`[locale]/not-found.tsx`/`error.tsx`/`layout.tsx` (lines 53-79); FORBIDDEN set has `<Link>` + `<a>` patterns for `h-8/h-9/h-10` literal, `cn()` composite, and sub-44 `min-h-[...]` (lines 397-420). |

The working-tree changes (admin `error.tsx` H1 split = AGG-9, `admin-backfill-runner.ts` pool-budget formula = AGG-5, the matching concurrency-cap test) are correct and internally consistent — reviewed in detail below.

**Net new defects found: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 4 LOW, 2 INFO.** This is a very mature, heavily-reviewed codebase; the remaining items are genuinely minor.

---

## Findings table

| ID | Severity | Confidence | File:line | One-line |
|---|---|---|---|---|
| COR-1 | LOW | High | `components/home-client.tsx:280` | `containIntrinsicSize` divides by `image.width`; a 0-width row yields `auto Infinitypx` (invalid CSS). Pre-existing, widened by the AGG-R5C3 estimate change. |
| COR-2 | LOW | High | `lib/photo-title.ts:46` | `formatTitleAsTags` path does NOT `humanizeTagLabel` title words, but the tag-derived paths DO — underscored titles render `#Color_in_Music` while tags render `#Color in Music`. Cosmetic inconsistency. |
| COR-3 | LOW | Medium | `app/[locale]/(public)/page.tsx:104` | Home-OG sized-derivative URL has no `pickFirstAvailablePhotoBuffer`-style fallback; a legacy/backfilling `latestImage` missing `_{size}.jpg` yields a 404 OG image (crawler only; self-heals post-backfill). |
| COR-4 | LOW | Medium | `lib/admin-backfill-runner.ts:585` | Clamp-down warning compares `concurrency` against `Math.max(1, Math.floor(requestedConcurrency)||1)`, recomputing the floor inline instead of reusing the value `resolveBackfillConcurrency` already computed — correct today, but a divergence hazard if the floor rule changes in one place only. |
| COR-5 | INFO | High | `app/actions/lr-tokens.ts:118-121` | `listLrTokens` carries `@action-origin-exempt: read-only` yet still calls `requireSameOriginAdmin()`. Harmless (extra safety) but the exemption comment is now misleading. |
| COR-6 | INFO | High | `app/api/og/photo/[id]/route.tsx:99` | `getPhotoDisplayTitle(image, ...)` relies on `getImageCached` returning a `tags` array (it does, `data.ts:1068`) — VERIFIED correct, recorded so a future `getImageCached` shape change is known to affect OG titles. |

No finding rises to a confidence/severity that gates a verdict, so there is no "Open Questions (low-confidence CRITICAL/HIGH)" section this pass.

---

## Verification of the working-tree changes (AGG-5 + AGG-9)

### AGG-5 — backfill pool-budget formula (`admin-backfill-runner.ts`) — CORRECT

`resolveBackfillConcurrency` now computes `reserved = max(3, ceil(poolLimit/2))` then `cap = max(1, floor((limit - reserved - 1) / 2))`. I hand-verified the worst-case-connection invariant the new test pins:
- At `limit=10`: `reserved=5`, `cap=floor((10-5-1)/2)=floor(2)=2`. Worst-case held = `1 (lock) + 2x2 = 5`; free = `10-5 = 5 >= reserved`. PASS — the invariant `limit - (1+2*cap) >= reserved` holds.
- Edge `limit=3`: `reserved=3`, `floor((3-3-1)/2)=floor(-0.5)=-1`->`max(1,-1)=1`. The `max(1,...)` floor is load-bearing here and is present. At cap=1 worst-case held=3 = the whole pool — i.e. the "reserve >= reserved free" invariant is INTENTIONALLY violated for tiny pools (you can't reserve 3 of 3 and still run a worker). The test's invariant assertion only runs at `limit=10`, so it does not catch this — acceptable because POOL_CONNECTION_LIMIT ships at 10 and a 3-connection pool is a degenerate test-only config; worth a one-line comment but not a defect.
- `limit=20`: `reserved=10`, `floor((20-10-1)/2)=floor(4.5)=4`. Matches the test.
- Non-finite `poolLimit` -> falls back to 10 (guard at `:132`).

The header comment arithmetic matches the implementation. The clamp-DOWN warning is preserved (`:585-590`). The test file (`admin-backfill-concurrency-cap.test.ts`) is updated to the new expectations (cap 2 at limit 10, the reserved-headroom invariant test, the larger-pool scale test). **No defect.** (Minor: COR-4 on the inline floor recompute.)

### AGG-9 — admin error-shell H1 contrast split (`error.tsx`) — CORRECT

The diff mirrors the public `error.tsx` twin exactly: decorative `<span aria-hidden="true" className="text-7xl ... text-muted-foreground/30 block">` for the faint glyph + `<h1 id="admin-route-error-title" className="sr-only">` for the accessible name; `aria-labelledby="admin-route-error-title"` still resolves to the H1. `sr-only` text has no WCAG contrast floor, so the accessible name is now AA-clean. **No defect.**

---

## Detailed findings

### COR-1 (LOW, High) — `containIntrinsicSize` divide-by-`image.width`
`home-client.tsx:280`: `containIntrinsicSize: "auto " + Math.round(estimatedCardWidth * image.height / image.width) + "px"`. If `image.width === 0`, this is `Math.round(Infinity)` -> `"auto Infinitypx"`, an invalid CSS value the browser drops (degrading content-visibility height estimation, not a crash). `estimatedCardWidth` itself is well-guarded (`home-client.tsx:196-202`, floors to 300, `w>0` check). The risk is solely a 0-width DB row. `images.width` is schema-`NOT NULL` and populated from Sharp `metadata.width` (>=1 for any decodable image), so this is near-impossible in practice and is PRE-EXISTING (the old `300 * h / w` had the identical divisor). The AGG-R5C3-04 change swapped the numerator constant for `estimatedCardWidth` but did not introduce the divisor.
**Failure scenario:** a manually-corrupted/zero-width `images` row -> that one card reserves no intrinsic height -> minor layout shift on its first paint. **Fix (optional):** guard the divisor — `image.width > 0 ? Math.round(estimatedCardWidth * image.height / image.width) : estimatedCardWidth`. Low priority.

### COR-2 (LOW, High) — title-as-tags skips `humanizeTagLabel`
`photo-title.ts:43-46`: when `options.formatTitleAsTags` is true, title words are emitted as `#${word}` directly. Every tag-derived path (`:39`, `:52`) maps through `humanizeTagLabel(tag.name)` (underscore->space). So a title `"Color_in_Music"` rendered as tags shows `#Color_in_Music` while a tag of the same text shows `#Color in Music`. Inconsistent visual treatment of the same separator. **Fix (optional):** apply `humanizeTagLabel(word)` (or at least `.replace(/_/g,' ')`) in the `formatTitleAsTags` branch for parity. Cosmetic; titles rarely use underscores.

### COR-3 (LOW, Medium) — home-OG image URL lacks the sized-derivative fallback
`page.tsx:102-109` builds the home OpenGraph image directly from `/uploads/jpeg/${latestImage.filename_jpeg.replace(/\.jpg$/i, "_" + ogImageSize + ".jpg")}` with NO existence check. The per-photo OG route (`og/photo/[id]/route.tsx:121`) deliberately uses `pickFirstAvailablePhotoBuffer` to walk configured sizes and fall back when the targeted derivative is missing during a backfill/`image_sizes` reconfigure window. The home metadata path has no such bridge: if `latestImage` is a legacy row (or mid-backfill) missing `_{ogImageSize}.jpg`, the social card 404s until the derivative exists. `findNearestImageSize` only picks from the *configured* list — it does not verify the file is on disk. The JSON-LD thumbnail on the same page (`:182`) correctly uses the base filename per the R21-M2 contract; the OG image does not get the same treatment.
**Failure scenario:** admin adds a new size to `image_sizes`, the newest photo hasn't been backfilled, a crawler scrapes `/` -> broken OG preview image. Self-heals after backfill. **Fix (optional):** fall back to the base `filename_jpeg` (guaranteed by the encoder atomic-rename contract) for the home OG `url`, mirroring the JSON-LD thumbnail decision, OR resolve via the same fallback helper. Medium confidence because I did not confirm a live missing-derivative case — needs-manual-validation against a real backfill window.

### COR-4 (LOW, High) — clamp-warning recomputes the floor instead of reusing it
`admin-backfill-runner.ts:583-585`: `const concurrency = resolveBackfillConcurrency(requestedConcurrency); if (concurrency < Math.max(1, Math.floor(requestedConcurrency)||1)) { warn }`. The `Math.max(1, Math.floor(requestedConcurrency)||1)` here re-derives the same normalization `resolveBackfillConcurrency` applies internally (`:135 const req = Math.max(1, Math.floor(requested)||1)`). They agree today, so the warning fires correctly. The hazard is duplication: if the request-normalization rule ever changes inside `resolveBackfillConcurrency` (e.g. a different floor), this call-site comparison silently drifts and the "clamped DOWN" warning becomes wrong. **Fix (optional):** have `resolveBackfillConcurrency` return `{ effective, requestedNormalized }` (or expose the normalizer) so the warning compares against the single source of truth. Pure maintainability; no behavior bug.

### COR-5 (INFO, High) — stale exemption comment on `listLrTokens`
`lr-tokens.ts:118`: `/** @action-origin-exempt: read-only list action; no mutation, no side effects */` sits above a body that nonetheless calls `await requireSameOriginAdmin()` (`:120`). The action-origin lint gate treats the comment as "doesn't need the check," yet the check is present (good — belt-and-braces). The comment is now misleading to a reader (implies no origin guard). **Fix (optional):** drop the exempt comment since the function genuinely performs the same-origin check, OR keep it and add "(origin check retained as defense-in-depth)". Documentation hygiene only.

### COR-6 (INFO, High) — OG-title relies on `getImageCached` returning `tags`
Recorded as a VERIFIED cross-file dependency, not a defect. `og/photo/[id]/route.tsx:99` calls `getPhotoDisplayTitle(image, "Photo #" + image.id)`; `getPhotoDisplayTitle` (`photo-title.ts:33`) reads `image.tags` (array). `getImageCached = cache(getImage)` and `getImage` returns `tags: imageTagsResult` (`data.ts:1068`), so the OG title correctly considers tags then falls back to title then `Photo #id`. If a future refactor narrows `getImageCached`'s returned shape (e.g. to a lite select without `tags`), the OG title silently loses tag-derivation with no type error (the param type is structural and `tags?` is optional). Worth a comment at the call-site noting the dependency.

---

## Areas audited and found CLEAN (no defects)

- **Privacy select-field guards (`data.ts:204-450`):** `adminSelectFields` -> `publicSelectFields`/`publicMapSelectFields` derived by destructure-omit (separate references); `PrivacySensitiveKeys` union + `_SensitiveKeysInPublic`/`_MapSensitiveKeysInPublicMap`/`_LargePayloadKeysInPublic` compile-time guards all in place and correctly typed. The map-select guard auto-derives from the canonical union via `Exclude`. Solid.
- **`getImage` prev/next keyset navigation (`data.ts:923-1074`):** the dated/undated NULLS-LAST branch logic is meticulously reasoned and correct; `or(...conditions.filter(Boolean))` + `Promise.all` for tags/prev/next. No off-by-one, no NULL-ordering bug.
- **`getImagesLitePage` (`data.ts:818-854`):** `COUNT(*) OVER()` after `GROUP BY images.id` correctly counts distinct images; `hasMore = rows.length > pageSize` with a `+1` fetch; `totalCount` independent of LIMIT. Correct pagination contract.
- **`bulkUpdateImages` (`images.ts:870-1074`):** TriState guard (AGG-8) present; per-field validation (slug/title/description/licenseTier/applyAltSuggested) before any write; transaction-wrapped; alt-suggested copy strips stub-prefix + Unicode formatting and skips empty (`:1007-1008`); never auto-overwrites a non-empty target field.
- **`uploadImages` (`images.ts:108-536`):** upload-contract advisory lock released in `finally` (`:533`); tracker registered up-front to close the cold-IP TOCTOU (`:191-195`); pre-increment AFTER all validation so no manual rollback needed; `settleUploadTrackerClaim` reconciles claimed vs actual on every exit path including all-failed (`:485`); GPS-strip on disk + DB; HDR/RAW/wide-gamut rejection buckets correct; `assertBlurDataUrl` write-barrier.
- **`sharing.ts`:** photo + group share creation use in-memory pre-increment + DB-backed rate limit with symmetric BOTH-counter rollback on every early-return / FK-violation / exhausted-retry path; conditional `share_key IS NULL` UPDATE for race safety; `safeInsertId` for BigInt; revoke uses conditional `WHERE share_key = old` to avoid clobbering a concurrently-recreated key.
- **`sales.ts`:** refund maps Stripe error types to stable codes (no raw `err.message` across the boundary), converges local state on `charge_already_refunded` (R4C4 fix — closes the live-token-after-Stripe-refund hole), idempotency-key on the refund POST.
- **`checkout/[imageId]/route.ts`:** Pattern-2 rollback on every 4xx/5xx; strict `/^\d+$/` price parse; code-point-safe Stripe title truncation; idempotency key omitted only for unknown-IP (documented trade-off).
- **`search/semantic/route.ts`:** same-origin + content-type prefix + chunked-encoding + body-size guards; `clampSemanticTopK` rejects non-number raw (booleans/arrays); rate-limit STAYS applied on unknown-IP (security control, correctly distinguished from the checkout idempotency-key case); fail-closed config read; `EMBEDDING_BYTES` length check per row.
- **`admin-users.ts`:** validation-before-rate-limit ordering; advisory-lock-serialized last-admin-deletion with table-wide COUNT inside the lock; `audit_log` user_id NULL-detach before delete (errno 1451 fix); `safeInsertId`.
- **`collections.ts` / `smart-collections.ts`:** both `JSON.parse` sites in try/catch; per-column operator narrowing (tag -> eq/contains only) at WRITE time; scalar-value runtime enforcement against mysql2 object-expansion; the unauthenticated `getSmartCollections` getter was correctly REMOVED.
- **`lr-tokens.ts`:** expiry `Number.isFinite(parsed.getTime())` NaN-guard (prevents never-expiring tokens), past-date rejection, code-point label bound, no raw error relay.
- **`embeddings.ts`:** bounded concurrency, per-item try/catch tallies, `onDuplicateKeyUpdate` idempotent upsert.
- **`validation.ts`:** `UNICODE_FORMAT_CHARS` (test) + `UNICODE_FORMAT_CHARS_GLOBAL` (strip, derived from `.source` so it can't drift) + `safeInsertId` BigInt overflow throw. All consumers share one source of truth.
- **`admin-tokens.ts:158`:** unawaited `db.execute` for `last_used_at` is INTENTIONAL fire-and-forget with `.catch()` ("never block verification"). Correct.

---

## Positive observations
- The two-stage backfill honesty fix (AGG-1) is exemplary: the detection-failure-no-version-bump resume contract (`runner:511-531`), continuous state mirroring for live polling, and last-writer-wins-message documented explicitly — no dishonest "success + failure" banner remains.
- The privacy boundary is enforced at THREE layers (separate object references + compile-time `Extract` guards + the runtime select shape) and the map-select guard auto-derives from the canonical union — adding a sensitive column can't silently leak.
- Rate-limit rollback discipline (Pattern 2) is applied uniformly across sharing/checkout/semantic/admin-users with symmetric in-memory + DB counter handling — a class of "legitimate user penalized for infra failure" bugs is systematically closed.
- The touch-target audit's multi-line tag normalizer + Link/anchor/Badge/select coverage shows the team learned from each blind-spot incident (Badge R4C15, select R4C16, anchor AGG-16) and generalized the gate rather than patching one element.

## Recommendation

**COMMENT.** No CRITICAL/HIGH/MEDIUM defects at any confidence. The 4 LOW + 2 INFO findings are optional polish. Gates verified clean live (lint exit 0, typecheck exit 0). **Action item for the orchestrator/planner: do NOT re-schedule AGG-8, AGG-13, or AGG-16 — they are implemented at HEAD; the prior aggregate's "still-open" classification is stale.** If anything ships from this report, COR-3 (home-OG fallback) is the most defensible since it has a real (if crawler-only, self-healing) user-visible failure mode during backfill windows.
