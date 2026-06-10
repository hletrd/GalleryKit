# Run-4 Cycle 6 — document-specialist angle

Inventory: CLAUDE.md serving/security/PWA claims vs live production
behavior; sw.template.js header comment vs reality; nginx/default.conf
comments; serve-upload.ts docstrings; RFC 4287 conformance of
atom-feed.ts; standing-deferral exit-criterion re-audit; data-timeline
docstrings vs index reality.

## Doc/code mismatches

### DOC-R4C6-A (part of ARCH-R4C6-06) — CLAUDE.md serving claims are false in production
- CLAUDE.md "File Upload Security → Headers": *"X-Content-Type-Options:
  nosniff, immutable cache-control"* — production derivatives carry
  `public, max-age=0` (Next static path; live-verified), and the repo's
  OWN serve-upload.ts deliberately rejects `immutable`
  (`max-age=3600, must-revalidate`, lines 183/216-238) because backfill
  rewrites bytes in place.
- CLAUDE.md "ETag / cache invalidation": presents the
  `W/"v7-{mtime}-{size}-{settingsHash}"` formula as the serving
  behavior. In production the Next static server's `W/"{size}-{mtime}"`
  ETag is what clients see for every existing derivative; the
  serve-upload route only executes for locale-prefixed and missing
  paths (public/ assets take precedence over route handlers).
- Fix with ARCH-R4C6-06: rewrite both sections to describe the layered
  reality + the unified cache policy, and note the static-first
  precedence explicitly so future serving work targets the right layer.

### DOC-R4C6-B (part of COR-R4C6-05) — sw.template.js header comment advertises a dead feature
- *"HTML routes: network-first, 24 h fallback cache"* — the fallback
  cache is provably empty in production (every public page is
  `revalidate = 0` → `no-store` → `isSensitiveResponse` blocks `put`).
  The CLAUDE.md PWA references inherit the claim. Update both with the
  fixed behavior (offline-only exemption + admin-render exclusion).

### STD-R4C6-09 — RFC 4287 conformance: `type="text"` on `<author><name>`
- **Severity/Confidence: LOW / Medium-High**
- **File:** `apps/web/src/lib/atom-feed.ts:96` (`renderAuthorBlock`)
- RFC 4287 §3.2: `atomPersonConstruct = atomCommonAttributes, (element
  atom:name { text } & …)` — atom:name is NOT a Text construct and
  admits no `type` attribute (atomCommonAttributes = xml:base, xml:lang,
  namespaced foreign attributes only). The R18-L2 change ("explicit
  type='text' … per RFC 4287 §3.1.1") correctly targeted `<title>` /
  `<summary>` / `<rights>` (Text constructs) but overshot onto the
  Person construct's `<name>`, making the feed schema-invalid; the W3C
  feed validator flags unexpected attributes on atom:name. Readers
  ignore it (well-formed XML), so impact is validator noise +
  conformance only.
- **Fix:** emit `<name>` bare; update the atom-feed test fixture in the
  same commit (it currently pins the wrong serialization).

### Comment corrections (folded into parent fixes)
- `lib/data-timeline.ts:132-134` claims `YEAR(capture_date) = ?` "is
  covered by idx_images_processed_capture_date … capture_date LIKE
  '<year>-%'" — YEAR() is non-sargable; only the `processed` prefix of
  the index is used. Correct the comment with COR-R4C6-02.
- `sw.template.js:53-56` `hasAdminSession` comment implies the Cookie
  header is readable — replaced wholesale by the COR-R4C6-05 fix.

## Standing-deferral re-audit (all remain validly deferred; exit criteria un-triggered)
- **DEF-R4C1-01** (LR route `revalidateAllAppData()` breadth; plan-274):
  exit = ISR reintroduction on any public route. Checked: all 9 public
  pages still export `revalidate = 0` (grep evidence this cycle).
  Remains deferred.
- **DEF-R4C2-01** (tokens UI grants all three scopes; plan-276): exit =
  first endpoint consuming `lr:read` / `lr:delete`. Checked: scopes
  appear only in `lib/admin-tokens.ts` declarations, an api-auth comment,
  and the granting UI. Remains deferred.
- **DEF-R4C3-01** (LR upload ROUTE error strings English-only; plan-278):
  exit = LR plugin localization or a browser consumer. Checked: the
  route's only consumer remains the Lightroom plugin (machine client).
  Remains deferred.

## Verified accurate (spot checks)
- CLAUDE.md gate list matches package.json scripts (four lint scripts +
  typecheck + vitest + e2e).
- Migration runbook still matches `scripts/migrate.js` behavior
  (hash-presence postcondition intact).
- Backfill operational pattern matches `backfill-color-pipeline.ts`
  flags and the advisory-lock name.
- README/UPLOAD limits language consistent with `upload-limits.ts`
  constants and nginx body caps (2 MiB default / 64 KiB login / 250 MiB
  db / 216 MiB dashboard — present in nginx/default.conf).
