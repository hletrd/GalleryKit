# Code-Quality Deep Review — GalleryKit (Run 5, Cycle 1)

Reviewer: code-quality lane. Scope: full sweep of `apps/web/src` server actions, lib/, db/, scripts/, API routes, service-worker template, plus cross-file interactions (action ↔ lib ↔ db, queue ↔ settings, SW template ↔ reference impl). This codebase has survived 20+ prior review cycles; nearly every surface is heavily hardened with traceable lineage IDs. The findings below are the residual issues I could substantiate from the code. Coverage is the goal: low-severity and uncertain items are surfaced, not filtered. Ranking/filtering belongs to the consumer.

**Overall verdict: COMMENT.** No CRITICAL or HIGH issue at HIGH confidence. The strongest finding (COR-R5C1-01) is a real but admin-gated robustness gap (MED). The rest are LOW. Spec-compliance is not in scope for a maintenance review of an existing product; Stage-2 quality review only.

---

## Findings

### [COR-R5C1-01] `bulkUpdateImages` accesses TriState `.mode` before validating input shape — uncaught TypeError on malformed payload
- **File:** `apps/web/src/app/actions/images.ts:869-936` (esp. 876, 900, 909, 918, 926, 933)
- **Severity:** MED  **Confidence:** High  **Classification:** confirmed
- **Why it's a problem:** `bulkUpdateImages(input: BulkUpdateImagesInput)` is a `'use server'` action — a same-origin-reachable POST endpoint. After the auth + same-origin gates it destructures `const { ids, topic, titlePrefix, description, licenseTier, ... } = input;` then, BEFORE the `try` block (which starts at line 938), reads `topic.mode` (900), `titlePrefix.mode` (909), `description.mode` (918), `licenseTier.mode` (926). The `ids`/`addTagNames`/`removeTagNames` fields ARE shape-validated (878-897), but the four `TriState` object fields are NOT. If an authenticated admin (or a crafted same-origin request) sends a payload omitting `topic` (or sending `topic: null`, a string, etc.), `topic.mode` throws `TypeError: Cannot read properties of undefined (reading 'mode')`. Because this is outside the try/catch, it escapes as an unhandled server-action rejection → generic framework 500, not the clean `{ error: t('invalidInput') }` every sibling action returns.
- **Failure scenario:** Admin client bug or a hand-rolled same-origin request: `bulkUpdateImages({ ids: [1], addTagNames: [], removeTagNames: [] })` → 500 with a stack-trace-y error instead of a localized validation message. No data corruption (it throws before any DB write), but it is an inconsistent, ungraceful failure on a privileged mutation endpoint.
- **Evidence of the inconsistency:** Sibling actions explicitly guard object/array shape from untrusted runtime payloads — e.g. `batchUpdateImageTags` validates `Array.isArray(addTagNames)` before `.length` (tags.ts:369), and `normalizeStringRecord` rejects non-object/array inputs (sanitize.ts:41). `bulkUpdateImages` is the one mutation that trusts the `TriState` shape implicitly.
- **Suggested fix:** Add a shape guard right after the `ids` checks, before the first `.mode` read:
  ```ts
  const isTriState = (v: unknown): v is TriState<string> =>
      !!v && typeof v === 'object' && 'mode' in v &&
      ['leave','set','clear'].includes((v as {mode?: unknown}).mode as string);
  if (![topic, titlePrefix, description, licenseTier].every(isTriState)) {
      return { error: t('invalidInput') };
  }
  ```
  (or validate each field individually for a more specific message). Also confirm `applyAltSuggested` is already covered — it is (933-936).

---

### [COR-R5C1-02] `sanitizeReferrerHost` stores raw public IPv6 referrers as `referrer_host` instead of `direct`
- **File:** `apps/web/src/lib/analytics.ts:126-138, 149-181` (esp. `isPrivateHost` + `extractTldPlusOne`)
- **Severity:** LOW  **Confidence:** High  **Classification:** confirmed
- **Why it's a problem:** `IPV6_RE = /:/` matches any host containing a colon, but `isPrivateHost` only returns `true` when the host ALSO matches `PRIVATE_IP_RE`. A *public* IPv6 referrer host (e.g. `2001:db8::1` after bracket-strip) is therefore NOT classified private. It then flows to `extractTldPlusOne('2001:db8::1')`, which `split('.')` → no dots → `labels.length <= 2` → returns the raw IPv6 string verbatim. The privacy contract documented at the top of the file ("referrer_host is TLD+1 only … invalid hosts are stored as 'direct'") implies bare IP referrers should collapse to `'direct'`, as IPv4 public addresses effectively do via the eTLD logic returning the bare host too — but a bare IP is not a TLD+1 and arguably should be `'direct'`.
- **Failure scenario:** A visitor arrives with `Referer: https://[2001:db8::1]:8080/x`. The analytics row records `referrer_host = '2001:db8::1'`. Attacker-suppliable (the Referer header is client-controlled), so this is a data-quality / minor analytics-pollution issue, not the visitor's own IP being stored.
- **Suggested fix:** In `sanitizeReferrerHost`, after `isPrivateHost`, treat any bare IPv4/IPv6 literal as `'direct'`:
  ```ts
  if (IPV4_RE.test(rawHost) || (IPV6_RE.test(rawHost) && rawHost.includes(':'))) return 'direct';
  ```
  (place before the same-origin / TLD+1 extraction). Bracket-stripping already happens for the bracketed form inside `isPrivateHost`; mirror it here or normalize once up front.

