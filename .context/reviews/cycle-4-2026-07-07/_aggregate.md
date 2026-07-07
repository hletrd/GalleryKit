# Run-10 Cycle 4/100 — Aggregated Review (2026-07-07)

Start HEAD: `ec433dc4` (terminal cycle-3 commit; clean tree; == origin/master; deployed &
verified healthy). 12 lanes spawned in one batch: code-reviewer, perf-reviewer
(general-purpose), security-reviewer, critic, verifier, test-engineer, tracer, architect,
debugger, document-specialist, designer, feature-dev-code-reviewer. Eleven wrote
`.context/reviews/cycle-4-2026-07-07/<agent>.md`; the twelfth is in AGENT FAILURES.

## Cross-agent agreement (highest signal)

- **migrate.js `cursor === null` branch still swallows pending DML** — DBG4-01
  (MED-HIGH/High, **empirically reproduced** against the real exported functions: an
  empty-but-existing `__drizzle_migrations` table baselines a brand-new DML-bearing
  migration without executing it, silently bypassing the C3-01 belt-and-braces guard whose
  condition `maxFolderMillis !== null` is false exactly there). Corroborated from three
  independent angles: TRC4-10 (the below-cursor trueDrift path has the same no-DML-guard
  gap, and shipped migration `0001` itself carries a DML backfill), DOC4-01 (the brand-new
  CLAUDE.md "DDL-only invariant" is falsified by `reconcileLegacySchema`'s own
  `shared_group_images.position` UPDATE — which is also the thing that makes 0001's
  baseline currently safe), CRIT4-02 + TEST4-07 (the loud-fail trade is untested and its
  "strictly better" framing is wrong for the runbook-compliant pure-DDL tail). Highest
  priority this cycle.
- **single-writer guard permanently disarms on any keepalive/connection lapse** —
  CRIT4-03 (MED/High) + ARCH4-01 (LOW-MED/High) independently: one transient `SELECT 1`
  failure ends the connection, releases the lock server-side, and the guard never
  re-acquires — a later second instance acquires cleanly with ZERO warning (the exact
  failure the guard exists to catch). TRC4-02 adds: the one-shot startup reprobe also gives
  up permanently on a mere connect failure, with an "at startup"-worded log that misleads
  when fired 25 s in. TRC4-03: keepalive-vs-shutdown race can double-log an alarming lapse
  during clean SIGTERM. TEST4-06: `.unref()` + stop-during-reprobe-window untested.
  CR4-04: reprobe-vs-stop leak is benign only because instrumentation `process.exit()`s.
- **`getGalleryConfigUncached` micro-cache contradiction cluster** — CRIT4-01 (MED/High:
  WP3 and WP9 landed opposite intents on the same accessor in the same cycle; the TTL is
  bounded by NO test; the C3-04 staleness is reintroduced bounded-at-2s), ARCH4-02 (the
  name now lies; rename), DOC4-02 (docstring self-contradicts 12 lines apart), PERF4-08
  (cache never invalidated on settings writes — one-line fix at the settings action),
  TEST4-02 (the "does not cache a failed read" test masks that fallback IS cached for the
  TTL; manual reset hides it). Five lanes, one root: the accessor's freshness contract.
- **SW LRU phantom-entry over-eviction** — DBG4-02 (MED-HIGH/High, **empirically
  reproduced** against the real `sw-cache.ts`): when `cache.delete()` returns false
  (browser already quota-evicted the entry), the walk removes the meta row but never
  decrements `total`, so phantom bytes force eviction of REAL fresh entries — a fresh
  write can be evicted by its own recording call. Pre-existing, surfaced by the
  0ae67c25-adjacent adversarial sweep.
