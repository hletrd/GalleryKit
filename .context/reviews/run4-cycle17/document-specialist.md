# Document-specialist — Run-4 Cycle 17

Single-subagent in-context pass (documented run-wide constraint).
Doc/code mismatch sweep over the rotation surfaces + the cycle-16
commit bodies.

## Findings

### DOC-R4C17-02 — `rollbackOgAttempt` docstring cites "topic not found" as the canonical rollback example, but the topic route is test-LOCKED to never roll back
- **File:** `apps/web/src/lib/rate-limit.ts:224-228` ("Used when the
  request was rejected before the expensive CPU work ran (e.g., topic
  not found) — the user should not be charged…") vs
  `apps/web/src/app/api/og/route.tsx:67-74` (post-DB 404 deliberately
  charged, with the enumeration-oracle comment) and
  `__tests__/og-route-source-contracts.test.ts:9` (asserts the topic
  route contains NO `rollbackOgAttempt`).
- **Severity/Confidence:** LOW / High. CONFIRMED.
- **Why:** the docstring documents the policy AGG8F-01 explicitly
  reversed; the only remaining legitimate rollback class is pre-DB
  syntactic validation. A future contributor reading the docstring
  would re-introduce exactly the SEC-R4C17-01 divergence (and the
  photo route shows that already happened once).
- **Fix:** rewrite the docstring in the SEC-R4C17-01 commit: rollback
  is ONLY for rejections that consumed no post-validation work
  (malformed params before any DB/CPU); post-DB failures stay charged
  per the enumeration-oracle policy; cite both routes' source-contract
  tests.

### Verified accurate (no action)

- `CLAUDE.md` color/HDR + backfill + migration runbook sections match
  shipped code (spot-checked: `IMAGE_PIPELINE_VERSION = 7`, advisory
  lock names vs `lib/advisory-locks.ts`, two backfill entry points,
  44 px policy text including the c16 native-`<select>` extension).
- `61218056` commit body + `constants.ts:6-14` scope comment now agree
  (DOC-R4C16-01 resolved as planned; verified the comment text).
- `lib/og-photo-fetch.ts` header doc (R24-M1 design intent) matches
  implementation (ascending iteration, caps, fallback semantics).
- `lib/mysql-datetime.ts` rationale matches MySQL strict-mode behavior
  and the driver convention it cites.
- `db/seed.ts` dead-script status unchanged (DEF-R4C16-A carried;
  exit criterion not fired — no re-reference appeared this cycle).
- `manifest.ts` dark-splash intent (DEF-R4C16-B) — manifest untouched
  this cycle; exit criterion not fired.
- `caption-generator.ts` stub docs honestly describe the deferred ONNX
  swap; the stub's `slice(0, 140)` truncation is noted by the code
  angle as OBS-R4C17-A (convention nit, EXIF camera models are ASCII
  in practice — recorded, not scheduled).
- `analytics-client.tsx` R27-UX-MED-2 approximate-counter disclaimer
  matches the CLAUDE.md runtime-topology honesty note.
- `robots.ts` R18-L5 comment matches behavior (api disallow + sitemap
  pointer).

## Doc-debt watch (carried, untriggered)

- DOC-R4C13-01/02 (CLAUDE.md section refreshes gated on next edit of
  those sections) — neither section edited this cycle; carried.
