# Run-10 Cycle 3/100 — Aggregated Review (2026-07-07)

Start HEAD: `e08b6f97` (terminal cycle-2 commit; clean tree). 12 lanes spawned:
code-reviewer, perf-reviewer (general-purpose), security-reviewer, critic, verifier,
test-engineer, tracer, architect, debugger, document-specialist, designer,
feature-dev-code-reviewer (secondary, message-return). Eleven wrote
`.context/reviews/cycle-3-2026-07-07/<agent>.md`; the secondary lane's disposition is in
AGENT FAILURES below.

Note: the first fan-out (02:2x KST) was killed by an API session limit after only
architect + document-specialist wrote output; the other 10 lanes were fully re-spawned
after the 05:00 KST reset and all completed.

## Cross-agent agreement (highest signal)

- **migrate.js mixed-case baselines pending SQL without executing it** — 4 lanes
  independently: ARCH3-03, CRIT3-03, DBG3-02 (**empirically reproduced** against the real
  exported function: a batch `[hash-2 above, hash-3 below, hash-4 above]` baselines ALL
  THREE without execution), TRC3-04; TEST3-03 flags the missing mixed-batch test. The
  post-condition passes because baseline inserted the hashes — the loud-fail net is
  structurally disarmed for this path. Highest-priority item this cycle.
- **Single-writer guard detection decays at MySQL `wait_timeout`** — ARCH3-01 + VER3-01
  (independent methods: architecture review vs doc-claim verification). CRIT3-04 adds the
  related-but-distinct namespacing + cry-wolf-on-restart issues and the missing CLAUDE.md
  lock-list entry.
- **`admin-backfill-runner.ts:691` still reads request-cached config in a detached task**
  — ARCH3-02 + VER3-03 (the exact class `02bea8d6` fixed in image-queue, one file over;
  one-line fix + missing gate).
- **404 pages now ship conflicting/generic head metadata** — TRC3-03 (static trace) +
  DES3-01 (**live-reproduced**: two `<meta name="robots">` tags, `noindex` AND
  `index, follow`, on every not-found URL, both locales).
- **SW `touchMeta` is now the sole recency authority and is fire-and-forget** — TRC3-02
  (SW-termination drop) + CRIT3-05 (meta-write failure) + PERF3-03 (size-0 LRU entries):
  three facets of the same C2-11 residual.
- **Retry-backoff comment "up to 25s" is wrong (max 10s)** — DBG3-04 + TRC3-06.
- **Cross-lane DISAGREEMENT (recorded, resolved by cheap hardening):** CR3-01 (MED/Medium)
  says the retained zero-copy `targetEmbedding` view across a later pool query in
  `similar/[id]/route.ts` can observe mysql2 buffer reuse; tracer flow-8 traced mysql2's
  `packet_parser.js` and concluded each packet gets a freshly-allocated Buffer (safe);
  PERF3-04 confirms safe-today but documents the retention constraint as a landmine for
  the deferred C2-14b cache. Disposition: one-line defensive copy of the single retained
  vector removes the dependence on undocumented driver internals entirely (C1-31 class)
  regardless of which analysis is right; scheduled as cheap hardening, not a confirmed bug.

## Merged findings ledger (deduped; highest severity/confidence preserved)