---

### [COR-R5C1-03] `extractTldPlusOne` two-part-TLD list is a hardcoded subset — silently records over-broad or wrong eTLD+1 for unlisted multi-label TLDs
- **File:** `apps/web/src/lib/analytics.ts:84-124`
- **Severity:** LOW  **Confidence:** Medium  **Classification:** likely (by design, but worth noting)
- **Why it's a problem:** `TWO_PART_TLDS` is an explicit allowlist of ~40 second-level TLDs. For any host under a two-part public suffix NOT in the list (e.g. `co.io`, `gov.sg`, `*.s3.amazonaws.com`, many ccTLD SLDs, or the growing set of vanity TLDs), `extractTldPlusOne` returns `lastTwo` of the literal labels, which can be a registrable-domain-incorrect value (`amazonaws.com` for `bucket.s3.amazonaws.com`, or `something.io` treated correctly but `x.co.io` collapsed to `co.io`). The file itself documents this as "a lightweight approximation; we do not ship the full Public Suffix List."
- **Failure scenario:** Referrer analytics group multiple distinct referrers under one bucket or split one under several, depending on suffix. Pure data-quality; no security impact.
- **Suggested fix:** Accepted trade-off for a personal gallery; no change required. If accuracy ever matters, depend on `psl`/`tldts`. Documented here for completeness so a future "analytics accuracy" task has the pointer.

---

### [COR-R5C1-04] Semantic-search route does DB work (`getGalleryConfig`) before the rate-limit pre-increment
- **File:** `apps/web/src/app/api/search/semantic/route.ts:161-185`
- **Severity:** LOW  **Confidence:** Medium  **Classification:** likely
- **Why it's a problem:** The rate-limit counter is intentionally consumed AFTER cheap validation (documented Pattern-2). But `getGalleryConfig()` (line 164) is a DB read that runs on every same-origin request BEFORE `preIncrementSemanticAttempt` (line 179). So an authenticated same-origin client can spam `getGalleryConfig` DB reads (one indexed SELECT each) without ever consuming the semantic budget, because the `semanticMode !== 'production'` branch (the common default state) returns 503 before the limiter is touched. The guarded resource (embedding CPU) is protected; the config DB read is not.
- **Failure scenario:** When semantic search is disabled (the default), this endpoint is an unmetered `getGalleryConfig` DB-read amplifier for any logged-in/same-origin client. Bounded by same-origin and the config query being cheap, so impact is minor.
- **Suggested fix:** Either (a) move the same-origin/maintenance/mode gates that don't need the limiter ahead of `getGalleryConfig` and keep config read after the limiter, or (b) accept it — `getGalleryConfig` is cached and cheap; the same-origin requirement is the real throttle. Low priority; noted for parity with the checkout/OG routes which charge before their DB lookups.

---

### [COR-R5C1-05] SW image SWR: same-ETag 200 HEAD probe still triggers a redundant full GET revalidate
- **File:** `apps/web/public/sw.template.js:220-236` (and the reference `lib/sw-cache.ts`)
- **Severity:** LOW  **Confidence:** High  **Classification:** confirmed (documented behavior)
- **Why it's a problem:** On the cached-image path, the SW sends a HEAD with `If-None-Match`. A `304` correctly short-circuits (touch meta, serve cached — good). But when the server answers `200` with an ETag *equal* to the cached one (some intermediaries/CDNs strip/alter `If-None-Match` or always 200 on HEAD), control falls through to `startRevalidate()` at line 235, issuing a full GET that re-`put`s byte-identical content and rewrites the whole LRU meta doc. The inline comment (231-234) acknowledges this ("probe answered 200 with the same ETag — the latter still refreshes the entry in background"). The R11-M1/R4C9 optimization that the 304 path delivers is defeated whenever the HEAD yields a same-ETag 200.
- **Failure scenario:** Behind a CDN/proxy that doesn't honor HEAD `If-None-Match`, every cached image view still costs one HEAD + one full GET + one meta rewrite — exactly the N concurrent read-modify-write cycles per gallery paint the 304 path was meant to eliminate.
- **Suggested fix:** When `head.ok` and `networkEtag === cachedEtag`, just `touchMeta` and return `cached` (treat same-ETag 200 like 304). Only dispatch `startRevalidate()` when `networkEtag !== cachedEtag` (already handled at 222-225) or when there's no ETag to compare. This is the documented-but-unfixed perf gap; closing it makes the SWR genuinely lazy.

