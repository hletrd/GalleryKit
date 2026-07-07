# Run-10 Cycle 4/100 — Critic Lane Review (2026-07-07)

**Scope:** multi-perspective critique of the whole cycle-3 change surface (commits
`285a4538..ec433dc4`, 16 implementation commits + 1 ledger-closure commit). Angle:
intent-vs-implementation, ledger honesty, process risk, second-order effects,
disagreements between stated rationale and actual code.

**Start HEAD:** `ec433dc4`. **Method:** read every cycle-3 diff + the HEAD state of the
files each WP touched; reconciled plan/ledger claims against `git` and code. Did NOT read
sibling cycle-4 lanes (architect/security/verifier) to preserve independence.

**Reconciliation note:** the review-brief range `e08b6f97..ec433dc4` and the plan's stated
terminal `24c46745` differ by one commit — `ec433dc4` is the post-deploy ledger-closure
commit that lands AFTER the plan was written. `git rev-list --count e08b6f97..24c46745` = **16**,
not the "17 implementation commits" the plan claims (LOW4-06 below). All 17 commits in the
full range are GPG-signed (`git log --format=%G?` = `G` throughout). Conventional +
gitmoji format holds.

**Headline:** the cycle's fixes are largely sound and several are genuinely good (404
robots elision verified live, DB-scoped singleton lock, fd-stat preserved on the GET body
path). But three of the cycle's own "Closes" claims carry undisclosed residuals — and in
one case (WP3+WP9) the cycle contradicts itself WITHIN the same cycle: a correctness fix
and a perf fix land on the same accessor with opposite intents and nothing reconciles them.
The irony is that cycle-3 *found* exactly this class of dishonest-closure in cycle-2
(CRIT3-07) and applied the honesty lens rigorously BACKWARD (to cycle-2's claims) while not
applying it FORWARD to its own three closures.

---

## PRIMARY SCOPE — per-WP critique

### CRIT4-01 — WP3 (C3-04) and WP9 (C3-16) are in direct same-cycle contradiction; the "uncached" contract is now false and untested
**Severity: MED · Confidence: High · Status: confirmed**

- **WP3 / C3-04** (`cc869996`) rewired `admin-backfill-runner.ts:691` from `getGalleryConfig()`
  to `getGalleryConfigUncached()`. Its own comment states the fix: the detached backfill "can
  memoize across runs there, re-encoding at STALE settings after an admin flips a color/quality
  key." The runner reads the config ONCE per run (`admin-backfill-runner.ts:691`,
  `const config = await getGalleryConfigUncached()`) and uses it as the settings snapshot for the
  **entire** re-encode pass.
- **WP9 / C3-16** (`1dff18d6`) then added a **2 s module-level TTL cache + in-flight dedupe**
  INSIDE `getGalleryConfigUncached` (`gallery-config.ts:211-233`). This is a single module-level
  cache shared by ALL callers — the image-queue per-image gate AND the admin backfill runner.
- **Net effect:** the accessor named `getGalleryConfigUncached` is no longer uncached. The
  backfill's per-run settings snapshot can now be up to `UNCACHED_CONFIG_TTL_MS` (2 s) stale —
  a **bounded reintroduction of the exact staleness C3-04 was landed to close**. A concurrent
  image-queue call populates the cache; a backfill starting <2 s later reads that cached value.
- **The doc is now internally inconsistent:** `gallery-config.ts:199-201` still says detached
  sites "MUST use this uncached accessor instead ... so every invocation re-reads current admin
  settings" — directly contradicted by the 2 s cache added 12 lines below (203-233 explains the
  skew, but 199-201 was never corrected).
- **The test guards the wiring, not the contract:** `detached-uncached-config-wiring.test.ts:51-57`
  asserts the source text imports/uses `getGalleryConfigUncached` — it does NOT assert the accessor
  is actually uncached. `gallery-config-uncached-microcache.test.ts` pins "hit within TTL / refetch
  after TTL / dedupe" but **never bounds the TTL value**. A future bump (2 s → 60 s → 5 min) would
  pass every test green while silently defeating C3-04 (backfill re-encoding at minutes-stale
  settings). The safety invariant ("far below any human flip-setting-then-act latency") is asserted
  in a comment and protected by NOTHING.
