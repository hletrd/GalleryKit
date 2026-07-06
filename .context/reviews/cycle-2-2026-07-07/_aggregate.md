# Run-10 Cycle 2/100 — Aggregated Review (2026-07-07)

Start HEAD: `642c5091` (reviews ran against it); the mandatory carry-over Docker fix landed
mid-review as `223b3836` (verified in-container: negative control reproduced TS2307, fixed
builder stage passes with drizzle-kit at the nested path).

12 lanes spawned: code-reviewer, perf-reviewer (general-purpose), security-reviewer, critic,
verifier, test-engineer, tracer, architect, debugger, document-specialist, designer,
feature-dev-code-reviewer (secondary). Eleven wrote `.context/reviews/<agent>.md`; the
secondary code reviewer returns via message (see AGENT FAILURES / addendum note at bottom).

Note: an earlier identical fan-out earlier this same cycle was killed by an API session limit
before any lane produced output; this aggregate is from the re-spawned fan-out.

## Cross-agent agreement (highest signal)

- **Docker/workspace hoisting class** — carry-over (deploy failure) + ARCH-07 (runner-stage
  same class). CLOSED this cycle by `223b3836` (deps/prod-deps `mkdir -p`, builder+runner
  nested COPY, `.dockerignore` `**/node_modules`/`**/.next`/`**/._*`).
- **Pool 10 + `revalidate = 0` throughput ceiling** — ARCH-02 + PERF-13 + CRIT-01/CRIT-03
  (3 lanes). The public SSR page surface has zero rate limiting at any layer while the API
  surface is exhaustively limited; the lint gate is structurally blind to `page.tsx`.
- **`reconcileLegacySchema` / journal drift guards** — CQ-05 + ARCH-04 + ARCH-05 (2 lanes).
  NOTE: test-engineer's sweep found `migration-journal-monotonicity.test.ts` and
  `migrate-reconcile-coverage.test.ts` already exist — planning must verify what they pin
  before scheduling anything.
- **Per-process coordination state vs scale-out** — ARCH-01 (HIGH) + SEC-06 + TRC-07.
  Documented single-writer topology has no code-level guard.
- **Touch-state React re-renders vs ref-based idiom** — PERF-08 + PERF-19 (same fix idiom).

## Merged findings ledger (deduped; highest severity/confidence preserved)

### HIGH
| ID | Sev/Conf | Source(s) | Location | Title |
|----|---------|-----------|----------|-------|
| C2-01 | HIGH/High | designer UX-01 | `photo-viewer.tsx:518`, `lightbox.tsx:434-450`, `info-bottom-sheet.tsx` | Focus lost to `<body>` after closing Lightbox / mobile Info sheet (live-reproduced 3×; Search dialog proves the correct pattern exists) |
| C2-02 | HIGH/High | tracer TRC-01 | `actions/settings.ts:86-182`, `settings-hash.ts:47` | 7 of 9 byte-impacting settings accepted with no warning/stale marker/backfill prompt; gallery silently serves mixed-quality derivatives |
| C2-03 | HIGH/High | architect ARCH-01 (+SEC-06, TRC-07) | `admin-mutation-barrier.ts`, `upload-tracker-state.ts`, `image-queue.ts`, `data.ts:18` | Single-writer topology enforced only by prose; scale-out silently desyncs restore fence/quota/rate state |
| C2-04 | MED-HIGH/High | designer UX-03 | live `/en/p/99999999` etc → HTTP 200 | Soft 404: all not-found routes return 200 (SEO/monitoring damage); layer (Next standalone vs nginx vs locale layout) needs isolation |

