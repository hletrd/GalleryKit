# Run-4 Cycle 3 — perf-reviewer + architect + document-specialist + designer angle

Scope: hot-path serving (`serve-upload.ts` + both route handlers + settings-hash +
gallery-config), queue/bootstrap costs, feed/OG caching posture, semantic-search scan
bounds, doc-code contract checks (CLAUDE.md, settings-hash docstring, route comments),
UI surfaces touched last cycle (failed-images panel) + i18n posture of API errors.

## Findings

### PERF-R4C3-05 — image-serving hot path runs one `admin_settings` SELECT per request; the documented 5 s debounce is bypassed
- **Severity/Confidence:** MEDIUM / High (confirmed by direct data-flow reading)
- **Files:**
  - `apps/web/src/lib/serve-upload.ts:125-127` — `const config = await
    getGalleryConfig(); const settingsHash = await getColorSettingsHash(config);`
  - `apps/web/src/lib/gallery-config.ts:203-204` — `getGalleryConfig =
    cache(_getGalleryConfig)`: React `cache()` scope is a SINGLE request; every
    image GET/HEAD is its own request, so every derivative fetch performs the
    full settings SELECT.
  - `apps/web/src/lib/settings-hash.ts:108-113` — `getColorSettingsHash(config?)`
    short-circuits to `buildHashFromConfig(config)` whenever a config is passed,
    skipping the module's 5-second TTL cache + inflight dedupe entirely.
- **Why it's a problem:** the settings-hash docstring (lines 19-21, 103-106)
  promises "The DB read is debounced behind a 5-second cache so a misbehaving DB
  does not stall image responses" and "a flood of image requests does not issue
  one DB SELECT per file." Since R8-H1 routed the call through
  `getGalleryConfig()` (to hash VALIDATED values — a good fix), both claims are
  false on the only production caller: each of the N images on a gallery page
  issues its own `admin_settings` SELECT just to compute the ETag — including
  304 revalidations and SW HEAD probes, the cheapest responses we serve. On a
  masonry first paint (≈30-50 derivatives) that is 30-50 extra DB round-trips
  per page view; a misbehaving DB now stalls every image response (the exact
  failure the docstring says is prevented — only the no-arg fallback path keeps
  the FALLBACK_HASH guarantee).
- **Fix (preserves R8-H1 semantics):** add a module-scoped 5 s TTL + inflight
  dedupe around the resolved-config fetch used by the serving path (e.g.
  `getGalleryConfigForServingCached()` in serve-upload or a
  `getColorSettingsHashCached()` that itself calls `getGalleryConfig()` behind
  the TTL). Admin flips a color setting → ETag updates within ≤5 s — the same
  skew window settings-hash already documents as acceptable. Keep validated-value
  hashing. Update the settings-hash docstring to describe the actual contract.
- **Class:** confirmed perf + doc-code mismatch.

### ARCH-R4C3-06 — uploads GET/HEAD twin routes have no drift guard
- **Severity/Confidence:** LOW / High (one drift has now actually happened —
  COR-R4C3-01)
- **Files:** `apps/web/src/app/uploads/[...path]/route.ts`,
  `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`.
- **Why:** two hand-maintained copies of the same 2-export handler pair; R20-L1
  updated one and not the other. Rather than a refactor (out of scope for the
  fix loop), lock the contract with a source-level wiring test asserting both
  files pass `'GET'`/`'HEAD'` through to `serveUploadFile` (see TEST-R4C3-07).
  Fold into the COR-R4C3-01 fix.

### DOC-R4C3 — observations (no separate fix tasks)
- settings-hash docstring mismatch → folded into PERF-R4C3-05.
- Stale pre-R20-L1 comment in the non-locale HEAD handler → folded into
  COR-R4C3-01.
- CLAUDE.md spot-checks PASS: advisory-lock inventory matches code
  (`advisory-locks.ts`); upload caps (200 MiB / 2 GiB / 100 files) match
  `upload-limits.ts` + `process-image.ts` single-source constant; backfill
  column-set contract matches `admin-backfill-runner.ts`; migration runbook
  matches `migrate.js` behavior.

## Designer / UX pass

- **Failed-images panel (last cycle's UX-R4C2-03):** verified live markup —
  deterministic `aria-hidden` ImageOff tile + title/user_filename/`ID n` text +
  truncated `processing_error` line. Good. The `size="sm"` retry button is a
  documented touch-target exemption for the keyboard-primary admin dashboard
  (KNOWN_VIOLATIONS ledger in touch-target-audit.test.ts) — no new violation
  introduced (audit test green on baseline).
- **UX-R4C3-OBS-A (observation, LOW/Low):** `/api/admin/lr/upload` error strings
  are hardcoded English. The consumer is the Lightroom plugin (machine client
  surfacing messages in its own dialog); next-intl localization there would not
  reach the plugin UI today. No action this cycle; revisit if the plugin gains
  localization.
- No new public-UI changes since the cycle-2 designer pass; public surfaces
  unchanged this cycle (verified via git diff inventory). Browser-interactive
  re-audit deferred to the next cycle that touches public components, per the
  established cadence (run4-cycle1/2 followed the same rule).

## Perf verified-clean (no finding)
- Feed route: 600 s/1800 s cache + If-Modified-Since 304 path — sound.
- OG photo route: rate-limited (30/min/IP), sized-derivative fallback chain
  bounded, Satori output post-processed once. Sound.
- Semantic search: hard 5000-row scan cap, 8 KiB body cap, Pattern-2 rollback.
  Sound.
- Queue bootstrap: 500-row batches with cursor; cleanup parallelized; GC hourly
  with unref. Sound.
