# Run-10 Cycle 5 — Debugger Lane

Start HEAD: `d9bcbf4c`. Scope: verify the cycle-4 fix commits
(`b68d09e2..d9bcbf4c`) did not introduce new bugs, plus an adversarial sweep of
the `lib/` parse/boundary/error-handling surface. Empirical reproduction where
feasible against the REAL exported functions (throwaway vitest under
`src/__tests__/`, mocking only `@/db`, removed after the run — working tree left
clean). One NEW finding reproduced deterministically.

**NEW findings: 3** (1 MED-LOW reproduced, 1 LOW, 1 LOW). All three are residuals
IN this cycle's own fixes — they are not in the cycle-4 aggregate (C4-01..C4-47)
nor the "Debugger ruled out" list, and they are against code that did not exist
when cycle-4 reviewed. Broad verified-clean list at the end.

---

## DBG5-01 — `invalidateDetachedGalleryConfigCache()` is defeated by an in-flight detached read (CONFIRMED, reproduced)

**Severity: MED-LOW. Confidence: High (mechanism, empirical repro) / Medium (real-world reachability). Label: Confirmed.**

**File:** `apps/web/src/lib/gallery-config.ts:210-253` (accessor `getGalleryConfigDetached`
+ `invalidateDetachedGalleryConfigCache`), wired at `apps/web/src/app/actions/settings.ts:233`.
Introduced this cycle by `12037508` (C4-07/PERF4-08).

The cycle-4 fix added a first-class invalidation so a settings flip drops the
detached micro-cache immediately instead of after the 2 s TTL. Commit message /
docstring claim: *"in the shipped single-process topology a flip-setting-then-act
sequence observes the new value immediately"* and *"a flip-setting-then-reencode
sequence must never re-encode at the pre-flip settings."*

The accessor resolves an in-flight DB read and then **unconditionally** writes the
cache with no generation/epoch guard:

```ts
uncachedConfigInFlight = (async () => {
    try {
        const value = await _getGalleryConfig();          // reads PRE-flip DB rows
        uncachedConfigCache = { value, expiresAt: Date.now() + DETACHED_CONFIG_TTL_MS };
        return value;
    } finally { uncachedConfigInFlight = null; }
})();
```

`invalidateDetachedGalleryConfigCache()` only nulls `uncachedConfigCache` /
`uncachedConfigInFlight`. It cannot cancel an already-running read, and that read
holds its own reference to the IIFE. So this interleaving pins stale config for
the whole TTL:

1. A background consumer (the image-queue per-image side-effect gate calls
   `getGalleryConfigDetached()` **once per processed image**, `image-queue.ts`)
   starts a detached read; its DB query snapshots the PRE-flip value.
2. While that read is still awaiting MySQL, the admin commits a settings flip and
   `updateGallerySettings` calls `invalidateDetachedGalleryConfigCache()` →
   cache/in-flight nulled.
3. The in-flight read resolves with its PRE-flip snapshot and re-populates
   `uncachedConfigCache` with the stale value + a fresh 2 s expiry.