### MEDIUM
| ID | Sev/Conf | Source(s) | Location | Title |
|----|---------|-----------|----------|-------|
| C2-05 | MED/High | debugger DBG-01 | `color-detection.ts:230-296`, `gain-map-detection.ts:63-81` | ISOBMFF child-box size validated only against buffer length, not parent end (empirically reproduced); feeds the HDR upload-accept gate; `gps-exif-strip.ts:411` has the correct pattern |
| C2-06 | MED/High | critic CRIT-01 (+ARCH-02, PERF-13) | `nginx/default.conf:201`, public `page.tsx` | Public SSR pages unthrottled at every layer; single IP can pin the pool via `/map`/`/` sweeps |
| C2-07 | MED/High | critic CRIT-03 | `scripts/check-public-route-rate-limit.ts` | Rate-limit gate blind to `page.tsx` — steers hardening to cheap routes (process finding behind C2-06) |
| C2-08 | MED/High | tracer TRC-02 | `image-queue.ts:113-134` | Queue concurrency computed from duplicated local pool constant, not `POOL_CONNECTION_LIMIT` from `@/db` |
| C2-09 | MED/High | tracer TRC-06 | `lib/audit.ts` + all call sites | Audit writes `.catch(console.debug)` — forensic records silently dropped under DB stress |
| C2-10 | MED/Low-Med | tracer TRC-04 | `gallery-config.ts:186`, `image-queue.ts:429,673,791` | React `cache()`-wrapped config called from detached queue tasks outside request scope (needs runtime verification) |
| C2-11 | MED/High | perf PERF-01 | `sw.template.js:219-223,316-338`, `lib/sw-cache.ts` | SW rewrites full cached image body on every 304-confirmed view (write amplification on warm paints) |
| C2-12 | MED/High | perf PERF-02 | `map-client.tsx:120-139` | Up to 10k individual Leaflet DOM markers, no clustering |
| C2-13 | MED/High | perf PERF-03 | `data.ts:516-528` | `getTopics()` correlated `MAX(updated_at)` subquery runs per anonymous render of every hot page |
| C2-14 | MED/High | perf PERF-04 | `clip-embeddings.ts:104-113`, semantic/similar routes | ~4 MB scan + ~1M `readFloatLE` calls per request; zero-copy `Float32Array` view + TTL matrix cache |
| C2-15 | MED/High | perf PERF-05 | `actions/public.ts:436-529` | 4 sequential DB round-trips per anonymous view record |
| C2-16 | MED/Med | perf PERF-06 | `data-timeline.ts:97-119` + home widget | Non-sargable MONTH()/DAY() scans per home render |
| C2-17 | MED/High | perf PERF-07 | `actions/tags.ts:90-105,160-174` | updateTag/deleteTag materialize all image IDs into unbounded `IN (...)` in a transaction |
| C2-18 | MED/High | perf PERF-08 (+PERF-19) | `info-bottom-sheet.tsx:89-94`, `photo-navigation.tsx:115` | Per-touchmove React state updates re-render full subtree during drag/swipe |
| C2-19 | MED/High | perf PERF-09 | `home-client.tsx:310-438` | No card memoization — every infinite-scroll append re-renders all loaded cards |
| C2-20 | MED/High | perf PERF-10 | `process-image.ts:1752` | GPS strip reads entire ≤200 MB original into memory per file |
| C2-21 | MED/High | perf PERF-11 | `data.ts:841-873,1692-1703` | Feed/sitemap `ORDER BY updated_at` unindexed → full filesort of processed set |
| C2-22 | MED/High | test TEST-01 | `rate-limit.ts:451-474` | `checkRateLimit` (DB half of the two-tier limiter) has zero direct test |
| C2-23 | MED/High | test TEST-02 | `editable-target.ts:9-30` | Keyboard-shortcut input guard has no direct unit test |
| C2-24 | MED/High | architect ARCH-03 | 15 modules import `@/site-config.json`; compose mounts it `:ro` | site-config is build-inlined; the runtime mount is inert; DB-overridable vs file-only precedence is split |
| C2-25 | MED/High | architect ARCH-04 | `drizzle/meta/_journal.json` | Journal non-monotonic by design; verify existing monotonicity test pins the authoring rule |
| C2-26 | MED/Med | architect ARCH-05 (+CQ-05) | `scripts/migrate.js:317-718` | reconcileLegacySchema hand-mirror drift; verify existing `migrate-reconcile-coverage.test.ts` |
| C2-27 | MED/High | architect ARCH-06 | `src/lib/storage/*` | Unwired S3-shaped abstraction (quarantined by test; product decision to delete/trim) |
| C2-28 | MED-LOW/Med-High | perf PERF-12 | `image-manager.tsx:502`, `tag-input.tsx:58-166` | Admin table per-row memo-defeat + per-row document listeners |