- **Failure scenario:** admin sets `avif_effort=9`, and within the same 2 s window a background
  image-queue job populates the config cache with the pre-flip read; the admin clicks "Re-encode
  existing photos"; the backfill reads the cached `avif_effort=6` and re-encodes the whole run at
  the old effort. Bounded to 2 s today (low real-world trigger given human click latency), but the
  contradiction is structural and the TTL is unbounded by any test.
- **Nothing records this.** `grep` across the plan, deferred register, and carry-forward turns up
  only WP9's line 115 describing the micro-cache as an optimization; the tension with C3-04's
  correctness contract is unrecorded anywhere.
- **Fix shape:** either (a) give the backfill a genuinely-uncached path (bypass the micro-cache for
  the once-per-run read — the perf motivation was the per-image gate storm, not the once-per-run
  backfill read), or (b) add a compile/unit assertion bounding `UNCACHED_CONFIG_TTL_MS ≤ small` and
  rename the accessor to reflect "short-TTL," and correct the `gallery-config.ts:199-201` claim.

### CRIT4-02 — migrate.js "strictly better than silent SQL loss" is FALSE for the runbook-compliant pure-DDL tail (it converts a correct green deploy into a boot failure)
**Severity: MED · Confidence: High (mechanism) / Low (real-world reachability) · Status: confirmed**

- WP1 (`285a4538`) correctly stops the mixed-batch swallow: in a mixed drift+pending state
  (`migrate.js:837-870`) only at/below-cursor drift entries are baselined; the above-cursor tail is
  left for `drizzle.migrate()` to apply. For a **DML-bearing** tail this is a real improvement
  (the original C3-01/FDR-01 concern — silent DML drop — is genuinely closed).