### MED-HIGH / MED
| ID | Sev/Conf | Source(s) | Location | Title |
|----|---------|-----------|----------|-------|
| C3-01 | MED-HIGH/High (reproduced) | DBG3-02+ARCH3-03+CRIT3-03+TRC3-04 (+TEST3-03) | `scripts/migrate.js:807-837` | Mixed drift+pending batch baselines above-cursor migrations WITHOUT executing their SQL; only a console.warn; post-condition blind. One misdated sibling swallows the whole batch — CLAUDE.md's "post-condition will fail the next deploy" claim no longer holds |
| C3-02 | MED/High | ARCH3-01+VER3-01 | `lib/single-writer-guard.ts:24-99` | Guard connection is query-idle for process lifetime → MySQL `wait_timeout` (8h default) reaps it, lock releases server-side, detection self-disables for the most likely scale-up-later path; CLAUDE.md "holds it for the process lifetime" claim false |
| C3-03 | LOW-MED/High | CRIT3-04 | `lib/advisory-locks.ts:56`, `single-writer-guard.ts` | `gallerykit_web_singleton` not DB-scoped (false alarm + guardless run in the documented multi-tenant scenario), cries wolf on rolling/ungraceful restarts, missing from CLAUDE.md's advisory-lock list |
| C3-04 | MED/High | ARCH3-02+VER3-03 | `lib/admin-backfill-runner.ts:691` | Detached backfill task reads request-cached `getGalleryConfig()` — the exact C2-10 class fixed in image-queue; flip-setting-then-reencode can re-encode at stale settings; no gate prevents the next sibling regression |
| C3-05 | MED/High (live-reproduced) | TRC3-03+DES3-01 | `[locale]/not-found.tsx` (no metadata), `[locale]/layout.tsx:54-57`, 4 route `generateMetadata` | Real-404 fix regressed head metadata: two conflicting robots tags (`noindex` + `index, follow`), generic site title/OG on every not-found URL; 2 routes lost their explicit noindex |
| C3-06 | MED/Medium (contested) | CR3-01 vs tracer-flow-8; PERF3-04 | `api/search/similar/[id]/route.ts:156-204`, `clip-embeddings.ts:116-148` | Retained zero-copy embedding view crosses a later pool query; lanes disagree on mysql2 buffer-lifetime safety → defensive-copy the one retained vector + correct the stale comment; C2-14b pickup MUST copy |
| C3-07 | MED/Med-High | TRC3-01 | `lib/image-queue.ts:447-517` | Embedding-bootstrap scan cursor restarts at 0 every invocation; a permanently-un-embeddable prefix ≥ `SEMANTIC_SCAN_LIMIT` starves all newer rows forever (no per-row failure marking, unlike `permanentlyFailedIds`) |
| C3-08 | MED/Med-High | CRIT3-01 | `nginx/default.conf:205-266`; cycle-2 ledger | The committed public SSR limiter is inert until a manual host-nginx reload that nothing verifies; ledger says "closes C2-06" — prod may still be unthrottled; no runbook step exists |
| C3-09 | MED-LOW/Medium | CRIT3-02 (vs SEC3-01 INFO) | `nginx/default.conf` `^~ /_next/image` | Same commit fully exempts the Sharp-re-encoding image optimizer from any request limiter on a disk-fragile host; security lane deems it bounded by `limit_conn 20` — resolution: give it its own generous zone rather than blanket exemption |
| C3-10 | MED/Medium | TRC3-02+CRIT3-05 | `public/sw.template.js:339-362` | `touchMeta` (now sole recency authority) is fire-and-forget and outside `respondWith`'s lifetime — SW termination/meta-write failure freezes recency → spurious eviction of server-confirmed-fresh entries |
| C3-11 | MED-HIGH/High | TEST3-01 | `[topic]/layout.tsx:28`, `p/[id]/layout.tsx:27`, `c/[slug]/layout.tsx:24` | Restore-maintenance skip branch in the three status-bearing 404 layouts has zero test coverage (2×2 matrix untested); a flipped guard 404s the whole public surface during restore windows |
| C3-12 | MED-HIGH contingent/High mechanism | TRC3-05 | `nginx/default.conf:1-10` + topology comment | All three `limit_req_zone` keys use `$binary_remote_addr`; the documented C1-11 LB remediation (`$proxy_add_x_forwarded_for`) does NOT fix nginx's own limiter keys — needs `set_real_ip_from`/`real_ip_header` half documented; blast radius grew from login/admin to all public traffic |
| C3-13 | MED/High mechanism | DBG3-01 | `components/photo-navigation.tsx:158-190` | Successful swipe in SHARED-group view (in-place `setCurrentImageId`, no remount) never resets ref-written indicator styles; React's static style literal won't clear them → stale glow/offset over the new photo |
| C3-14 | MED/High | TEST3-02 | `photo-navigation.tsx` (ffc4a06e) | Imperative gesture refactor shipped with zero behavioral tests (siblings in same cycle all got them) |
| C3-15 | MED/High | DOC3-01 | `CLAUDE.md:100,269`; `image-queue.ts:124-145` | `QUEUE_CONCURRENCY` silently pool-clamped to 2 at default pool (documented max 8 does nothing); no clamp warning (backfill runner warns); CLAUDE.md budget note cross-references a formula the file never states |

