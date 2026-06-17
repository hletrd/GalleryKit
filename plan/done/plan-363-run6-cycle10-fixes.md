# Plan 363 — Run-6 Cycle-10 Fixes

**Source:** `.context/reviews/_aggregate.md` (Run-6 Cycle-10, HEAD `0502ae86`).
**Created:** 2026-06-17
**Status:** DONE — both tasks implemented + DOC-N1/N2/N3 doc-fidelity touch-ups landed. Commits: `71dcd09f` (TASK-1), `563d09d3` (TASK-2), `e56babd3` (DOC-N1/N2/N3). All gates green; deployed per-cycle.

This cycle's 11-agent deep review reached **near-total convergence**. 8 of 11 agents reported 0 findings. Two NEW real findings are scheduled below (1 HIGH operational + 1 MEDIUM test-gap). One designer finding was rejected (REJ-C10-01 — contradicts MDN/ARIA guidance) and one is deferred (DEF-C10-01, → plan-364). All 5 cycle-9 findings verified CLOSED at HEAD.

Neither scheduled finding is deferrable under repo rules: AGG-C10-01 is an availability defect on a shipped feature; AGG-C10-02 is a missing regression guard on a LIVE-surface contract and the fix is cheap+additive.

---

## TASK-1 [HIGH] — Raise the nginx body cap for the Lightroom publish-plugin upload route (AGG-C10-01)

**Problem:** `apps/web/nginx/default.conf:124` — `location ^~ /api/admin/ { client_max_body_size 2M; ... }` is a catch-all that matches `POST /api/admin/lr/upload`. The LR Classic publish plugin (US-P53) uploads full-resolution photos (rendered JPEG exports typically 8-15 MiB; originals larger), which the app caps at 200 MiB (`MAX_UPLOAD_FILE_BYTES`, `lib/upload-limits.ts`). nginx enforces `client_max_body_size` BEFORE proxying, so every real LR upload returns HTTP 413 at the edge before the route runs — the shipped feature is non-functional behind the shipped reverse-proxy config. Silent to the app (request never reaches Node).

**Fix:**
1. In `apps/web/nginx/default.conf`, add a dedicated location for the LR upload route with `client_max_body_size 216M` (same cap as the existing `/admin/dashboard` browser-upload block at lines 91-104), the `admin` rate-limit zone (`limit_req zone=admin burst=10 nodelay; limit_req_status 429;`), and the full proxy + security header set. The block MUST be ordered to win over the `^~ /api/admin/` catch-all — use either a more-specific `^~ /api/admin/lr/upload` prefix location (longest-prefix `^~` wins) placed before the catch-all, OR an exact-path match. Prefer `^~ /api/admin/lr/upload` for clarity and deterministic precedence (nginx selects the longest matching `^~` prefix).
2. Update the CLAUDE.md body-cap table ("Important Notes", ~line 514) to document that `/api/admin/lr/upload` uses the 216 MiB cap (so operators provisioning their own proxy don't re-introduce the 2 MiB trap).
3. Keep all existing caps intact (2M default, 64K login, 250M /admin/db, 216M /admin/dashboard, 2M generic /api/admin/).

**Verification:**
- `nginx -t` style sanity is not runnable in CI, but confirm by inspection that the new `^~ /api/admin/lr/upload` block precedes `^~ /api/admin/` and carries `client_max_body_size 216M` + the admin rate-limit + headers.
- Confirm no regression to the other `/api/admin/*` routes (they keep the 2M cap via the catch-all, which is correct — they are JSON mutations, not uploads).
- Gates: eslint / typecheck / vitest unaffected (config-only + doc). Re-run full gate suite to confirm green.

**Files:** `apps/web/nginx/default.conf`, `CLAUDE.md`.

**Status:** DONE — commit `71dcd09f`. Added `^~ /api/admin/lr/upload` (216M) ordered before the `^~ /api/admin/` 2M catch-all; longest-prefix match guarantees precedence. Documented the cap in the CLAUDE.md body-cap table. Other `/api/admin/*` JSON routes retain the 2M cap.

---

## TASK-2 [MEDIUM] — Pin `lens_model`/`capture_date` in the similar-route 200-path test (AGG-C10-02)

**Problem:** `apps/web/src/__tests__/similar-route.test.ts` — the `vi.mock('@/db', ...)` `images` schema stub omits `lens_model` and `capture_date`, and the 200-path test only asserts `res.status` + `body.results[0].imageId`. The production route (`app/api/search/similar/[id]/route.ts:205-206,227-228`) selects + returns both fields (AGG-C8-10 parity fix), and the `SimilarResult` interface (`components/similar-photos.tsx:29-30`) requires them (AGG-C9-04). A future SELECT-drop regression would pass all tests silently, re-opening the "blank lens/date on similar cards" defect with no failing test.

**Fix:**
1. Add `lens_model: 'lens_model'` and `capture_date: 'capture_date'` to the mocked `images` schema object in the `vi.mock('@/db', ...)` block.
2. Populate `lens_model` + `capture_date` on the `imageRows` fixture row(s) used by the 200-path test.
3. In the 200-path assertion, add `expect(body.results[0]).toHaveProperty('lens_model', <value>)` and `expect(body.results[0]).toHaveProperty('capture_date', <value>)` so a dropped SELECT field fails the test.
4. Run `npm run typecheck --workspace=apps/web` before committing (test-file type errors only surface through the typecheck gate, not the build).

**Verification:**
- `npm test --workspace=apps/web -- similar-route` passes with the new assertions.
- Sanity: temporarily removing `lens_model` from the route SELECT should make the new assertion fail (mental check / optional local spike — do NOT commit the route change).
- Full gate suite green.

**Files:** `apps/web/src/__tests__/similar-route.test.ts`.

**Status:** DONE — commit `563d09d3`. Declared `lens_model`/`capture_date` in the mock `images` schema, populated them on the neighbour fixture, and added `toHaveProperty('lens_model', …)` / `toHaveProperty('capture_date', …)` on the enriched 200-path result. Typecheck + the 12-test similar-route suite pass.

---

## Optional doc-fidelity touch-ups (NON-FINDINGS — fold in opportunistically, not required for convergence)

Per the convergence directive, doc nitpicks are not findings. If a doc commit is being made anyway (TASK-1 touches CLAUDE.md), these three may ride along; otherwise skip — they do not block.

- **DOC-N1:** CLAUDE.md ~line 139 — `avif_10bit` is tagged "admin-only (AGG-D6/DOC-06)" but the code exposes it publicly (`data.ts:275-277`, R10-M4). Retag → "public-safe (R10-M4)".
- **DOC-N2:** CLAUDE.md `settings-hash.ts:37-49` line ref is off; array starts at `:41`. Count (9) + key names correct.
- **DOC-N3:** CLAUDE.md "masonry grid: useMemo for reorder" — it's pure CSS columns now.

---

## Progress log

- 2026-06-17: Plan created from cycle-10 aggregate. 2 schedulable findings (1 HIGH, 1 MED). TASK-1, TASK-2 PENDING.