4. Any subsequent detached read within 2 s (e.g. the admin-triggered backfill
   runner's per-run config snapshot, `admin-backfill-runner.ts`) returns the
   stale value with NO new DB read — the exact "re-encode at pre-flip settings"
   the fix claims to prevent.

The window is the DB SELECT latency (ms), and it requires a background detached
read in flight during the admin write — plausible during an active bulk upload
(queue processing) with a concurrent settings flip. Impact is bounded (≤ 2 s of
stale config on the detached path only; the request-path cached `getGalleryConfig`
is unaffected), which is why it's MED-LOW — but it makes the fix's "immediately /
never" guarantee false under a real concurrency window.

### Empirical repro (real `getGalleryConfigDetached` + `invalidateDetachedGalleryConfigCache`, `@/db` mocked)

A throwaway `src/__tests__` spec mocked only the DB layer so `.where()` snapshots
`rows` at call time (models "the read observed what was committed when it
started") and resolves behind a manual gate:

```
CONTROL: no in-flight read → invalidate → next read observes flip (avif 85 → 40)   PASS
BUG:     in-flight read started pre-flip repopulates cache post-invalidate
         → subsequent read returns STALE 85 (never 40), no new DB read            PASS
```

The CONTROL proves the invalidation works when nothing is in flight; the BUG case
proves the racing in-flight resolver re-pins the pre-flip config. `vitest run`: 2
passed. (Spec removed; re-creatable verbatim — mock `@/db.db.select().from().where()`
to snapshot-then-gate, drive the interleave above.)

**Fix direction:** guard the cache write with an invalidation epoch. Increment a
module counter in `invalidateDetachedGalleryConfigCache()`, capture it before the
read, and in the resolver write the cache only when the captured epoch still
matches (`if (epoch === currentEpoch) uncachedConfigCache = …`). A read that
started before an invalidation then still returns its value to ITS caller but does
not re-pin the shared cache. (Same class as the classic "AbortController the write
after invalidation" pattern.)

---

## DBG5-02 — photo-viewer pin-persist gate does NOT prevent the transient overwrite it documents (LIKELY, mechanism traced)

**Severity: LOW. Confidence: High (React effect-ordering mechanism). Label: Likely.**

**File:** `apps/web/src/components/photo-viewer.tsx:111-133`. Introduced this cycle by
`4afacfa8` (C4-03/DES4-01 hydration fix).

The hydration fix (render deterministic `false`, restore in a mount effect) is
correct and closes the #418 mismatch. But the paired persist effect's guard is
ineffective for the case its own comment names:

```ts
const [isPinned, setIsPinned] = useState(false);
const pinRestoredRef = useRef(false);
useEffect(() => {                       // EFFECT A (declared first) — restore
    if (pinRestoredRef.current) return;
    pinRestoredRef.current = true;      // set synchronously, BEFORE Effect B runs
    …setIsPinned(stored === 'true');    // schedules re-render; isPinned still false now
}, []);
useEffect(() => {                       // EFFECT B (declared second) — persist
    if (!pinRestoredRef.current) return;   // comment: "skip until restore ran, so a
                                           // transient false never overwrites stored true"
    sessionStorage.setItem('gallery_info_pinned', String(isPinned));
}, [isPinned]);
```

On mount, passive effects run in declaration order within the SAME commit: Effect
A sets `pinRestoredRef.current = true` and schedules `setIsPinned(true)` (state not
yet applied), then Effect B runs — the gate is already `true`, so it does **not**
skip and writes `String(isPinned)` = **`'false'`**, transiently overwriting a
stored `'true'`. React then processes the scheduled update (isPinned → true),
re-renders, and Effect B (dep `[isPinned]` changed) writes `'true'`, self-correcting.

So the gate does the opposite of its comment: it fires on the very mount pass it
was meant to skip. Net final value is correct (self-corrects one commit later), so
impact is LOW — the only real loss is a returning desktop user's `'true'` preference
if the component unmounts within that one-commit window (sub-frame; practically
unreachable for a human), plus the comment is inaccurate.

**Fix direction:** either gate on a value that is only set AFTER the restore
re-render (e.g. flip `pinRestoredRef` in a `useEffect(() => { pinRestoredRef.current
= true }, [isPinned])` that runs after the restore commits), or skip the persist
write when `isPinned` still equals the SSR default on the first restored pass, or
simply correct the comment to "self-corrects on the next render" since the net
value is safe. Lowest-risk: persist inside a handler on user toggle rather than an
`[isPinned]` effect.

---

## DBG5-03 — health-route coalescing comment overstates its protection during a sustained DB wedge (Needs-validation, doc/robustness)

**Severity: LOW. Confidence: Medium. Label: Needs-validation.**

**File:** `apps/web/src/app/api/health/route.ts:11-48`. Introduced this cycle by
`18b6cbb4` (C4-20).

The coalescing comment (line 16) claims: *"One shared promise caps that at a
single probe connection no matter how many checks stack up."* That holds only for
probes that **overlap in time**. The realistic orchestrator pattern (k8s
readiness, interval N ≫ the 2 s probe timeout) fires probes that do NOT overlap:
each probe times out at 2 s and returns 503, but — as the route's own honesty note
at lines 21-28 admits — `db.execute` is never cancelled and keeps its pool
connection until MySQL returns or the connection dies. The next probe (N seconds
later, after `inflightDbProbe` was nulled in `finally`) opens a fresh `db.execute`
= a second pinned connection. Over a multi-second wedge this accumulates ~one
pinned pool connection per probe interval — the exact "burst piles multiple of the
10 pool connections onto the wedge" the coalescing was written to prevent, just
slower.

Coalescing genuinely helps only when a load balancer fires concurrent probes
inside the same 2 s window. The absolute line-16 claim is contradicted by the
route's own lines 21-28. This is a doc-accuracy + mild-robustness note, not a
functional regression (the fix is strictly ≥ the prior behavior for concurrent
probes and equal for serial ones).

**Fix direction:** soften the line-16 comment to "caps CONCURRENT checks at one
probe connection; serial probes during a sustained wedge still accumulate because
`db.execute` is not cancellable" (aligning with lines 21-28). A real reduction
would need a connection the probe can hard-close on timeout (dedicated non-pooled
probe connection, mirroring `single-writer-guard`'s pattern) — a design change, not
a comment fix. Rated Needs-validation because it depends on the deployed probe
cadence vs. the 2 s timeout (chains the C1-11/C3-12op edge-topology deferral).

---

## Cycle-4 fixes verified CLEAN (no new bug introduced)

- **`single-writer-guard.ts` self-heal (`ce15103a`)** — traced the new
  `scheduleReacquire`/`reacquireOnce` loop for double-hold, connection leaks, and
  stop-races. No double-hold: only one `reacquireTimer`/`reacquireOnce` can be live
  at a time (scheduleReacquire guards on `reacquireTimer`; during a reacquire the
  old held conn is already nulled + keepalive cleared, so nothing calls
  scheduleReacquire mid-flight). Every await is followed by a `stopping`/`heldConnection`
  recheck; the shutdown-raced-acquire path RELEASE_LOCKs + ends the conn. Contention
  path emits loud once per lapse then closes each transient conn — no leak.
- **`migrate.js` DML-baseline guard (`b68d09e2`)** — the new `journalSqlContainsDml`
  + `LEGACY_DML_MIRRORED_BY_RECONCILE` throw closes DBG4-01/C4-01 on the
  `cursor===null` and below-cursor `trueDrift` paths; it correctly fails LOUD on
  un-mirrored DML during reconcile/baseline while leaving the normal
  brand-new-DB apply path and the pending-tail (drizzle-apply) path untouched.
  Minor (theoretical, not for drizzle output): `journalSqlContainsDml` is lexical
  and could FALSE-NEGATIVE a CTE-prefixed (`WITH … INSERT`) or `/* */`-block-comment-
  prefixed DML statement (regex anchors on the first keyword), and does not list
  `TRUNCATE`. Drizzle emits none of these shapes, and false negatives here re-open
  the swallow class only for hand-authored non-drizzle SQL — noted, not rated.
- **`sw-cache.ts` phantom eviction (`ad1fd22d`)** — `total -= entry.size` is now
  unconditional; decrementing phantom bytes only makes the walk stop SOONER, never
  leaves real over-cap bytes uncounted (phantoms occupy no real storage). Correct.
- **`sw.template.js` waitUntil de-gating (`31ff51f5`)** — `networkFirstHtml` tees
  the body via `networkResponse.clone().body` SYNCHRONOUSLY before `return`, and
  `extendLifetime` calls `event.waitUntil` while the `respondWith` promise is still
  pending (event still active) — spec-valid. Standard tee'd-stream dual-consumer
  pattern; no stream-lock hazard.
- **`gallery-config.ts` rename/alias (`12037508`)** — the `getGalleryConfigDetached`
  rename + deprecated alias + `DETACHED_CONFIG_TTL_MS` export are correct (the
  invalidation RACE above is the only residual).
- **`image-queue.ts` embedding cursor model-version reset (`d7ca37de`)** — the
  `embeddingScanModelVersion` add + reset-on-change is correct; the defensive
  re-init (`typeof !== 'string' && !== null → null`) correctly heals a pre-existing
  global-state object missing the field.
- **`image-zoom.tsx` native touchmove (`9dccebcd`)** — non-passive native
  `touchmove` on the container ref (re-attached on the stable `handleTouchMove`
  identity) is the correct fix; refs are set before the effect runs on mount.
- **`photo-viewer.tsx` shallow URL sync (`0da58d6b`)** — `history.replaceState` +
  `current === targetUrl` guard is sound; `syncPhotoQueryBasePath =
  localizePath(locale, /g/key)` matches the rendered pathname, and a guard
  false-negative only does an extra harmless shallow replaceState.
- **`health/route.ts` coalescing (`18b6cbb4`)** — the `finally`-nulled shared
  promise + unref'd timeout are leak-free (only the comment overstates protection,
  DBG5-03).
- **`settings-hash.ts` no-arg normalize (`5f0388ed`)** — `parseImageSizes(...).join(',')`
  on the DB path matches the config path's sorted CSV; FALLBACK_HASH + inflight
  dedupe intact.

## Parse/boundary surface swept CLEAN (no defect found)

- **`gps-exif-strip.ts`** — TIFF IFD walk (visited-set cycle guard, `inBounds`
  everywhere), JPEG post-EOI-trailer rejection, ExtendedXMP offset reconstruction,
  HEIF iloc extent bounds (`start+length > buf.length → null`), WebP RIFF
  odd-size padding — all bounds-checked; huge `valueCount*typeSize` fails the
  `inBounds`/`> buf.length` guards before any read.
- **`color-detection.ts` `parseCicpFromHeif`** — 64-bit box size fails `pos+size >
  limit` before any OOB read; `colr`/nclx reads are covered by `dataSize >= 11`
  against `boxEnd <= limit`. NCLX per-field code-2 merge + isHdr are as documented.
- **`icc-extractor.ts`** — `desc`/`mluc` offset+length guards
  (`strEnd > iccLen`, `strEnd > dataOffset+dataSize`, `strStart >= strEnd`) are
  sound; odd-byte UTF-16BE decodes to a replacement char, never throws.
- **`icc-chromaticity.ts`** — tag-table walk bounds (`offset+size > icc.length ||
  size > 4KB → continue`), `readS15Fixed16`/`readXyzTag`/`readChadMatrix`
  self-bound, singular chad matrix falls back cleanly.
- **`gain-map-detection.ts`** — `readBoxHeader(pos, end)` validates against the
  true container end (DBG-01), infe/iinf/iref parsers bound every id read; refCount
  and entry loops capped at 1024.
- **`csv-escape.ts` / `blur-data-url.ts` / `view-retention.ts` / `rate-limit.ts`** —
  formula-injection + Unicode-format strip order correct; blur-URL prefix/length
  cap + throttled-warn correct; `resolveRetentionMs` never puts the cutoff in the
  future (`Number()` + finite-and-positive guard); rate-limit XFF hop indexing,
  `Number()`-not-`parseInt` proxy-hop parse, and DB-backed decrement transaction
  all correct.

## Summary

- **DBG5-01** (gallery-config.ts, MED-LOW/High, **reproduced**): the new
  `invalidateDetachedGalleryConfigCache()` is defeated by an in-flight detached
  read that started before the write — it re-pins pre-flip config for the 2 s TTL,
  breaking the fix's "flip-then-act observes new value immediately" guarantee.
  Needs an invalidation-epoch guard on the resolver's cache write.
- **DBG5-02** (photo-viewer.tsx, LOW/High): the C4-03 pin-persist gate fires on the
  mount pass it was meant to skip and transiently writes `'false'` over a stored
  `'true'`; self-corrects one commit later (net-safe), comment inaccurate.
- **DBG5-03** (health/route.ts, LOW/Med): the C4-20 coalescing comment overstates
  its protection — serial orchestrator probes during a sustained MySQL wedge still
  accumulate pinned connections because `db.execute` is uncancellable (the route's
  own lines 21-28 admit this; line 16 contradicts it).
- All nine cycle-4 fix commits verified clean of NEW bugs; the entire lib/
  parse/boundary/error-handling surface swept clean.