- **Hydration mismatch on every desktop photo-page load** — DES4-01 (MED-HIGH/High,
  **live-reproduced in dev AND a production build**, minified React #418): `photo-viewer.tsx`
  `isPinned` reads `sessionStorage`/`matchMedia` inside the `useState` lazy initializer;
  server always renders `false`, desktop client hydrates `true` → React discards and
  regenerates the viewer subtree on every affected navigation.
- **Shared-group in-place stepping burns a full SSR + share-limiter slot per step** —
  PERF4-01 (HIGH/Med-High): `router.replace(?photoId=)` per swipe/arrow/slideshow-tick is
  a real RSC navigation through the `/g/[key]` page, draining `SHARE_MAX_REQUESTS=60/min`;
  over budget the open viewer is replaced by a 404 mid-browse. Cycle-3's own e2e workaround
  commit (`24c46745`) is documentary evidence of the pressure; the designer lane
  independently hit the same limiter trying to reproduce swipe fixes live (designer env
  note), and TEST4-04 traces the same shared-budget fragility for future e2e specs.
- **serve-upload fd-close test is now a false positive** — TEST4-01 (HIGH/Confirmed,
  empirically instrumented): post-PERF3-07 the 304/HEAD branches never open an fd, so the
  `closeSpies.at(-1)` assertions test a stale spy from the earlier GET; the fd-lifecycle
  contract on a documented security-relevant path has silently lost its regression net.
- **embedding-scan cursor is process-memory-only and effectively once-per-process** —
  DBG4-03 (MED/High) + TRC4-05 (High): every per-commit deploy resets the C3-07 cursor to
  0, and the bootstrap scan only re-runs on claim-exhaustion/permanent-failure/restore —
  the fix's cross-invocation protection rarely engages under this repo's real deploy
  cadence. PERF4-12: cursor also survives semantic-mode flips (should reset on model-version
  change). CRIT4 MED4-04: the root (per-row failure marking) is un-addressed and was never
  recorded as a deferral.
- **Cycle-3 verifications (positive agreement):** verifier + code-reviewer + perf +
  security + tracer + designer independently confirm all cycle-3 headline fixes work for
  their primary cases: 404 robots (live, dev+prod), swipe reset (isolated e2e), SW hash
  sync `26516421-p7` (recomputed twice), fd-free HEAD/304 (branch-traced + POSIX rename
  experiment), mixed-batch baseline (verified against the REAL drizzle-orm migrator
  source), defensive embedding copy, nginx nextimage zone. DES3-02's exit criterion is
  CLOSED: the JSON-LD console warning is dev-only (prod build has zero console output).

## Merged findings ledger (deduped; highest severity/confidence preserved)

### MED-HIGH / MED
| ID | Sev/Conf | Source(s) | Location | Title |
|----|---------|-----------|----------|-------|
| C4-01 | MED-HIGH/High (reproduced) | DBG4-01+TRC4-10+DOC4-01+CRIT4-02+TEST4-07 | `scripts/migrate.js:747-871` | `cursor === null` (empty-but-existing migrations table) baselines pending DML-bearing migrations without executing them — C3-01's guard is skipped exactly there; trueDrift path has the same no-DML-guard gap; the new "DDL-only invariant" doc is falsified by reconcile's own position-backfill UPDATE |
| C4-02 | MED-HIGH/High (reproduced) | DBG4-02 | `lib/sw-cache.ts:135-150` + `public/sw.template.js` mirror | Phantom meta entries (browser quota-evicted) never decrement the eviction-walk `total` → fresh cache writes evicted by their own recording call; PWA cache can become unable to retain anything |
| C4-03 | MED-HIGH/High (reproduced, prod build) | DES4-01 | `components/photo-viewer.tsx:103-114` | Hydration mismatch on every desktop photo-page load: `isPinned` seeds from `sessionStorage`/`matchMedia` in the `useState` lazy initializer vs server-forced `false`; React #418 in production + subtree regeneration per navigation |
| C4-04 | HIGH/Med-High | PERF4-01 (+TEST4-04, designer env note, 24c46745 as evidence) | `components/photo-viewer.tsx:307-310`, `g/[key]/page.tsx:105-107` | Shared-group in-place stepping fires a full SSR + share-limiter slot per step (swipe/arrow/slideshow); legitimate browsing can exhaust 60/min and 404 the open viewer |
| C4-05 | HIGH/High (reproduced) | TEST4-01 | `__tests__/serve-upload.test.ts:114-149` | fd-close assertions for 304/HEAD test a stale spy post-PERF3-07 — false-positive regression net on the documented fd/TOCTOU-safety path |
| C4-06 | MED/High | CRIT4-03+ARCH4-01+TRC4-02+TRC4-03+TEST4-06+CR4-04 | `lib/single-writer-guard.ts:100-170` | Guard permanently disarms on any keepalive/connection lapse and never re-acquires; a later second instance acquires silently; startup reprobe also one-shot on connect failure; shutdown race can double-log; `.unref()`/stop-window untested |
| C4-07 | MED/High | CRIT4-01+ARCH4-02+DOC4-02+PERF4-08+TEST4-02 | `lib/gallery-config.ts:196-236`, `actions/settings.ts:225` | `getGalleryConfigUncached` contradiction cluster: 2 s TTL cache reintroduces bounded C3-04 staleness, never invalidated on settings writes, TTL unbounded by tests, docstring self-contradicts, fallback-caching test masks its own subject, name is a drift trap |
| C4-08 | MED/High | PERF4-02 | `public/sw.template.js:410-432` | `networkFirstHtml` awaits full-body `cache.put` + eviction walk before resolving `respondWith` — HTML first-paint gated on full download+storage write for every SW-controlled public navigation (defeats streaming) |
| C4-09 | MED/High + LOW-MED/High | DBG4-03+TRC4-05+PERF4-12+MED4-04 | `lib/image-queue.ts:353,436,532-588,1084-1194` | Embedding-scan cursor: process-memory-only (reset by every per-commit deploy), scan effectively once-per-process under normal ops, cursor survives model-version flips (should reset), root per-row failure marking never recorded as deferred |
| C4-10 | MED/Med | PERF4-04 | `actions/images.ts:198→~651`, `api/admin/lr/upload/route.ts:272→608` | Exclusive upload-contract lock serializes ALL uploads deployment-wide across the save/GPS-strip/insert window; concurrent second uploader stalls 5 s then gets a misleading settings-locked error |
| C4-11 | MED/Med | PERF4-05 | `api/admin/lr/upload/route.ts:60-74,180-186` | LR multipart slot released right after `formData()`; k staggered uploads retain k × ~216 MiB blobs through processing (RSS/OOM risk on small hosts) |
| C4-12 | MED/Med | PERF4-09 | `components/image-zoom.tsx:262-303,354,360` | `e.preventDefault()` in React `onTouchMove` is a no-op (passive root listener): pinch-from-unzoomed fights browser page zoom + per-frame console intervention warnings; wheel path already has the correct native `{passive:false}` pattern |
| C4-13 | MED/Med | CRIT4 INFO4-08 (interacts C3-08op/C2-06) | `nginx/default.conf`; ledger | Inert nginx config accumulation nobody owns end-to-end: `zone=public` AND `zone=nextimage` both pending the same operator apply; ALL per-IP limits may be inactive in prod and the repo cannot tell; a read-only 429 verify probe would be non-destructive |
| C4-14 | MED-HIGH mechanism/Med reachability | TRC4-10 (split from C4-01 for tracking) | `drizzle/0001_sync_current_schema.sql:58-66`, `migrate.js:857-870` | Below-cursor trueDrift baselining has no DML guard; 0001 itself carries the position backfill DML (currently mirrored by reconcile's one exception — the invariant is load-bearing and undocumented) |

### LOW (grouped)
- C4-15 (LOW-MED/High, DBG4-04): photo-navigation touchEnd animated settle is overwritten
  before paint by the C3-13 layout effect in exactly the in-place-switch case both target —
  cosmetic (final state correct); `animate:true` is dead in that path (`photo-navigation.tsx:112-115,193,198`).
- C4-16 (LOW-MED/High, ARCH4-03): image-queue `ProcessingQueueState` is a 17-field
  god-object with an un-enforced O(4)-site reset obligation; three fields already needed
  retroactive defensive backfills.
- C4-17 (LOW-MED/High, ARCH4-04): the four retention sweeps (sessions, buckets, audit-log,
  view-events) are parasitic on the image-queue's `gcInterval`, armed only after queue
  bootstrap succeeds — a stuck bootstrap silently disables ALL retention.
- C4-18 (LOW-MED/High, TEST4-03): ossification ratio flat (145/335 = 43.3%) but absolute
  source-text-test count still grew (+2 files); root cause = no component-behavior harness
  (jsdom/RTL) — the named lever for reversing the trend.
- C4-19 (LOW/High, CR4-02): settings-hash no-arg fallback path hashes raw `image_sizes`
  (unsorted) vs config path (sorted) — transient extra 304→200 churn during DB-outage cold
  start (`lib/settings-hash.ts:73,92`).
- C4-20 (LOW/High, PERF4-06): health-route DB probe not cancelled on timeout — stacked
  `SELECT 1`s toward the pool queue during a wedged-MySQL incident (`api/health/route.ts:40-46`).
- C4-21 (LOW/High, ARCH4-05): serve-upload ETag template inlined twice (304/HEAD vs GET) —
  format-drift risk; 2 stat sources for one resource (`lib/serve-upload.ts:254,302`).
- C4-22 (LOW/Med-High, PERF4-07): per-photo OG card buffers its own local derivative via a
  public-HTTPS self-fetch (hairpin coupling) where a capped `fs.readFile` would do; route
  comment's rationale is inaccurate (`lib/og-photo-fetch.ts:72-87`).
- C4-23 (LOW/Med-High, PERF4-10): info-sidebar toggle re-runs the neighbor-preload effect
  → re-fetches both neighbor derivatives at a new `imagesizes` per toggle (`photo-viewer.tsx:256-305`).
- C4-24 (LOW/Med-High, PERF4-11): upload previews decode full-res originals + grid
  re-renders ~3× per file (admin-only; masked by sequential upload).
- C4-25 (LOW/Med, TRC4-07): SW never caches opaque/CDN-origin image responses — for
  `IMAGE_BASE_URL` deployments the 50 MB LRU/offline story silently doesn't apply; nothing
  documents it (`sw.template.js:51-53,304`).
- C4-26 (LOW/Low-Med, TRC4-08): SW eviction recency READ (`evictExpiredCachedImage` →
  `getMeta`) is outside the `withMetaMutation` queue — narrow spurious-eviction race at the
  1 h staleness boundary; self-healing.
- C4-27 (LOW/High, TRC4-06): in-app embedding scan and the sidecar CLIP backfill are not
  mutually exclusive (no shared advisory lock) — duplicate inference work, converges via
  `onDuplicateKeyUpdate`; operators aren't told.
- C4-28 (LOW/Med, TRC4-13): view-count SIGTERM flush resolves "success" even when every
  write failed DB-down; exit code masks the condition (accepted-by-design data loss, signal
  gap only).
- C4-29 (LOW/High, TEST4-05): photo-navigation in-place reset only e2e-tested via swipe;
  chevron/keyboard trigger untested (one-line e2e addition).
- C4-30 (LOW/High, TEST4-04): merged single-session swipe e2e trades diagnostic granularity;
  share-limiter has no e2e-reachable reset — the flake class remains for any future /g/ /s/ spec.
- C4-31 (LOW/High, VER4-01+LOW4-06): cycle-3 plan claims "17 implementation commits
  `e08b6f97..24c46745`"; the range contains 16 (the 17th is the out-of-range ledger commit).
- C4-32 (LOW-MED/High, VER4-02): cycle-3 WP15 checkbox marks C3-28+C3-29 `[x]` as a unit but
  C3-28 was NOT implemented (correctly deferred in the register); plan/register disagree.
- C4-33 (INFO/Low, VER4-03): carry-forward ages for C80-06 vs C94-10/C88-03 identical (~10)
  despite an 8-cycle first-deferred gap — arithmetic slip.
- C4-34 (INFO/—, VER4-04): `C1-25(a)` label `HIGH-attached-to-doc (fixed)/product` is easy to
  misread against the "no open High row" claim; reword.
- C4-35 (MED-HIGH/High, DOC4-01): CLAUDE.md's new "reconcile mirrors DDL only, NEVER DML"
  invariant is contradicted by reconcile's own position backfill — folds into C4-01's fix.
- C4-36 (MED/High, DOC4-04): CLAUDE.md SW section documents none of the touchMeta
  recency-authority/lifetime/size-0 invariants that regressed once and were fixed twice.
- C4-37 (LOW-MED/High, DOC4-05): plans README still lists cycle-3 under "Active".
- C4-38 (LOW/Med-High, DOC4-06): `RESTORE_MAINTENANCE_DIR` undocumented in the env table
  (production-reachable knob); `UPLOAD_ROOT` asymmetry noted.
- C4-39 (LOW/High, DOC4-03): CLAUDE.md quotes `trueDriftEntries`; the variable is `trueDrift`.
- C4-40 (INFO/Med, DOC4-07): apps/web README "2000+ tests" ~35% stale.
- C4-41 (LOW/High, TRC4-01 residual): CLAUDE.md ETag section says backfill "rewrites bytes
  in place" — encoder actually writes tmp + atomic rename, and the fd-stat safety argument
  DEPENDS on rename-over semantics; also `migrate.js:742-744` claims a drizzle-side
  per-entry hash check that does not exist (verified against installed drizzle-orm).
- C4-42 (INFO/High, CR4-01+PERF4-03 → scheduled with C4-08): awaited `touchMeta` serializes
  confirmed-fresh tile responses behind the global meta mutex (O(N·M) per warm paint);
  durability and non-blocking are simultaneously achievable via `event.waitUntil`.
- C4-43 (INFO/High, CR4-03): migrate.js mixed-drift now fails loud (ER_TABLE_EXISTS) where
  it previously booted silently-lossy — correct, operator-visible behavior change (ledger note).
- C4-44 (INFO/High, INFO4-07): the CRIT3-07 honesty lens was applied backward (to cycle-2)
  but not forward to cycle-3's own three closures — C4-01/06/07 are exactly those residuals.
- C4-45 (INFO/High, INFO4-12): the 8-cycle age budget only bites severity-High rows; five
  MED/High rows sit at ~8+ cycles untouched by it (policy-teeth observation, not gaming).
- C4-46 (INFO/Low, INFO4-10): CLAUDE.md at 723 lines is accreting review-lineage narrative;
  accuracy holding, navigability declining (trend only).
- C4-47 (INFO/Med, TEST4-07): the loud-failure trade's propagation path (duplicate-DDL →
  `main()` exit 1) is structurally sound by read but unexercised by any test.

### Verified-clean highlights (do not re-derive)
- Security: NO new CRIT/HIGH/MED vulnerability; serve-upload containment/symlink/ETag-injection
  clean; advisory-lock name construction injection-free and under 64 chars; migrate.js has no
  crafted-state privilege bypass; all three security lint gates verified faithful to CLAUDE.md.
- Verifier: all six fast gates green at HEAD (3091/4 skipped, 335 files — exact match to
  cycle-3's claim); SW hash `26516421-p7` in sync (recomputed independently); i18n 856/856.
- Tracer ruled out: serve-upload rename-race/0-byte/fd-leak (POSIX rename experiment);
  migrate.js pending-tail swallow under any journal-order permutation (verified against real
  drizzle-orm source); embeddings.ts stale-config sibling; photo-navigation double-swipe/
  orientation stale visuals.
- Debugger ruled out: gallery-config micro-cache reentrancy; GC-timer double-arm; retry-delay
  comments (both sites numerically correct); http-etag RFC 9110 parsing; optimistic-image
  retry state machine; restore-maintenance re-entrant marker.
- Designer: DES4-P1 (404 robots) VERIFIED FIXED dev+prod; DES4-P2 (swipe reset) VERIFIED
  FIXED (isolated e2e); DES4-P3 (DES3-02 exit criterion) CLOSED — JSON-LD warning is dev-only.
  Keyboard nav, reduced-motion gating (live-verified via matchMedia injection), dark/light
  theme, mobile bottom sheet, search empty/populated states, en↔ko switch: all clean.
- Perf: all five cycle-3 perf commits delivered their wins (fd-free branches proven
  fd-less branch-by-branch; micro-cache dedupe race-free; cursor can't skip/loop; copy cost
  negligible; retry-timer tracking leak-free).

## AGENT FAILURES
- **feature-dev-code-reviewer**: hung again (no output >1 h past the point all 11 sibling
  lanes completed), exactly as in cycles 2-3. Per the cycle-3 disposition ("treat this lane
  as unreliable; budget a general-purpose replacement from the start") and the
  orchestrator's stall-break directive, NO additional retry was spent this cycle; the lane
  could not be force-stopped from this session (owned by the main session) and is recorded
  as failed. Scope coverage: its assignment (cycle-3 commit surface, high-confidence bugs)
  was fully covered by code-reviewer + debugger + tracer + critic, including two lanes with
  empirical reproduction. STANDING RULE adopted (closes CRIT4 INFO4-11's soft edge): from
  cycle 5 onward, spawn a general-purpose high-confidence-bug lane INSTEAD OF
  feature-dev:code-reviewer; do not spawn the unreliable lane at all.
