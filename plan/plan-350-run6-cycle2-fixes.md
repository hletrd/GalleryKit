# Plan 350 — Run-6 Cycle-2 (orchestrator cycle 2/100) — Scheduled Fixes

**Date:** 2026-06-16
**Source:** `.context/reviews/_aggregate.md` (cycle-2 deep review, 11/11 agents) + per-agent files.
**HEAD at planning:** `8ccc8806`.
**Theme:** "perfect the system" — comprehensive deep hardening across correctness, security, perf, a11y, tests, docs.

**HARD GUARD (non-negotiable):** The CLIP feature is intentionally DARK (`semantic_search_mode` default `'disabled'`, healed from `'production'` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`). No task here flips the mode, runs `backfill --production`, downloads model weights, or sets that env anywhere. Every CLIP-touching fix is code/test/doc only and leaves the feature dark. `npm run deploy` ships code only.

**Repo policy reminders (apply to every commit here):** GPG-sign (`-S`), NO `Co-Authored-By`, conventional-commit + gitmoji, `git pull --rebase` before push, fine-grained one-commit-per-fix, push after each commit, run `npm run typecheck --workspace=apps/web` before committing test changes, run all GATES (eslint, typecheck, vitest, lint:api-auth, lint:action-origin, lint:public-route-rate-limit) before claiming done, no suppressions unless repo rules authorize (quote the rule in the body).

---

## SCHEDULED THIS CYCLE

### TASK-1 — [HIGH] Restrict Stripe Checkout to immediate-capture payment methods (interim async-payment money-gap guard) — AGG-H1
**Severity:** HIGH · **Confidence:** High · **Agents:** critic CRT-01, security, debugger.

**Root cause:** `apps/web/src/app/api/stripe/webhook/route.ts` handles `checkout.session.completed` and only proceeds on `payment_status === 'paid'`; there is no `async_payment_succeeded` handler. An async-payment buyer (SEPA/ACH/bank-transfer/OXXO/Boleto) is charged but never gets an `entitlements` row / download token. The FULL fix (the `async_payment_succeeded` handler) is already tracked in **plan-316 CRT-R5C1-04** and stays deferred there. This task closes the gap OPERATIONALLY now.

**Chosen fix (one-line guard at checkout-session creation):**
1. In the checkout session creation path (`apps/web/src/app/api/checkout/[imageId]/route.ts` — locate the `stripe.checkout.sessions.create(...)` call), set `payment_method_types: ['card']` (or the project's existing immediate-capture set) so async-payment methods cannot be initiated. This makes `completed`+`unpaid` unreachable, so the missing async handler can never strand a paying customer.
2. Add a code comment citing CRT-R5C1-04 / plan-316: "card-only until the async_payment_succeeded handler ships; do NOT add async methods before that handler exists."
3. Add a regression test (`apps/web/src/__tests__/checkout-card-only.test.ts`, source-contract style consistent with `stripe-webhook-source.test.ts`): assert the checkout-session create call includes `payment_method_types` pinned to immediate-capture, so a future contributor can't silently re-enable async methods while the handler is still missing.
4. Update CLAUDE.md's `entitlements` warning to note the interim card-only guard is now in place (the data-loss path is closed operationally; the full handler remains plan-316).

**Acceptance:** the checkout create call is card-only; new test RED before / GREEN after; CLAUDE.md updated; all gates green. NOTE: This is a security/correctness/data-loss finding — per repo rules it is NOT deferrable. plan-316 already schedules the full handler; this task lands the interim guard so nothing is left unprotected this cycle.

---

### TASK-2 — [HIGH] Guard `wide-gamut-hint.tsx` `JSON.parse(localStorage)` against malformed stored data — AGG-H6
**Severity:** HIGH (user-visible crash) · **Confidence:** High · **Agent:** debugger DBG-M2.

**Root cause:** `apps/web/src/components/wide-gamut-hint.tsx:40` does `const parsed = JSON.parse(raw) as PersistedDismiss;` where `raw = localStorage.getItem(...)`. A truncated/garbage localStorage value throws `SyntaxError`, crashing the photo-viewer React subtree (no error boundary above it) until the user clears storage.

**Chosen fix:**
1. Wrap the parse: `let parsed: PersistedDismiss | null = null; try { parsed = JSON.parse(raw) as PersistedDismiss; } catch { parsed = null; }` and treat `null` as "fresh / not dismissed".
2. Also validate the parsed shape minimally (e.g. it's an object with the expected dismiss fields) before use — a structurally-valid-but-wrong JSON (`"42"`, `[]`) should also be treated as fresh.
3. Add a test (`apps/web/src/__tests__/wide-gamut-hint-storage.test.ts` or extend an existing component test): malformed localStorage value → component renders the hint (fresh state) and does not throw.

**Acceptance:** malformed/empty/valid-but-wrong localStorage no longer throws; hint defaults to shown; test RED before / GREEN after; gates green.

---

### TASK-3 — [HIGH] Destroy the serve-upload read stream on client abort — AGG-H5
**Severity:** HIGH (fd leak / resource exhaustion) · **Confidence:** High · **Agent:** debugger DBG-H3.

**Root cause:** `apps/web/src/lib/serve-upload.ts:251-256` opens `createReadStream` and wraps it via `Readable.toWeb()`; the `destroy()` in the setup `catch` only fires on setup error, not on mid-transfer client abort. On abort the fd stays open until GC; under rapid masonry navigation fds accumulate toward the OS limit.

**Chosen fix (verify the plumbing actually fires — no no-op shim):**
1. Investigate the Next.js 16 route-handler streaming abort signal. Options, in preference order: (a) read `request.signal` in the route handler that calls `serveUploadFile` and pass it down so an `abort` listener calls `fileStream.destroy()`; (b) attach a `cancel()` to the `ReadableStream` returned by `Readable.toWeb()` that destroys the underlying Node stream; (c) listen for the underlying stream's lifecycle so the fd is always released. Choose whichever the runtime actually wires (confirm by reasoning + a focused test, not assumption).
2. Ensure both route handlers that call `serveUploadFile` (`app/uploads/[...path]/route.ts` AND `app/[locale]/(public)/uploads/[...path]/route.ts` — see AGG-D2) thread the same abort handling.
3. Add a test asserting that when the consumer cancels the web stream / aborts, `fileStream.destroy()` is called (mock `createReadStream` to return a spy stream; cancel the `ReadableStream`; assert `destroy` invoked). If the Next.js model genuinely provides no abort signal at the route-handler layer, document that finding precisely and fall back to the `ReadableStream` `cancel()` hook (which Node's `Readable.toWeb` DOES wire to `destroy`) — and the test must prove the cancel path destroys the fd.

**Acceptance:** abort/cancel path provably destroys the read stream (test-backed); no behavioral regression on the happy path (full read still completes + closes); gates green. If investigation shows `Readable.toWeb()` already destroys on `cancel()` (it does in modern Node), the fix may reduce to ensuring the route returns the cancelable web stream and adding the proving test — document the finding either way.

---

### TASK-4 — [HIGH] Bound `getMapImages()` with a LIMIT — AGG-H4
**Severity:** HIGH (unbounded public query) · **Confidence:** High · **Agent:** perf PERF-03.

**Root cause:** `apps/web/src/lib/data.ts:1565-1593` returns the full GPS-bearing map-visible set with no `.limit()`; `revalidate=0` makes every `/map` hit a fresh unbounded scan + serialization.

**Chosen fix (bound is the lever; keep it simple and scoped):**
1. Add a `.limit(MAP_IMAGE_LIMIT)` to the `getMapImages()` query with a generous but finite cap (e.g. a `MAP_MAX_MARKERS` constant — pick a value that comfortably covers a personal gallery, e.g. 5000-10000, and document the choice). This caps memory + payload without changing the UX for any realistic gallery.
2. Do NOT add viewport-bbox filtering or clustering this cycle (that's a feature, not a fix — out of scope; note it for a future plan if galleries grow). Do NOT change `revalidate` (that's a documented freshness tradeoff — leave alone per the scope-appropriate-tradeoffs list).
3. Add/extend a test asserting `getMapImages()` issues a bounded query (source-contract or a mocked-db assertion that `.limit` is applied).

**Acceptance:** query is `LIMIT`-bounded; constant documented; test added; gates green.

---

### TASK-5 — [HIGH] Service-worker LRU: running-total + head-walk eviction + coalesced metadata write — AGG-H3
**Severity:** HIGH (SW-thread perf + whole-blob lost-update) · **Confidence:** High · **Agent:** perf PERF-01.

**Root cause:** `apps/web/public/sw.template.js:87,101-116,130-138` re-sums O(n), re-sorts O(n log n) near the cap, and `JSON.stringify`s the entire metadata Map per image cache write; concurrent writers race the single blob.

**Chosen fix (edit the TEMPLATE + the reference impl together; pin via the contract test):**
1. Edit `apps/web/src/lib/sw-cache.ts` (`recordAndEvict`, the unit-tested reference) AND `apps/web/public/sw.template.js` in lockstep:
   - Maintain a running `total` byte counter in the meta store instead of re-summing every write.
   - Use Map insertion order (already insertion-ordered) for eviction: walk from the head (oldest) removing entries until under the cap — no full `Array.from(...).sort()`.
   - Coalesce/debounce the `setAll` blob write so a burst of fetches collapses into one serialization (e.g. a microtask/short-timer flush), keeping correctness for the eventual persisted state.
2. The whole-blob lost-update race is inherent to "all metadata in one Cache entry" and acceptable for a best-effort cache — do NOT redesign the storage model this cycle; the avoidable part is the O(n log n)-per-write and the redundant re-sum, which the above removes. Document this scope decision in the commit body.
3. Keep `__tests__/sw-cache.test.ts` green (extend it to assert the running-total + head-walk eviction behavior and the 50 MB cap still holds) and keep `__tests__/sw-template-contract.test.ts` green (the template-vs-reference drift pin — update the pinned expectations to match the new logic).
4. Regenerate `public/sw.js` via the `prebuild`/`scripts/build-sw.ts` flow so the served SW carries the new logic + a fresh `SW_VERSION` stamp; commit `sw.js`.

**Acceptance:** no full re-sum/sort per write; cap still enforced (test); template-contract test green with updated pins; `sw.js` regenerated + committed with a current stamp; gates green.

---

### TASK-6 — [HIGH] Add a retention/prune job for the `*_views` analytics tables — AGG-H2
**Severity:** HIGH (unbounded durable growth on the single writer) · **Confidence:** High · **Agent:** critic CRT-02.

**Root cause:** `image_views` / `topic_views` / `shared_group_views` are written by per-IP-only-limited anonymous endpoints (`app/actions/public.ts`) with no retention sweep; the hourly job purges sessions/buckets/audit-log but not analytics rows. Bot rows are written regardless of `isbot()`.

**Chosen fix (retention sweep in the existing hourly job; configurable window):**
1. Add a `purgeOldViewEvents` (or similar) routine that `DELETE`s `image_views` / `topic_views` / `shared_group_views` rows older than a configurable window. Default window: a generous retention that preserves year-in-review (e.g. `VIEW_RETENTION_DAYS` default ~395-400 days = 13 months). Read the window from env with a sane default (follow the existing env-read convention; do NOT introduce the central env module here — that's a deferred refactor).
2. Wire it into the same hourly GC that already runs `purgeExpiredSessions` / `purgeOldBuckets` / `purgeOldAuditLog` (in `image-queue.ts`), batching the DELETE (chunked, e.g. `LIMIT N` loop) so a large backlog doesn't lock the table.
3. Do NOT add a global anonymous-write ceiling this cycle (optional per the review; the retention sweep is the data-growth fix). Note the optional ceiling for a future plan.
4. Add a test asserting the prune deletes rows older than the window and retains newer ones (mocked db / fake timers, mirroring `audit-retention.test.ts`).
5. Update CLAUDE.md: document the new retention sweep + the `VIEW_RETENTION_DAYS` env + default in the analytics / runtime-topology sections (the docs currently say view tables grow unbounded — correct that).

**Acceptance:** retention sweep runs hourly, batched, deletes only old rows; configurable window with documented default; test added; CLAUDE.md updated; gates green. NOTE: this is an availability/data-growth finding; the sweep is a deletion of OLD analytics rows by an automated job. Per repo destructive-action rules, an automated retention DELETE of aged best-effort analytics is acceptable (analytics view tables are explicitly "not billing/audit-grade"), but make the window generous and configurable, and document it loudly so an operator is never surprised.

---

### TASK-7 — [MEDIUM] Use the configured wide-gamut pixel cap in the upload warning — AGG-M1
**Severity:** MEDIUM · **Confidence:** High · **Agent:** debugger DBG-H2.
`apps/web/src/app/actions/images.ts:298`: replace the hardcoded `50_000_000` with `uploadConfig.wideGamutMaxSourcePixels` (already fetched at line 177) so the upload warning matches actual encoder behavior when an admin tunes the cap. Add/extend a test if a warning-count test exists. **Acceptance:** warning uses the configured value; gates green.

---

### TASK-8 — [MEDIUM] Gate the public HDR badge on `isAdmin` explicitly + lock with a test — AGG-M3
**Severity:** MEDIUM · **Confidence:** Medium · **Agents:** critic CRT-05, architect ARCH-02.
The HDR badge currently renders on `{isHdr && …}` and is only public-safe because `transfer_function`/`is_hdr` are stripped from `publicSelectFields` (an indirect coincidence). Make the honesty invariant explicit:
1. In `components/color-details-section.tsx` (and the mirror in `lightbox-color-pip.tsx` / `info-bottom-sheet.tsx` if they render the badge), gate the public HDR badge on `isAdmin && isHdr` (it is admin-only intent anyway, per the WI-09 honesty rule).
2. Add a test rendering `ColorDetailsSection` with `is_hdr=true` (or `transfer_function='pq'`) and `isAdmin=false`, asserting no `.hdr-badge` / `hdr-badge` in the output, and with `isAdmin=true` asserting it IS present.
**Acceptance:** badge gated on `isAdmin`; test locks both directions; gates green.

---

### TASK-9 — [MEDIUM] Reduced-motion guard for photo-card hover zoom — AGG-M4
**Severity:** MEDIUM (WCAG 2.3.3) · **Confidence:** High · **Agent:** designer DES-01.
Every photo card uses `transition-transform duration-500 group-hover:scale-105` unconditionally, bypassing the runtime `useReducedMotion()` guards used elsewhere.
**Chosen fix (prefer the single global-CSS edit — one change, covers all 6 files + the caption fade DES-08):**
1. Extend the existing `prefers-reduced-motion: reduce` block in `apps/web/src/app/globals.css` to neutralize hover transforms/transitions on photo-card images (e.g. a rule targeting the card image / `.group:hover img` transform → `none !important; transition: none !important`). Verify the selector matches the actual card markup so it doesn't over-reach.
2. (Alternative if the global selector is too blunt: add `motion-safe:` to the `group-hover:scale-105` / `transition-transform` classes in `home-client.tsx:355,370`, `on-this-day-widget.tsx:72`, `(public)/year/[year]/page.tsx:190`, `(public)/timeline/page.tsx:238`, `(public)/g/[key]/page.tsx:230`.)
**Acceptance:** with `prefers-reduced-motion: reduce`, photo-card hover does not animate transform; no regression for default users; gates green. (No automated a11y test exists for this; verify by reading the resulting CSS/markup and reasoning about the cascade.)

---

### TASK-10 — [MEDIUM] Localize the dialog/sheet close-button label — AGG-M5
**Severity:** MEDIUM (WCAG 3.1.2, Korean a11y) · **Confidence:** High · **Agent:** designer DES-02 (verified).
`components/ui/dialog.tsx:53` and `components/ui/sheet.tsx:51` default `closeLabel = "Close"` (rendered in an `sr-only` span). Korean screen-reader users hear English.
1. Add a `common.close` key to BOTH `messages/en.json` AND `messages/ko.json` (keep key parity; ko gets the Korean equivalent) if not already present.
2. Make the primitives fall back to the i18n value when no `closeLabel` is passed — for client components, read via the next-intl client hook in a small wrapper; or make `closeLabel` required and pass `t('common.close')` at every call site. Choose the approach that keeps the shadcn primitive ergonomic and doesn't break SSR.
**Acceptance:** close button announces the localized label in ko; key parity holds; gates green (including the i18n key-parity check).

---

### TASK-11 — [MEDIUM] Add a focus-visible ring to the tag-input field — AGG-M6
**Severity:** MEDIUM (WCAG 2.4.7 / 2.4.11) · **Confidence:** High · **Agent:** designer DES-04 (verified).
`components/tag-input.tsx:199`: the bare `<input className="flex-1 ... outline-none ...">` suppresses the outline with no replacement. Add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` (matching the rest of the codebase). **Acceptance:** keyboard focus shows a visible ring; gates green.

---

### TASK-12 — [MEDIUM] Arm the image-queue GC interval once — AGG-M12
**Severity:** MEDIUM · **Confidence:** Medium · **Agent:** debugger DBG-M1.
`apps/web/src/lib/image-queue.ts:698-705`: each successful bootstrap batch clears + re-arms the hourly GC timer, so during a large multi-batch bootstrap the periodic purges never fire. Guard with `if (!state.gcInterval)` before arming so it's set once. **Acceptance:** GC timer armed once across continuation batches; existing queue tests green (add a focused assertion if feasible); gates green.

---

### TASK-13 — [MEDIUM/SSRF-hardening] Pin the OG internal fetch base to a trusted origin — AGG-M7
**Severity:** MEDIUM (theoretical SSRF/cache-poison) · **Confidence:** Medium · **Agent:** security SEC-01.
`lib/og-photo-fetch.ts:50-54` fetches `${new URL(req.url).origin}/uploads/jpeg/<uuid>`. Derive the fetch base from a trusted source (`seo.url` / an `INTERNAL_ORIGIN` env) instead of the request Host, so a fronting proxy that forwards an arbitrary `Host` can't coerce the OG generator into fetching an attacker origin. The path component is already a validated UUID derivative; the host is the only lever. **Acceptance:** OG internal fetch uses a trusted base, not request-derived; OG generation still works (the canonical origin still resolves the derivative); gates green. NOTE: security-hardening — not deferrable as "theoretical" without a repo rule; it's a cheap one-site change, so schedule it.

---

### TASK-14 — [HIGH-test/MEDIUM-test] DB rate-limit + IP-rollback + session-secret-fallback unit tests — AGG-T1, AGG-T2, AGG-T3
**Severity:** HIGH (T1, T2) / MEDIUM (T3) · **Confidence:** High · **Agent:** test-engineer TEST-01/02/03/04.
The DB-layer rate-limit functions and two auth fallbacks have zero direct coverage; removing their guards would go uncaught.
1. New `apps/web/src/__tests__/rate-limit-db.test.ts` (mocked `db`): assert `incrementRateLimit` uses INSERT + `onDuplicateKeyUpdate`; `decrementRateLimit` wraps UPDATE+DELETE in `db.transaction()` with `GREATEST(count-1, 0)` and the DELETE-when-`<=0`; `resetRateLimit` issues the matching DELETE. (Covers TEST-01 + TEST-04.)
2. Extend `apps/web/src/__tests__/auth-rate-limit.test.ts`: `rollbackLoginRateLimit` (IP-scoped) — record one failure → rollback → IP absent from the map; record two → rollback → count 1, entry present. (Covers TEST-02.)
3. Extend `apps/web/src/__tests__/session-verify.test.ts`: mock `findFirst` to return null then a value, assert the INSERT-IGNORE path is taken once and the re-fetched secret is returned. (Covers TEST-03.)
**Acceptance:** new/extended tests pass and would FAIL if the respective guard were removed (verify by reasoning / temporary mutation); typecheck (which includes `__tests__/`) green; all gates green.

---

### TASK-15 — [LOW] Code-correctness cleanups — AGG-L2, AGG-L5, AGG-M2-adjacent, AGG-L1
**Severity:** LOW · **Confidence:** High/Medium · **Agents:** code-reviewer CR-01/CR-02, debugger DBG-M4.
Batch the small, safe correctness fixes (each its own commit):
1. **AGG-L2** — `gps-exif-strip.ts:147-149`: `if (ifdAbs === tiffStart) return null;` before the IFD loop, routing a zero/header-pointing IFD0 offset to the conservative re-encode fallback (matches the module's own anomaly doctrine). Extend `strip-gps-from-original.test.ts` with a zero-offset fixture asserting the `null`/re-encode path.
2. **AGG-L5** — `process-image.ts` `_verifyWebpIccChunk`: replace `fs.readFile(outputPath)` + `subarray(0,1024)` with a `fileHandle.read(buf, 0, 1024, 0)` 1 KB read, eliminating the full-file allocation.
3. **AGG-L1** — `actions/embeddings.ts` `backfillClipEmbeddings`: it is dead (no caller) and hardcodes stub. Either delete it OR make it mode-aware like the two authoritative writers + add a "no UI wires it yet" comment. Prefer making it mode-aware (cheap, removes the divergence) OR delete (YAGNI) — pick one, document in the commit. CLIP-dark, safe today.
**Acceptance:** each cleanup committed separately; tests added where noted; gates green.

---

### TASK-16 — [DOC] Doc/comment drift corrections — AGG-D1..D6
**Severity:** DOC · **Confidence:** High · **Agents:** document-specialist DOC-01/02/03/05/06, critic CRT-D1/D2, debugger DD-1/DD-2, architect ARCH-07.
Correct every confirmed doc/code mismatch (batch into 1-2 doc commits):
1. **AGG-D1** — `serve-upload.ts:187-190` comment: replace the stale 3-key list with "all 9 COLOR_IMPACTING_KEYS (see settings-hash.ts)".
2. **AGG-D2** — CLAUDE.md line 261: state that BOTH `app/uploads/[...path]` (non-locale, primary for SW HEAD checks) and `app/[locale]/(public)/uploads/[...path]` call `serveUploadFile`.
3. **AGG-D3** — CLAUDE.md line 135 `transfer_function`: add `gamma24` + `gamma26`; drop the misleading "(NCLX)" qualifier (gamma18 is ICC-only).
4. **AGG-D4** — CLAUDE.md admin-tunables table: add `image_quality_webp/avif/jpeg` rows; note `image_sizes` is also a COLOR_IMPACTING_KEY.
5. **AGG-D5** — CLAUDE.md runtime-topology line-194: add admin-backfill-runner status + in-memory rate-limit buckets to the process-local enumeration; add one explicit sentence that flipping a color/quality/size setting does NOT invalidate already-served static derivatives until a backfill re-encode (the CRT-D1 gotcha).
6. **AGG-D6** — `schema.ts:259/266` comment: "base64-encoded TEXT in a MEDIUMBLOB column" (not raw 2048 bytes); `semantic/route.ts` + `similar/[id]/route.ts` docstrings: `PRODUCTION_COSINE_THRESHOLD` is `0.22` (not 0.25); CLAUDE.md line 232: note NCLX matrix 8/10; add `avif_10bit` to the images column table.
**Acceptance:** all comments/docs match code; no behavioral change; gates green.

---

## EXPLICITLY OUT OF SCOPE / DEFERRED THIS CYCLE
See `plan-351-run6-cycle2-deferred.md`. Nothing from the reviews is silently dropped — every remaining finding is recorded there with severity/confidence/reason/exit-criterion.

## Progress
- [ ] TASK-1 Stripe card-only interim guard + test (AGG-H1)
- [ ] TASK-2 wide-gamut-hint JSON.parse guard (AGG-H6)
- [ ] TASK-3 serve-upload abort fd-destroy (AGG-H5)
- [ ] TASK-4 getMapImages LIMIT (AGG-H4)
- [ ] TASK-5 SW LRU running-total + head-walk + coalesce + sw.js regen (AGG-H3)
- [ ] TASK-6 `*_views` retention sweep (AGG-H2)
- [ ] TASK-7 wide-gamut warning configured cap (AGG-M1)
- [ ] TASK-8 explicit isAdmin HDR-badge gate + test (AGG-M3)
- [ ] TASK-9 reduced-motion hover guard (AGG-M4)
- [ ] TASK-10 localize dialog/sheet close label (AGG-M5)
- [ ] TASK-11 tag-input focus ring (AGG-M6)
- [ ] TASK-12 GC interval armed once (AGG-M12)
- [ ] TASK-13 OG fetch trusted-base pin (AGG-M7)
- [ ] TASK-14 DB rate-limit + IP-rollback + session-secret tests (AGG-T1/T2/T3)
- [ ] TASK-15 LOW code cleanups (AGG-L2/L5/L1)
- [ ] TASK-16 doc/comment drift (AGG-D1..D6)