### LOW (grouped)
- C3-16 (LOW-MED/High, PERF3-01): every processed image pays 1-2 uncached 17-row `admin_settings` SELECTs (embedding gate + legacy snapshot path); short-TTL micro-cache or thread the mode per batch (`image-queue.ts:708,826`, `gallery-config.ts:34-40`).
- C3-17 (LOW-MED/High, PERF3-05): full i18n catalog (incl. ~21 KB admin/server-only namespaces) serialized into every dynamic page's client payload (`[locale]/layout.tsx:88,129`).
- C3-18 (LOW-MED/High, TEST3-04): `clip-inference.ts` stub generator (documented determinism/namespace invariants) has zero direct tests.
- C3-19 (LOW/High, TEST3-05): `csp-nonce.ts` + `settings-normalization.ts` never directly tested.
- C3-20 (LOW/High, ARCH3-04): image-queue per-job retry `setTimeout`s not tracked on state — invisible to drain and to the C2-33 re-init clear (`image-queue.ts:648,868`).
- C3-21 (LOW/High, DBG3-04+TRC3-06): "escalating up to 25s" comment wrong — `MAX_RETRIES=3` caps at 10s (`image-queue.ts:865`).
- C3-22 (LOW/Medium, PERF3-03): `touchMeta` records size-0 LRU entries when meta lost + no Content-Length → 50 MB cap under-counts (`sw.template.js:189`, `sw-cache.ts:219`).
- C3-23 (LOW/Medium, DBG3-03): info-sheet "unmount-while-open" focus-restore claim not implemented (no effect cleanup); doc-claim fix or cleanup effect.
- C3-24 (LOW/High, CR3-02): `OptimisticImage` retry after failed `fallbackSrc` reverts to the dead original URL (currently-unreachable branch; landmine).
- C3-25 (LOW/Medium, CRIT3-06): ossification net-growing: 143/330 source-text tests (up from 139/307); fresh string-parse fragility instance in `next-config-uploads-headers.test.ts:137` (fires the C2-31 exit criterion); `api-csp-header.test.ts` pins exact rule COUNT.
- C3-26 (LOW/Medium, CRIT3-07): ledger honesty — several cycle-2 "Closes" shipped inert/best-effort guards (af3b2f7d, e39ad990, a4a2d250); split disposition into "verified-mitigated in prod" vs "shipped guard; residual remains".
- C3-27 (LOW/Medium, CRIT3-08): carry-forward deferred register fragmented across 3+ files; age-budget policy has no computable surface.
- C3-28 (LOW/High, PERF3-06): middleware rebuilds full CSP + re-parses `IMAGE_BASE_URL` per request (microseconds; memoize opportunistically).
- C3-29 (LOW/High, PERF3-07): `serve-upload.ts` re-`realpath`s the constant root + `open()`-to-stat on HEAD/304 fast paths.
- C3-30 (LOW/High mechanism, PERF3-08): `updateTag` vs `deleteTag` opposite lock order — rare self-resolving InnoDB deadlock.
- C3-31 (LOW/High, PERF3-09): SQL-restore scan re-runs regex battery over 1 MB carry-over tail per chunk (accepted-by-design candidate; recorded).
- C3-32 (LOW/Medium, DES3-02): dev-console "script tag while rendering React component" warning on every page (JSON-LD blocks); needs prod-build validation — likely dev-only React 19 heuristic.
- C3-33 (LOW/Medium, TEST3-06): e2e focus-restore spec landed one commit before the implementation it verifies (bisectability note; no action at HEAD).
- C3-34 (LOW/High, VER3-02): cycle-2 plan's WP1 "Done" line claims 9 crafted-buffer tests; file has 4 (adequate coverage, wrong bookkeeping).
- C3-35 (LOW/Medium trend, ARCH3-05): migrate.js DDL-only reconcile invariant is real but undocumented; honest redesign (one-time journal `when` rewrite) noted, not scheduled.
- C3-36 (LOW/Medium trend, ARCH3-06): `data.ts` (1860 LOC) god-module + process-local view buffer; peel concerns opportunistically per C1-32 policy (no cycle found).
- C3-37 (INFO/High, SEC3-01): `/_next/image` limiter exclusion is intentional + `limit_conn`-backstopped (recorded; interacts with C3-09).
- C3-38 (INFO/Medium, SEC3-02): nginx admin-location regex is a hand-curated allowlist that can drift (edge-tightness only; app-layer auth independent).

### Verified-clean highlights (do not re-derive)
- Security lane: NO new CRIT/HIGH/MED vulnerability; all six cycle-2 security-relevant
  commits verified correct with no constructible bypass; timing/TOCTOU/redirect/
  cache-poisoning sweep clean.
- Verifier: full gate suite green at HEAD (3032 tests/326 files, typecheck, 3 security
  lint gates); SW hash `a6ad1051-p7` in sync; journal monotonicity allowlist exact;
  i18n 856/856 keys parity.
- 13 of 14 priority cycle-2 commits verified sound by the code lane (all except the
  migrate.js mixed-case residual); designer live-reproduced focus-restore, swipe
  gestures, MasonryCard hover/focus, and real 404s in both locales (plus first-ever
  admin-surface pass: login validation, AlertDialog focus, 44px targets all correct).
- Tracer ruled out: BIGINT cursor coercion in migrate.js; SW body/headers desync;
  mysql2 packet-buffer reuse for the zero-copy scan sites (fresh Buffer per packet).
- Perf lane: all seven cycle-2 perf commits delivered their wins with no regression;
  PERF-14 re-quantified (C2-11 made the warm path strictly cheaper); PERF-08 closed.

## AGENT FAILURES
- First fan-out attempt (12 lanes, 02:2x KST) was killed by an API session limit before
  10 of 12 lanes produced output; fully re-spawned after the 05:00 KST reset (architect +
  document-specialist survived from the first attempt).
- feature-dev-code-reviewer (secondary, message-return lane): the re-spawned instance had
  not returned by aggregate-write time (~1h elapsed; same lane hung for hours in cycle-2 and
  was replaced). Disposition recorded here; if its report arrives before cycle close, an
  addendum will be appended below. Its scope (cycle-2 commit surface) was fully covered by
  the 11 completed lanes, including two lanes with empirical/live reproduction.
