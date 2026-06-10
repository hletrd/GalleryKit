# Run-4 Cycle 6 — code-reviewer + debugger + tracer angle

Inventory: regression review of all 6 cycle-5 fix commits (f772652d,
4b404db0, 9d14021b, d1351e37, a5515a14, f2ab0034) plus the SW_VERSION
build commit; full reads of `lib/data-timeline.ts`, the timeline page,
the year page, `on-this-day-widget.tsx`, `lib/analytics-data.ts`,
`lib/audit.ts`, `lib/atom-feed.ts`, `lib/feed-conditional.ts`,
`app/feed.xml/route.ts`, `lib/exif-datetime.ts`, `lib/sw-cache.ts`,
`public/sw.template.js`, `scripts/build-sw.ts`,
`components/register-service-worker.tsx`, `components/lightbox.tsx`
(full), `components/photo-viewer.tsx` (full), `components/search.tsx`
(full), `components/tag-input.tsx` (keyboard region),
`components/image-manager.tsx` (dialog region),
`api/search/semantic/route.ts` (full), `api/checkout/[imageId]/route.ts`
(full), `proxy.ts`, `instrumentation.ts`, `app/robots.ts`,
`app/manifest.ts`, `lib/auth-rate-limit.ts`, `next.config.ts`,
`nginx/default.conf` (uploads region), sales admin client. Pattern sweeps:
`isComposing` (repo-wide — zero hits), `key === 'Enter'` handler census,
`revalidate` exports, `lr:read|lr:delete` consumers.

## Regression review of cycle-5 commits — VERDICT: sound

- **f772652d (smart-collection cursor)** — traced `normalizeImageListCursor`
  → `buildCursorCondition` through `getImagesForSmartCollection`; the
  cursor path skips `.offset()`, the offset path floors/clamps exactly as
  before; the action's invalid-object fail-closed branch mirrors
  `loadMoreImages`. The `safeLimit` (not `safeLimit + 1`) hand-off plus
  the helper's internal single lookahead is correct; `.slice` removal is
  right because `normalizePaginatedRows` already trims. No regression.
- **4b404db0** — export deleted; resurrection lock present. No remaining
  importer (grep). Sound.
- **9d14021b** — both collections catches and the embeddings catch now
  log detail server-side and return localized keys; EN+KO keys landed
  together (parity check: 0 en-only / 0 ko-only). Sound.
- **d1351e37** — `openedHandle` alias assigned immediately after
  `open()`; catch closes via optional-chain before ENOENT mapping; close
  failure swallowed (`.catch(() => undefined)`) so the original error
  mapping is preserved. Token-claim ordering unchanged. Sound.
- **a5515a14** — `/\.+$/` strips all trailing dots; can produce empty
  string for `"..."` host — downstream `labels.length <= 2` returns the
  empty string which the caller records as-is; same behavior class as
  pre-fix for degenerate hosts, acceptable. Sound.
- **f2ab0034** — `affectedRows === 1 && insertId > 0` conjunction: fresh
  insert (1, id>0) accepted; FOUND_ROWS no-op loser (1, 0) rejected;
  changed-value dup (2, id) rejected by the affectedRows term regardless
  of insertId. AUTO_INCREMENT PK guarantees insertId > 0 on true insert.
  Sound.

## Findings

### COR-R4C6-01 — No IME composition guards on ANY Enter/Arrow key handler (Korean input broken at commit points)
- **Severity/Confidence: MED-HIGH / High**
- **Files:**
  - `apps/web/src/components/tag-input.tsx:96-141` (`handleKeyDown`)
  - `apps/web/src/components/search.tsx:327-338` (input `onKeyDown`),
    `:232-244` (window `keydown` Escape)
  - `apps/web/src/components/image-manager.tsx:336-341` (batch-add tag input)
  - `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:~337` (inline rename input)
  - `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:162` (token-name input)
- **Evidence:** repo-wide grep for `isComposing` / `keyCode === 229` /
  `composition` returns ZERO hits, while 5 text inputs run actions on
  `Enter`.
- **Why it's a problem:** With a CJK IME (Korean is this product's
  second first-class locale), pressing Enter to COMMIT the current
  composition fires `keydown` with `KeyboardEvent.isComposing === true`
  (Safari additionally reports `keyCode === 229`). None of these handlers
  check it, so the commit keystroke is treated as a submit.
- **Concrete failure scenarios:**
  1. Admin types `음악` in the tag input. Pressing Enter to commit the
     final syllable ADDS the half-state tag immediately (and `reset()`
     clears the input mid-word). Tags become un-typeable in Korean
     without a mouse.
  2. In search, ArrowDown was pressed earlier (activeIndex ≥ 0); the
     IME-commit Enter `click()`s the highlighted result and navigates
     away, destroying the in-progress query. ArrowUp/ArrowDown
     `preventDefault()` also hijacks IME candidate-list navigation.
  3. Inline rename (topic-manager) / batch tag (image-manager) / token
     create (tokens-client): IME-commit Enter saves a truncated value or
     creates a token early.
  4. Escape during composition in search closes the entire dialog
     instead of merely cancelling the composition.