- **But the "strictly better" value judgment is applied uniformly** (commit body, code comment
  `migrate.js:850-856`, and `CLAUDE.md:446` all say a loud failure "is strictly preferred over
  silent SQL loss"). It is not strictly better for the **pure-DDL tail already mirrored by
  `reconcileLegacySchema`** — which the migration-authoring runbook (step 3) *requires* to be the
  state for every new migration:
  - **OLD behavior (pre-C3-01):** baseline-all records the tail hash without running its SQL. The
    tail's DDL is already present (reconcile mirrored it) → schema correct → post-condition passes
    (hash present) → **deploy green, schema correct, nothing lost.**
  - **NEW behavior:** tail left un-baselined → `drizzle.migrate()` applies the tail's bare
    `CREATE TABLE` / `ALTER TABLE ADD COLUMN` (drizzle-kit MySQL output is not `IF NOT EXISTS`) →
    the object already exists (reconcile created it) → `ER_TABLE_EXISTS_ERROR` / `ER_DUP_FIELDNAME`
    → `migrate()` throws. Migrate runs at **container startup**, so this is a **boot/deploy failure
    requiring manual operator intervention**, not merely a failed CI step. With per-iteration
    deploys and no staging (CLAUDE.md), that is a production-down condition until hand-resolved.
  - So for the mirrored-DDL-tail subset the fix is a **regression** (correct-green → hard-fail),
    the inverse of "strictly better."
- **Perverse incentive:** the "heals end-to-end" path the commit advertises is the path where
  reconcile does NOT mirror the tail (i.e. the author did NOT follow authoring step 3). Following
  the runbook makes the mixed-drift deploy hard-fail; not following it makes it heal. The doc does
  not surface this.
- **Reachability:** only in a genuinely mixed-drift state (a below-cursor hash missing AND a
  pending above-cursor tail). The normal new-migration deploy short-circuits at `migrate.js:831`
  (all-missing-above-cursor → early return, no reconcile), so routine deploys are unaffected — good,
  and worth stating plainly. A healthy production line never reaches the drift-repair branch. So
  real-world likelihood is LOW; the honesty framing + boot-failure mode are the finding.
- **Untested downstream:** `migrate-pending-migrations.test.ts` uses a mock connection and asserts
  only which hashes get baselined. The "fails loud vs heals end-to-end" downstream claim — the whole
  justification for the trade — is **not exercised by any test**. The "strictly better" assertion is
  a design opinion validated by nothing.

### CRIT4-03 — single-writer keepalive does NOT close C3-02: a transient ping failure permanently disarms the guard with no reconnect, and a later second instance acquires the freed lock silently
**Severity: MED · Confidence: High · Status: confirmed**

- WP2 (`3f8b6c88`) added a 60 s `SELECT 1` keepalive so `wait_timeout` (8 h) no longer reaps the
  lock-holding connection. Good for the steady-state idle case.
- **But the keepalive-failure handler permanently disarms** (`single-writer-guard.ts:114-124`): on
  ANY `SELECT 1` rejection — a 1-second network blip, a MySQL failover/restart, a connection reset,
  a brief pool-independent DB hiccup — it `warnLapse()`s once, nulls `heldConnection`,
  `clearKeepalive()`s, and `conn.end()`s. There is **no reconnect and no re-probe**. `reprobeOnce`
  (`:147-170`) is only ever scheduled from the STARTUP contention path (`:193`), never from a
  keepalive failure. `lapseWarned` is never reset except by a successful `holdConnection`, which
  can no longer happen.
- **Consequence = the exact failure the guard exists to catch:** incumbent process A's transient
  ping failure at hour 3 releases the advisory lock server-side (connection ended). A now runs
  **without holding the lock, silently**. If process B boots later (the documented scale-up-later
  path), B's `tryAcquire` **succeeds** (lock is free) → B holds it, believes it is the sole writer,
  and emits **ZERO warning** because it acquired cleanly. Two live instances, guard silent — the
  restore-fence / upload-quota / rate-limit coordination breakage the guard is meant to flag.
- **Arguably worse than the bug it fixes.** The `wait_timeout` lapse it replaced was a *predictable*
  8 h boundary; the new lapse triggers on *any* transient failure at *any* time and is *permanent*
  for the process lifetime. The keepalive reduces lapse *frequency* but does not change lapse
  *permanence* or the silent-second-instance consequence.
- **Correct shape:** on keepalive failure, re-probe/re-acquire on a fresh connection (exactly what
  `reprobeOnce` already does for startup contention). If re-acquire succeeds → A is still the
  incumbent, no harm, re-arm. If it FAILS → someone else took the lock → emit the loud topology
  error (A just detected the second instance!). The current "warn once and give up" is the worst of
  both: A ends up lockless AND silent.
- **Ledger honesty:** the commit and CLAUDE.md say WP2 "makes detection durable" / plan says C3-02
  is done. It reduces one lapse trigger and leaves the class intact. This is the same
  frequency-reduction-sold-as-elimination pattern cycle-3 itself flagged as CRIT3-07 in cycle-2.
  The `single-writer-guard.ts:23-29` header even documents the keepalive as the C3-02 fix without
  noting the residual transient-failure disarm.

### MED4-04 — WP7 embedding-cursor fix treats the starvation symptom, not the root (no per-row embedding failure marking); in-process cursor resets every per-iteration deploy
**Severity: LOW-MED · Confidence: Med-High · Status: confirmed**

- WP7 (`200a74bf`) persists `embeddingScanCursorId` on queue state so a stuck un-embeddable prefix
  ≥ `SEMANTIC_SCAN_LIMIT` no longer starves newer rows (`image-queue.ts:521-585`). The starvation
  symptom is correctly resolved and the wraparound-retry design is reasonable.
- **Root not addressed:** C3-07's stated root was "no per-row failure marking, unlike
  `permanentlyFailedIds`" (aggregate). The fix adds a cursor, NOT failure marking. Consequences the
  commit only partly discloses:
  - Every clean pass resets the cursor to 0, so one subsequent invocation re-burns the entire scan
    budget re-attempting the permanently-stuck prefix (commit acknowledges "wrap-around retries the
    failed prefix" — intentional, acceptable).
  - **Undisclosed:** the cursor lives on the in-process queue state (`ProcessingQueueState`), NOT in
    the DB. Per-iteration deploys (hours apart but frequent by explicit project policy) restart the
    process and reset the cursor to 0 on every deploy. A freshly-deployed process re-attempts the
    stuck prefix from scratch before it can advance to newer rows. Within one multi-hour process
    lifetime there are enough 30 s invocations to get past it, so it self-heals — but the
    deploy-reset behavior is nowhere documented and no deferred-register row tracks the un-addressed
    root (failure marking).
- Disposition: a fair engineering trade with an honest primary-symptom fix, but the root deferral is
  implicit and unrecorded. Recommend a deferred-register entry with an exit criterion (embedding
  per-row failure table when a real un-embeddable backlog is observed in prod).

### INFO4-05 — serve-upload fd-free HEAD/304 does NOT reintroduce the fd-stat TOCTOU (task hypothesis disconfirmed); verified-clean
**Severity: INFO · Confidence: High · Status: confirmed — do not re-derive**

- The brief asked whether fd-free stat on HEAD/304 reintroduces the race fd-stat was chosen to
  avoid. It does not. HEAD and 304 stream **no body**, so there is nothing for the headers to be
  inconsistent WITH — the fd-stat race-safety was only ever about the streamed body describing the
  same inode as its headers. The **GET body path still opens the fd first and stats through it**
  (`serve-upload.ts:296-302`, `bodyEtag` from `bodyStats`), so the load-bearing invariant is intact.
- The `d07c6d32` test re-pin is **honest**: it renamed the pinned assertion `stats` → `bodyStats`
  and still requires `open(resolvedPath,'r')` + `fileHandle.stat()` + `createReadStream({autoClose})`
  from the same handle + `not.toContain('createReadStream(absolutePath)')`. It does not mask
  anything; the GET-path race contract is preserved verbatim.
- **Caveat feeding secondary scope:** the re-pin is itself another exact-source-string test
  (`toContain('const bodyStats = await fileHandle.stat();')`) — a fresh instance of the ossification
  pattern C3-25/C2-31 track (see INFO4-09).

---

## LEDGER / PROCESS HONESTY

### LOW4-06 — terminal-evidence commit count is wrong (claims 17, is 16)
**Severity: LOW · Confidence: High · Status: confirmed**
Plan line 212: "17 implementation commits `e08b6f97..24c46745`." `git rev-list --count
e08b6f97..24c46745` = **16**. The 17th commit (`ec433dc4`, the ledger closure) is OUTSIDE the stated
`..24c46745` range. Same off-by-one bookkeeping class as the VER3-02 correction cycle-3 itself made
to cycle-2's plan ("9 crafted-buffer tests" → 4). Cosmetic, but it is a factual terminal-evidence
claim and the cycle's own review lane treats such miscounts as findings.

### INFO4-07 — backward-only application of the CRIT3-07 honesty lens
**Severity: INFO · Confidence: High · Status: confirmed**
Credit: the plan's "Ledger honesty dispositions" (lines 191-198) reclassify cycle-2's C2-06 /
C2-03 / C2-37 as "shipped config; prod-apply pending" / "detects-not-prevents" / "symptom-degrade,
root open" — precisely the honest disposition cycle-3's CRIT3-07 demanded. But the same discipline
was NOT turned on cycle-3's own three headline closures: C3-02 "Closes" (residual = CRIT4-03), C3-04
"Closes" (residual = CRIT4-01), C3-01 "Closes" (residual = CRIT4-02). The honesty audit was applied
to the prior cycle's claims and skipped for the current cycle's — the exact blind spot that
generates the next cycle's CRIT-07.

### INFO4-08 — nginx inert-config accumulation nobody owns end-to-end (second-order)
**Severity: MED · Confidence: Med · Status: confirmed**
WP10 (`1baeb3fe`) adds `zone=nextimage`; the config is honestly labeled INERT until an operator runs
the new apply+verify runbook (C3-08op, age 0). But this is now a **standing, growing gap**: cycle-2's
`zone=public` is ALSO still pending the same operator step, and every nginx-touching cycle adds more
inert config. The committed `nginx/default.conf` is drifting further from the (unknown) live host
config, and nothing in the repo — no deploy step, no smoke, no probe — can verify convergence.
Practical consequence: ALL per-IP rate-limit protections (login 5/15m, admin 30/m, public 10/s,
nextimage 30/s) may be inactive in production right now and the repo cannot tell. The labeling is
honest; the underlying availability/abuse exposure is real, cross-cycle, and unowned. The
destructive-action gate on reloading host nginx is legitimate, but a read-only verify probe
(`curl` a >burst rapid-GET and assert 429) is NOT destructive and could at least be surfaced as a
post-deploy check the repo runs, rather than a runbook step that "nothing verifies."

### INFO4-09 — test ossification trend did not reverse this cycle
**Severity: LOW · Confidence: Med (trend) · Status: confirmed**
WP12 relaxed exactly ONE count-pin (`api-csp-header` rule-count → presence/shape) and added a
structural nginx block parser — genuine, but local. The cycle NET-ADDED ~59 tests / 9 files
(plan: 3032 → 3091), a meaningful fraction of them source-text-coupled: migrate source-contract
assertions (`toContain('Refusing to baseline')`, `toContain('NOT being baselined')`,
`toContain('drizzle will apply their SQL')`), the serve-upload re-pin
(`toContain('const bodyStats = await fileHandle.stat();')`), and `detached-uncached-config-wiring`
regexing the source for import shapes. C3-25's exit criterion (ossification net-growing) is still
firing; the direction of travel remains toward more source-coupled tests, not fewer. The one
relaxation does not offset the batch of new source-pins.

### INFO4-10 — CLAUDE.md operational-document growth
**Severity: INFO · Confidence: Low · Status: needs-validation (subjective)**
CLAUDE.md is now **723 lines** of dense, finding-ID-cross-referenced prose (the migrate runbook
entry is a single ~15-line paragraph threading FDR-01 / C3-01 / authoring-step-3 / DDL-only
invariant). I spot-verified the migrate and `QUEUE_CONCURRENCY` entries against code — both accurate.
So accuracy is holding; navigability is the concern. An operator hitting a stuck deploy at 3am must
parse a wall of `Rn Cm` codes to extract the actual procedure. Not actionable this cycle; flagged as
a trend — the document is accreting review-lineage narrative that belongs in `.context/reviews/`, not
in the operational runbook.

### INFO4-11 — AGENT FAILURES disposition: compliant, with one soft edge
**Severity: INFO · Confidence: High · Status: confirmed-compliant**
The feature-dev-code-reviewer hang was handled per the fan-out retry protocol: re-spawned after the
session-limit kill, hung >2 h again, recorded as failed, scope asserted covered by the 11 completed
lanes. Compliant. Two soft edges: (a) "scope fully covered" is inherently unverifiable — the lane
produced no output to compare, so the claim is a reasonable inference, not evidence; (b) the
concrete corrective ("budget a general-purpose replacement from the start") was noted as guidance
for "future cycles" rather than adopted as a standing rule, so the same lane can hang again next
cycle before the mitigation applies.

### INFO4-12 — carry-forward age budget has no teeth for the MED-severity long tail
**Severity: INFO · Confidence: High · Status: confirmed (policy observation)**
The register's age budget only force-schedules **High-severity** findings crossing 8 cycles. Five
`MED/High` (severity MED, confidence High) rows sit at ~8+ cycles — C94-04/C93-05, C94-05/C93-06,
C94-06/C93-09, C94-07/C93-10, C94-08/C93-11 — and can carry forward indefinitely because the budget
targets severity=High only. I spot-checked them (admin Playwright coverage, mobile-admin redesign,
keyboard-pannable zoom) and they are legitimately MED (test-infra / product decisions), so this is
not severity-gaming. But the "8-cycle budget" mechanically applies to the *one* place it almost never
bites (High severity, nearly all already drained) and never to the *long tail where aged items
actually accumulate* (MED). The hygiene this cycle is otherwise good: C3 rows added at age 0, ages
internally consistent, the consolidated register (`deferred-carry-forward.md`) is a real improvement.
The observation is that the budget's teeth and the aging population don't overlap.

---

## Cross-cutting synthesis

The through-line across CRIT4-01/02/03 is identical: **each closes the reported symptom and leaves a
narrower residual of the same failure class, then labels the result "Closes."**
- C3-04: closes unbounded staleness, leaves bounded (2 s, untested-bound) staleness — and WP9 in the
  same cycle is what reintroduces it.
- C3-01: closes silent DML-drop, opens hard-fail-at-boot for the mirrored-DDL tail.
- C3-02: closes the 8 h wait_timeout lapse, leaves the any-time transient-failure permanent lapse.

None of these residuals is disclosed in the cycle-3 ledger, even though cycle-3's OWN marquee finding
(CRIT3-07) was "cycle-2 shipped inert/best-effort guards under 'Closes'." The correct cycle-4
disposition for the three is **not** "reopen as bugs" (the primary fixes are real and the residuals
are narrow) but **"shipped fix; residual X remains"** with a deferred-register row + exit criterion
each — the same split-disposition language cycle-3 correctly authored for cycle-2's claims. Priority
order for pickup: CRIT4-01 (self-contradiction within one cycle + latent-drift trap, cheapest to
fix) > CRIT4-03 (guard reliability, clear fix = re-probe on keepalive failure) > CRIT4-02
(doc/framing correction + one integration test; mechanism real but low reachability).

No CRIT/HIGH correctness or security bug found in the shipped code — the fixes work for their primary
cases. The findings are honesty/residual/second-order class, which is this lane's remit.
