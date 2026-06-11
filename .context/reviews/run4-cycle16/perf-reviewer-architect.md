# Run-4 Cycle 16 — perf-reviewer + architect angle

Single-subagent in-context pass over the cycle-16 rotation inventory
(list in `code-reviewer-debugger-tracer.md`).

## Performance findings

### COR-R4C16-03 (perf dimension) — CDN bypass on the hottest interactive surfaces

The client-bundle gap in `IMAGE_BASE_URL` (primary write-up in the
code angle) is ALSO the cycle's biggest latent perf issue: the
surfaces that compute URLs client-side are precisely the
bandwidth-heavy ones — lightbox prev/next swaps, viewer preloads,
search-result grids, on-this-day thumbs, map popups. Under a
CDN-fronted deployment every one of those fetches falls back to the
origin box (the 124 G single host), defeating the CDN exactly where
it pays. The SSR'd initial grid would be CDN-served; everything after
first interaction would not. Endorse the dataset-injection fix; the
per-call `document.documentElement.dataset` read is nanoseconds
against multi-hundred-KB image fetches — no memoization needed (and
memoizing would re-introduce a staleness surface).

### Perf re-verification of the rotation set — clean

- `upload-dropzone.tsx`: incremental object-URL map (create/revoke
  only deltas) — the previous all-URLs-recreated-per-render hazard is
  long gone; sequential upload loop is a documented server-lock
  tradeoff (comment at lines 266-270), not a perf bug.
- `image-zoom.tsx`: ref-based DOM transforms (zero re-renders on
  move); wheel listener non-passive only on the container; reduced-
  motion via ref. The double-tap anchor fix (UX-R4C16-06) must keep
  this zero-re-render property — anchor math is pure arithmetic.
- `sales-client.tsx`: `useMemo`'d currency formatter + revenue
  reduce; table scale is operator-bounded. Fine.
- `settings-client.tsx`: `hasDirtyBackfillField` recomputes a
  9-element set scan per render — trivial.
- `bulk-edit-dialog.tsx`: controlled inputs in a dialog — fine.
- `content-security-policy.ts`: built once per request in middleware;
  string concat of ~12 directives — negligible.
- `avif-support.ts` / `lazy-focus-trap.tsx` /
  `register-service-worker.tsx`: singleton/lazy patterns correct.
- `manifest.ts`: `force-dynamic` + one settings query per fetch —
  manifest is fetched rarely (install/update); acceptable.
- Icon routes (`icon.tsx`, `apple-icon.tsx`): ImageResponse rendered
  per request but cached by route handler defaults; 32/180 px SVG
  rasterization is cheap. Fine.

## Architecture findings

### ARCH note on COR-R4C16-01 — the repo has no owned async-confirm idiom, so each consumer reinvents it

Six AlertDialog consumers, three distinct broken shapes (auto-close
with dead label; dismiss-before-await; dismiss-in-onClick) and one
correct implementation (tag-manager, c14). This is the run's
recurring failure mode again: a correct canonical instance exists and
siblings silently diverge. The fix direction (mechanical call-site
alignment + source-inspection lock) is the architecturally right
LEAST-power move — a new wrapper primitive would create a second
idiom while the lock test makes the existing one self-enforcing.
Cross-ref: critic angle agrees for different reasons (audit-suite
blindness to new primitives).

### ARCH note on COR-R4C16-03 — build-time vs runtime config boundary

`constants.ts` exports three values with DIFFERENT effective scopes:
`LOCALES`/`DEFAULT_LOCALE` (universal), `BASE_URL` (server-only
consumers today), `IMAGE_BASE_URL` (universal consumers, server-only
value — the bug). The dataset fix should leave a one-line comment on
each constant documenting its scope so the next universal consumer of
`BASE_URL` doesn't repeat this. (`BASE_URL` is currently only used in
server contexts — metadata, sitemap, feeds — verified by grep; no
second instance of the bug today.)

### Clean

- Layering: rotation libs are dependency-clean (constants → image-url
  → components; no cycles).
- `revalidation.ts` O(N×L) note still accurate at 2 locales.
- `feed-conditional.ts` shared by both feed routes — single source
  held.
- No new cross-boundary imports of server-only modules into client
  components found in the rotation set (grep for `next/headers`,
  `node:`-prefixed, `fs`, `mysql2` under components/ — clean).