- **Fix:** shared guard (e.g. `isImeComposingEvent(e)` checking
  `e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229` for React
  synthetic events and `e.isComposing || e.keyCode === 229` for native
  listeners), returned-from FIRST in each affected handler. Unit tests
  with synthetic events.

### COR-R4C6-02 — /timeline and /year/[year] silently drop everything beyond the most recent 100 photos of a year
- **Severity/Confidence: MED / High**
- **Files:** `apps/web/src/lib/data-timeline.ts:126` (`TIMELINE_PAGE_LIMIT = 100`),
  `:156` (`.limit(TIMELINE_PAGE_LIMIT)`),
  `apps/web/src/app/[locale]/(public)/timeline/page.tsx:55-58`,
  `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:56-63`
- **Why it's a problem:** `getTimelineImages(year)` is ordered
  `capture_date DESC` and hard-capped at 100 with no pagination and no
  truncation signal. A 300-photo year shows roughly Oct–Dec only; the
  months of January–September VANISH from both the timeline groups and
  the "Year in review" month sections. The page presents itself as the
  complete year (month headings with counts, ImageGallery JSON-LD).
  Searched every prior review/plan for `TIMELINE_PAGE_LIMIT` — never
  flagged, never deferred.
- **Concrete failure scenario:** photographer uploads a 9-month, 400-photo
  travel archive for 2024; `/year/2024` renders only the last ~100 by
  capture date; a client browsing the "year in review" concludes the
  photographer didn't shoot January–August.
- **Fix:** raise the cap to a personal-gallery-safe bound (500) AND
  surface truncation honestly — return rows + a `truncated` flag (fetch
  limit+1), render a localized "showing the N most recent photos"
  notice on both pages when set. EN+KO keys together.

### COR-R4C6-07 — search.tsx semantic branch: stale-response overwrite after the second await
- **Severity/Confidence: LOW / High**
- **File:** `apps/web/src/components/search.tsx:158-185`
- The keyword branch re-checks `requestId === requestIdRef.current`
  after its await (line 188); the semantic branch checks after `fetch`
  (line 158) but NOT after `await resp.json()` (line 169) before
  `setResults(...)` (line 183). A slow JSON body from request A can
  overwrite request B's fresher results.
- **Fix:** re-check the requestId after `resp.json()` resolves.

### COR-R4C6-08 — checkout route: DB reads sit outside the try — rate-limit charge not rolled back on infrastructure error
- **Severity/Confidence: LOW / High**
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:97-120`
- The route pre-increments the per-IP budget (line 76), then runs
  `db.select` (image fetch, line 97) and `getTierPriceCents` (line 116)
  OUTSIDE the try/catch that wraps only the Stripe call. A transient DB
  error therefore (a) escapes as an unhandled route error → framework
  500 without the NO_STORE headers, and (b) permanently consumes the
  visitor's rate budget, violating the route's own documented Pattern-2
  contract ("rollback on every early-return"). The semantic-search route
  wraps its DB call and rolls back; this route predates that posture.
- **Fix:** wrap the image fetch + price read in try/catch →
  `rollbackCheckoutAttempt(ip)` + JSON 500 with NO_STORE.

### COR-R4C6-10 — purgeOldAuditLog: negative retention env nukes the whole audit log
- **Severity/Confidence: LOW / Medium**
- **File:** `apps/web/src/lib/audit.ts:57-68`
- `Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10) || 90`
  accepts negative integers (`-1` → cutoff in the FUTURE → `lt(created_at,
  future)` deletes every row). `0` and NaN safely fall to 90 via `||`,
  negatives do not.
- **Fix:** validate `Number.isFinite(d) && d > 0` before use; fall back
  to 90 otherwise.

### COR-R4C6-12 — lightbox Space handler: preventDefault before the editable-target check
- **Severity/Confidence: LOW / Medium (latent)**
- **File:** `apps/web/src/components/lightbox.tsx:288-295`
- `e.preventDefault(); e.stopPropagation(); if (isEditableTarget(e)) return;`
  — the order suppresses typing a literal space in any editable target
  while the lightbox is open. No editable targets exist inside the
  lightbox today, so the bug is latent; the guard exists precisely to
  protect this case and is currently ineffective.
- **Fix:** hoist `isEditableTarget` above `preventDefault`.

## Verified clean (this angle)
- `lib/analytics-data.ts` — alias ORDER BY valid in MySQL; window math
  correct; innerJoins intentionally exclude deleted targets.
- `lib/exif-datetime.ts` — UTC-pinned parse+format both directions; the
  timeline pages' `new Date('YYYY-MM-DD HH:mm:ss').getMonth()` local
  parse extracts the literal stored month (schema `mode: 'string'`
  confirmed) — no TZ skew in month grouping.
- `lib/audit.ts` insert path — surrogate-safe truncation, serialization
  failure fallback.
- `feed.xml` route — toIso fallback chain, per-entry author dedup, R25-M1
  size resolution against live config.
- `instrumentation.ts` — single registration, Promise.race-bounded
  drain, process.once.
- `lib/auth-rate-limit.ts` — decrement-not-delete rollback, bounded maps.
- `proxy.ts` — admin guard pathname logic (login page exclusion both
  locales), token shape pre-check, CSP nonce propagation.
- photo-viewer navigate() stale-closure guards; preload link cleanup;
  checkout toast run-once + query-param strip.
