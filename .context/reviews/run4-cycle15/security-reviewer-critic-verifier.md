# Run-4 Cycle 15 — security-reviewer + critic + verifier angles

Single-subagent in-context execution (documented run-wide constraint).
Full-inventory passes over the cycle-15 rotation set (see
code-reviewer-debugger-tracer.md §Inventory) plus the security-relevant
cross-file flows those surfaces participate in.

## Security pass — rotation surfaces

### Verified clean (no findings)

- **`lib/storage/local.ts`** — full traversal audit:
  `normalizeStorageKey` rejects empty keys, absolute keys, `.`/`..`
  segments and empty segments after backslash normalization;
  `resolve()` re-checks containment via
  `path.resolve(UPLOAD_ROOT, key).startsWith(path.resolve(UPLOAD_ROOT) + path.sep)`
  (the `+ path.sep` blocks the `/uploads-evil` sibling-prefix bypass);
  `createReadStream` lstat-rejects symlinks and non-regular files;
  `getUrl` refuses `original/` keys and percent-encodes each segment.
  Matches the CLAUDE.md File Upload Security contract.
- **`lib/sql-restore-scan.ts`** — conditional comments (`/*!ddddd …*/`)
  are unwrapped BEFORE block-comment stripping and literal masking, so
  version-gated payloads are scanned; allowed app-table DROPs are
  masked positionally (no content shift — `maskMatches` preserves
  length); the dangerous-pattern list covers
  GRANT/REVOKE/RENAME USER/CREATE USER/DDL/DML
  drops/TRUNCATE/DELETE/LOAD DATA/OUTFILE/DUMPFILE/HANDLER/DO/CALL/
  PREPARE/EXECUTE/DELIMITER/SET GLOBAL/hex-binary SET @ vars; tail
  windowing via `appendSqlScanChunk` keeps cross-chunk straddles
  scannable. No bypass found this pass.
- **GA injection (`app/[locale]/layout.tsx:139-149`)** — the GA ID is
  regex-validated (`^(G-[A-Z0-9]+|UA-\d+-\d+)$`) before being
  interpolated, and the inline `gtag('config', …)` argument goes
  through `JSON.stringify`; both `<Script>` tags carry the CSP nonce.
  No injection path from `site-config.json` (file-backed, not
  admin-DB-backed).
- **Map GPS privacy** — `getMapImages()` (lib/data.ts:1521-1556) is the
  only public GPS surface: SQL-level `INNER JOIN … map_visible = true`
  + runtime per-row assertion (defense-in-depth), locked by
  `__tests__/map-privacy.test.ts`. The map page filters null
  coordinates and forwards only id/lat/lng/title/filename/topic.
  Verified no other rotated surface leaks `latitude`/`longitude`.
- **`lib/download-interstitial.ts`** — GET serves a no-claim
  interstitial; claim only on POST; all strings HTML-escaped; the form
  posts to the document's own URL so the token never appears in the
  HTML body; inline-style-only CSP documented.
- **`app/[locale]/admin/login-form.tsx`** — no credential echo; error
  via `role="alert"`; `autoComplete` hints correct
  (`username`/`current-password`); maxLengths bound the request.
- **Layout auth chrome (C1R-03)** — `admin/layout.tsx` renders
  AdminHeader only for `getCurrentUser()`-authenticated sessions;
  `(protected)/layout.tsx` independently redirects via `isAdmin()`;
  middleware guard remains the outer layer. Three-layer defense
  verified intact.
- **`lib/clipboard.ts`** — no clipboard read; write-only; legacy path
  cleans up DOM node.

### Security view of this cycle's findings

- COR-R4C15-01 (global-error OLED): no security consequence — pure
  theme-fidelity defect on the fatal-error surface.
- PERF-R4C15-02 (map popup full-res JPEG): no privacy consequence —
  the base JPEG is already a public derivative under `/uploads/jpeg/`;
  the defect is bandwidth/latency + CDN-bypass only.
- DES-R4C15-03/04/05/06: no security consequence.

## Critic angle

- **COR-R4C15-01 scope note**: the right fix is the *pure-helper
  extraction*, not an inline second `contains('oled')` check —
  `lib/error-shell.ts` exists precisely because this file's helpers
  are untestable in-place (the brand helper made that mistake once and
  was extracted in a prior cycle). An inline fix would re-create the
  asymmetry: brand = tested helper, theme = untested inline logic.
  Demand: helper + both-classes + null-fallback test lock.
- **PERF-R4C15-02 fix-shape**: resist inlining a bespoke
  `_640`-suffix string-build in map-client — `sizedImageFilename`
  already owns dot-handling and nearest-size selection, and the
  search-row component owns the one-shot-fallback idiom. Mirror it
  (small `MarkerThumb` sub-component) so a future
  `IMAGE_PIPELINE_VERSION` bump mid-backfill degrades identically on
  the map and in search. Pass `imageSizes` from the page's cached
  `getGalleryConfig()` — do NOT default to `DEFAULT_IMAGE_SIZES` at the
  call site, because admins can reconfigure `image_sizes` and the map
  would silently 404→fallback on every popup (the fallback masks the
  misconfiguration, costing the full-res download it was meant to
  avoid).
- **DES-R4C15-03 honesty check**: `min-h-[32px]` was a deliberate
  "compact look" decision (`57c15552`), but it predates the 44 px
  blocking policy and the nav's own topic pills already present
  `min-h-[44px]` (`nav-client.tssx:122`) — the 44 px pill IS the
  established visual language of this product. Raising the chips to
  `min-h-11` is consistency, not regression. The pseudo-element
  hit-zone alternative would overlap adjacent rows (flex-wrap `gap-2`
  = 8 px < the 12 px needed), so the visible-height bump is the only
  honest fix.
- **HARD-SCOPE check**: none of this cycle's findings/fixes adds
  edit / culling / scoring / preset features. All tighten existing
  surfaces' fidelity, performance, or accessibility.

## Verifier angle

- Cycle-14 fix commits re-verified independently (see
  code-reviewer-debugger-tracer.md §Regression) — claims in
  plan-299's progress log match the diffs and the test files landed
  (`wide-gamut-predicate-wiring.test.ts` asserts canonical import +
  zero ad-hoc comparisons in all three components; gain-map fixture
  covers tmap+URN-positive).
- **CONFIRMED COR-R4C15-01** by direct evidence chain:
  `themes={[…,'oled']}` (layout) → next-themes class attribute →
  `.oled` selector exists in `globals.css:70` → `detectDarkMode` greps
  only `'dark'` → `<html className={undefined}>` → `:root` light
  tokens. Every link verified in source this cycle.
- **CONFIRMED PERF-R4C15-02** by direct evidence: marker payload
  carries `filename_jpeg` (base name, no size suffix — set from
  `publicMapSelectFields`); popup `<img>` interpolates it raw; no
  `sizedImageUrl`/`imageUrl` import exists in map-client.
- **CONFIRMED DES-R4C15-03** by running the audit semantics mentally
  against the source: `<Badge asChild …>` is not normalized
  (`/<(Button|button)\b/` only) and `min-h-[32px]` matches no
  FORBIDDEN pattern → scanner is structurally blind to this violation
  shape. Also verified `min-h-[32px]` is the only sub-44 arbitrary
  min-h in the scan roots today (grep), so the audit extension lands
  with zero new KNOWN_VIOLATIONS entries.
- Gate baseline: working tree clean at review time except untracked
  review artifacts; vitest baseline from cycle 14: 184 files /
  1759 tests green.