---

### [COR-R5C1-06] `restoreDatabase` correctness depends on the inner `finally` always running; outer `finally` comment references stale line numbers
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:331-360`
- **Severity:** LOW  **Confidence:** Medium  **Classification:** needs-manual-validation
- **Why it's a problem:** The lock/maintenance teardown (`endRestoreMaintenance()`, queue resume, `RELEASE_LOCK`, `uploadContractLock.release()`) lives in the INNER `finally` (341-354). The OUTER `finally` (355-359) only does `conn.release()` and carries a comment ("already released and nulled … line 360-361") whose line numbers no longer match the current file. The logic is correct as written — the inner finally runs on every path through the inner try, including the `return await runRestore(...)` and the catch'd prepare-failure return at 337. But the safety of "exactly one release on every path" rests entirely on the inner try/finally being reached, which it is only because `beginRestoreMaintenance()` succeeded (310) and we entered the inner try. The early-return paths at 295-296, 307, 328 each manually release the locks they hold — these are the historically bug-prone spots (C7R-RPL-02 fixed one). I could not find a live defect, but the manual-release-on-each-early-return pattern is fragile: a future early-return added between 308 and 331 that forgets to release `LOCK_DB_RESTORE` + `uploadContractLock` would wedge all future restores until the pool connection is evicted.
- **Suggested fix:** No functional change needed today. (1) Update the stale line-number comment at 356-358. (2) Consider hoisting the lock teardown into a single helper invoked from one outer finally guarded by booleans, so new early-returns can't strand the advisory lock. Flagging for manual confirmation that no early-return between maintenance-begin and the inner try leaks a lock.

---

### [COR-R5C1-07] `stripGpsFromOriginal` HEIC/HEIF tier-2 fallback silently retains GPS when the lossless scrubber hits a structural anomaly
- **File:** `apps/web/src/lib/process-image.ts:1538-1544`
- **Severity:** LOW  **Confidence:** High  **Classification:** confirmed (documented limitation)
- **Why it's a problem:** When `stripGpsFromIsobmffBuffer` returns `null` (structural anomaly) for a `.heic`/`.heif`, tier-2 cannot re-encode (prebuilt Sharp has no HEVC encoder), so the function logs `console.error` and `return`s, leaving the on-disk original with its GPS IFD intact. The DB columns are nulled and derivatives are GPS-free, but the paid-download route (`/api/download/[imageId]`) streams this original verbatim — so a purchaser of a structurally-unusual HEIC receives the photographer's GPS coordinates despite `strip_gps_on_upload=true`. This is explicitly documented in the code and CLAUDE.md as an accepted limitation, and is logged loudly at error level.
- **Failure scenario:** Photographer enables `strip_gps_on_upload`, uploads an iPhone HEIC whose box structure defeats the lossless walker (e.g. an exotic `iloc` construction method, or a trailer), sells it; the buyer's downloaded original still contains GPS. Likelihood is low (most HEICs parse cleanly) and the operator gets an error log, but the privacy guarantee is silently incomplete for the affected file.
- **Suggested fix:** Already a known/accepted gap. If the privacy guarantee must be hard, options are: (a) reject the upload when GPS strip cannot be certified on a HEIC (fail-closed), or (b) on tier-2 HEIC failure, refuse to expose the original via the paid-download path (serve a re-encoded JPEG/AVIF derivative-as-original instead). Both are product decisions; flagging so the residual leak path is on the record for this cycle rather than assumed closed.

---

### [COR-R5C1-08] Upload-tracker pre-claim is not released on every early-return inside the `try` in `uploadImages`
- **File:** `apps/web/src/app/actions/images.ts:175-253` (pre-claim at 250-252; early returns at 197-198, 209, 213, 218, 223, 227-228, 233, 243-244)
- **Severity:** LOW  **Confidence:** High  **Classification:** confirmed (not a bug — verified ordering)
- **Why it's noted:** I traced this as a potential leak and confirmed it is NOT one: the tracker pre-claim (`tracker.bytes += totalSize; tracker.count += files.length`) happens at line 250-252, which is AFTER every early-return inside the try (disk-space 209/213, total-size 218, cumulative 223, topic-required 227, slug-format 233, topic-not-found 243). The only early return after the pre-claim is the `totalFailures > 0 && successCount === 0` path (483), which correctly calls `settleUploadTrackerClaim` first (484). The window-limit check at 196-198 returns before the claim. So no quota leak. Recording this as a verified non-finding so the next reviewer doesn't re-flag it. The `uploadContractLock` is always released in the outer `finally` (532-534) regardless. **No action required.**

---

## Cross-file interactions verified (no defect found)

- **Queue ↔ settings lock-once contract:** `uploadImages` and the LR upload route both hold `acquireUploadProcessingContractLock()` across save→insert→enqueue; `updateGallerySettings` checks `hasActiveUploadClaims()` + acquires the same lock before flipping `image_sizes`/`strip_gps_on_upload`. The "lock once photos exist" invariant holds across both ingest paths. Verified consistent.
- **SW template ↔ reference impl:** `public/sw.template.js` LRU/eviction logic mirrors `lib/sw-cache.ts`; the contract test pins drift. `SW_VERSION` bump in the working-tree `sw.js` (build artifact) matches the new HEAD short-SHA. Consistent.
- **Privacy select-field guards:** `data.ts` `publicSelectFields` / `publicMapSelectFields` are derived-by-omission with compile-time `_privacyGuard` / `_mapPrivacyGuard` / `_largePayloadGuard`. The admin-only color/HDR columns (`color_space`, `icc_profile_name`, `pipeline_version`, `is_hdr`, `transfer_function`, etc.) are all omitted from public selects. No leak found.
- **Stripe webhook idempotency:** SELECT-by-sessionId + `ON DUPLICATE KEY UPDATE` + `insertedFresh = affectedRows===1 && insertId>0` correctly distinguishes the true insert from the FOUND_ROWS dup-key loser (R4C3/R4C5). Deleted-image (FK) and zero-amount/coupon paths all return 200 to stop Stripe retries. No double-token / dead-token hazard found.
- **Paid download single-use claim:** open-before-claim ordering, atomic `UPDATE … WHERE downloadedAt IS NULL`, handle-close on every post-open path, RFC-6266/5987 Content-Disposition encoding — all sound. No token-burn-on-missing-file regression.
- **SQL restore scanner:** chunk-boundary tail carry (1MB tail + 1MB chunk) covers patterns spanning boundaries; conditional-comment unwrap + literal masking before the dangerous-pattern pass. No bypass found in the keyword set reviewed.
- **Admin advisory locks** (`deleteAdminUser`, `restoreDatabase`, topic route mutation): dedicated pinned connections, GET_LOCK/RELEASE_LOCK on the same session, release in `finally`. Verified.
- **Rate-limit window-reset:** `getLoginRateLimitEntry`/`getAccountLoginRateLimitEntry` reset `count=0` on expiry without resetting `lastAttempt`, but the caller re-sets `lastAttempt=now` on the increment path and the fast-path check uses the reset count — no stale-window weakening. BoundedMap prune uses `lastAttempt` consistently. Verified.

## Positive observations
- Exceptional defense-in-depth lineage discipline: nearly every guard carries a traceable ID (e.g. SEC-R4C20-01, C8R-RPL-01) and a regression test pin. This is rare and makes the codebase auditable.
- Consistent rate-limit rollback taxonomy (the 4 documented patterns in `rate-limit.ts`) applied uniformly across auth/public/admin/OG surfaces.
- The byte-level GPS scrubber (`gps-exif-strip.ts`) is genuinely careful — bounds-checked ISOBMFF/TIFF/JPEG/WebP walkers with fail-to-reencode fallback, IFD-chain cycle detection, ExtendedXMP boundary reconstruction.
- Compile-time privacy guards (`_PrivacySensitiveKeys`) turn a runtime leak class into a build error.
- BigInt insertId coercion (`safeInsertId`) and codepoint-aware length validation (`countCodePoints`) applied consistently to avoid silent precision/truncation bugs.

## Recommendation
**COMMENT.** Ship-blocking issues: none. Address COR-R5C1-01 (MED) for graceful failure on the bulk-edit endpoint; the LOW items are polish/data-quality and several are documented accepted trade-offs (COR-R5C1-03, -07) or verified non-issues (COR-R5C1-08).