### LOW / INFO (grouped)
- C2-29 (LOW/High, critic CRIT-02): sitemap budget omits feed rows → >50k URLs at scale (`sitemap.ts:44-49,90-112`).
- C2-30 (LOW/High, critic CRIT-04): restore drain aborts on slots held through post-commit file cleanup (`images.ts:772`, `admin-mutation-barrier.ts`).
- C2-31 (LOW/High, critic CRIT-05): scanner ossification — prose edited to appease regex scanner; tokenize string-stripping.
- C2-32 (LOW/High, code CQ-01): processing-error retry has no backoff (`image-queue.ts:822-829`).
- C2-33 (LOW/Med, code CQ-02): duplicate hourly GC timer on defensive state re-init (`image-queue.ts:104,337-350,1102-1112`).
- C2-34 (LOW→MED-at-scale/Med, code CQ-03): `bootstrapMissingActiveEmbeddings` uncapped full-table walk (`image-queue.ts:426-482`).
- C2-35 (LOW/Med, code CQ-04): admin backfill lacks permanent-failure tracking; corrupt row re-attempted every run.
- C2-36 (LOW/High, debugger DBG-02): rows/count atomicity window after `3000bb05` split — doc-comment remedy proportionate.
- C2-37 (LOW/Med, security SEC-05): malformed runtime `IMAGE_BASE_URL` throws in middleware → full outage; wrap CSP build in try/catch fallback.
- C2-38 (LOW/High, security SEC-02): prod CSP `style-src 'unsafe-inline'` (accepted Next/Tailwind trade-off; optional).
- C2-39 (LOW/Med, security SEC-01): restore SQL denylist inherently bypassable (defense-in-depth, admin-gated; keep).
- C2-40 (INFO, security SEC-03/SEC-04/SEC-06): audit IP retention note; XFH topology dependence; per-process buckets under scale-out (docs already cover).
- C2-41 (LOW/High, architect ARCH-08): prod `/api/*` responses ship no CSP (matcher excludes /api; nginx comment claims otherwise).
- C2-42 (LOW/High, architect ARCH-09): `getSeoSettings()` catch-fallback partial + wrong field (`nav.tsx:11`).
- C2-43 (LOW/High, verifier VER-01): CLAUDE.md GPS-strip wording overstates re-encode for anomalous HEIC/HEIF (fails closed instead — doc fix).
- C2-44 (LOW/High, verifier VER-02): CLAUDE.md names `containsUnicodeFormatting` as enforcement point; real call sites are `requireCleanInput`/`sanitizeAdminString` (doc fix).
- C2-45 (LOW-MED/High, tracer TRC-05): four different lock blockers all return `restoreInProgress` (misleading operator UX).
- C2-46 (LOW-MED/Med, tracer TRC-03): delete paths don't take per-image claim — wasted re-encode work (correctness-safe by design).
- C2-47 (LOW/Med, tracer TRC-07): ad hoc advisory-lock connections outside documented pool budget formulas (doc note).
- C2-48 (LOW/High, test TEST-03): `humanizeColorPrimariesOrLabel` untested.
- C2-49 (LOW-MED/Med, test TEST-04): `useRestoreFocusAfterPending` hook untested (6 admin forms).
- C2-50 (LOW/High, test TEST-05): storage singleton rollback untested (defer until quarantine lifted — module unwired).
- C2-51 (LOW-MED/Med, test TEST-06): CLIP env-gated integration tests never referenced in the production-activation runbook (doc fix).
- C2-52 (MED/High, designer UX-02): timeline/year month-heading separator — already fixed at HEAD (`c923e15d`), pending deploy; verify post-deploy.
- C2-53 (LOW/High, designer UX-04): duplicate accessible names ("Info" ×2, "Open fullscreen view" ×2).
- C2-54 (LOW/High, designer UX-05): untitled photo H1/title falls back to raw hashtag string (deliberate design; product choice).
- C2-55 (LOW/High, perf PERF-14..23): SW JSON meta blob per event; HEAD probe cooldown opportunity; 24-decode fan-out pyramid question; LIKE full-scan search; feed 304 rebuild; upload dropzone O(n²); inline CLIP backfill action gating; backfill candidate COUNT poll; LR route RAM buffering (mitigated) — recorded individually in perf-reviewer.md.

### Verified-clean highlights (do not re-derive)
- Doc/code parity: document-specialist found ZERO mismatches across every env default, nginx cap, script, and i18n key/placeholder parity check. Verifier confirmed ~60 CLAUDE.md behavioral claims byte-for-byte (3 wording-precision notes above).
- Security: no CRIT/HIGH confirmed vulnerabilities (security lane); auth/session/PAT/CSRF/traversal/SSRF/injection surfaces verified correct at the call-site level.
- Prior-cycle regression checks: lightbox color-pip `transfer_function` gating fixed; cycle-1 DBG findings all confirmed fixed; C1-07 lean-count predicate equivalence re-derived correct.
- Test suite: 311 files / 2,914 assertions, ~12 s, zero flake-prone patterns; e2e wired correctly in CI.

## AGENT FAILURES / addendum
- First fan-out attempt (12 lanes) was wiped by an API session limit before output; fully re-spawned.
- feature-dev-code-reviewer (secondary pass, message-return lane): HUNG without returning
  (no output after several hours; polled once). Per the retry rule it was replaced by a
  time-boxed general-purpose lane with complementary scope (api routes / i18n / e2e /
  migrate.js), which wrote `fd-code-reviewer.md`.

### Addendum — replacement secondary lane findings
| ID | Sev/Conf | Location | Title | Disposition |
|----|---------|----------|-------|-------------|
| C2-56 (FDR-01) | MED-HIGH/High | `apps/web/scripts/migrate.js:787-800` | prepareLegacyDatabaseIfNeeded pre-baselined pending NEW migrations, so their SQL (incl. DML) never executed on deployed DBs and the runMigrations post-condition was dead code | FIXED same cycle (`b4e986c3`): pending-vs-drift split — above-cursor missing entries are left for drizzle.migrate() to genuinely apply; mixed drift warns about swallowed tails; runbook updated; `migrate-pending-migrations.test.ts` |
- Everything else in the replacement lane's scope was verified clean (API routes, i18n request, e2e specs, backup-filename handling).
