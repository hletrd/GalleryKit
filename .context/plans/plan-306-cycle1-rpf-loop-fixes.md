# plan-306 — Cycle 1/100 RPF loop fixes (HEAD `ffad727`, 2026-04-26)

**Aggregate:** `.context/reviews/_aggregate.md`
**Run context:** review-plan-fix loop, 2026-04-26, cycle 1/100
**Deploy mode:** per-cycle (`npm run deploy` after gates).

## Goals

Address all NEW findings from cycle-1 reviewer fan-out:
- 2 MEDIUM (AGG1-M01 audit coverage gap; AGG1-M02 audit scan-roots structural).
- 9 LOW (AGG1-L01..L10, deduped by ID).

Fine-grained commits per finding. Each commit GPG-signed (`-S`),
semantic gitmoji format. Always `git pull --rebase` before push.

## Tasks

### T1 — AGG1-M01 / AGG1-M02 / AGG1-L02 / AGG1-L09 / AGG1-L10 — Widen touch-target audit to admin route group

**File:** `apps/web/src/__tests__/touch-target-audit.test.ts`

**Change:**
1. Replace the implicit `componentsDir` literal with an explicit `SCAN_ROOTS` constant array containing both `componentsDir` and the admin route paths (`apps/web/src/app/[locale]/admin/(protected)/` recursive + `apps/web/src/app/[locale]/admin/login-form.tsx`).
2. Walk every root via `listFilesRecursive` instead of the one-off `scanFile(loginForm)` call.
3. Add `KNOWN_VIOLATIONS` entries for each existing admin-route file violation with documented per-file rationale and re-open criterion. Use the documented-exemption path (matches the cycle-2 pattern for `image-manager.tsx`) — do NOT yet raise admin destructive controls to `h-11`; that's a UX scope-creep change.
4. Update the docstring at lines 6-22 to accurately list the scanned roots.
5. Update the "single login form" `it()` block to reuse the wider scan rather than the standalone `scanFile` call (or remove it — it becomes redundant).
6. Drop the dead `adminDir` variable OR repoint it as the second scan root (preferred).

**Acceptance:**
- The widened audit catches a NEW `<Button size="sm">` in `dashboard-client.tsx` if introduced.
- All existing admin-route violations are documented in `KNOWN_VIOLATIONS` with a re-open criterion comment.
- Vitest still passes (no false positives).
- Docstring accurately names the scanned roots.

**Commit message:** `test(a11y): ✅ widen touch-target audit to admin (protected) route group`

### T2 — AGG1-L01 — Redact `assertBlurDataUrl` warn log

**File:** `apps/web/src/lib/blur-data-url.ts:60-66`

**Change:** Replace `value.slice(0, 24)` with a redacted preview that
captures only `typeof value` + `value.length` + the first 8 chars
(enough to distinguish `data:image/jpeg;base64`, `data:image/png;…`,
or a non-`data:` URL prefix without leaking arbitrary URL contents).

**Acceptance:**
- Update the existing `blur-data-url.test.ts` to assert the warn line shape.
- Manual smoke: rejecting `https://attacker.example/?token=...` logs a non-leaking line.

**Commit message:** `fix(blur-data-url): 🔒 redact rejected value preview in warn log`

### T3 — AGG1-L06 — Memoize photo-viewer blur backgroundImage style

**File:** `apps/web/src/components/photo-viewer.tsx:375-380`

**Change:** Wrap the inline `style={...}` object in `useMemo`
keyed on `image.blur_data_url` so re-renders unrelated to the
photo do not reassign the inline style.

**Acceptance:**
- Photo viewer still renders blur preview correctly.
- The style object identity is stable across re-renders for a given image.

**Commit message:** `perf(photo-viewer): ⚡ memoize blur backgroundImage style`

### T4 — AGG1-L07 — Compile-time guard for large/perf-sensitive listing fields

**File:** `apps/web/src/lib/data.ts:197-199`

**Change:** Mirror `_PrivacySensitiveKeys` with `_LargePayloadKeys = 'blur_data_url'` and assert via `_LargePayloadKeysInPublic = Extract<keyof typeof publicSelectFields, _LargePayloadKeys>` + `const _largePayloadGuard: _LargePayloadKeysInPublic extends never ? true : [...]`.

**Acceptance:**
- TypeScript compile fails if a future contributor adds `blur_data_url` to `publicSelectFields` (regardless of alias).
- Existing types and queries unchanged.

**Commit message:** `refactor(data): 🛡️ add compile-time guard against large fields in publicSelectFields`

### T5 — AGG1-L09 — Audit KNOWN_VIOLATIONS map readability

**File:** `apps/web/src/__tests__/touch-target-audit.test.ts:50-92`

**Change:** Add a single header comment block at the top of `KNOWN_VIOLATIONS` explaining that:
- Files NOT listed default to 0 violations.
- Listed files with count 0 are kept for visibility (so a contributor sees the file was considered).
This lets us keep the 18 "0" entries (which document audit consideration) without them looking like dead padding.

**Acceptance:** Comment block lands; behavior unchanged.

**Commit message:** `docs(a11y): 📝 explain KNOWN_VIOLATIONS zero-default convention`

## Deferred (recorded per repo deferral policy)

The following findings are deferred this cycle. Each entry preserves
original severity/confidence per CLAUDE.md and the repo deferred-fix
rules in prior `*-deferred-cycle*.md` plan files (this is the same
shape used in plan-87, plan-298, plan-302, plan-304).

### DEF1-L03 (was AGG1-L03 / TE1-LOW-02) — `KNOWN_VIOLATIONS` staleness signal unimplemented

**Severity/confidence:** LOW / Medium (preserved).

**File:** `apps/web/src/__tests__/touch-target-audit.test.ts:243-247`.

**Reason for deferral:** Pure ergonomics. Implementing a
non-failing `console.warn` in a Vitest run is awkward (Vitest
captures stderr by default; would need `--reporter=verbose` to
surface). Trade-off: implementing it adds suite noise that obscures
real failures. Repo policy in CLAUDE.md does NOT mandate it.

**Exit criterion:** Re-open when (a) a stale entry is observed in
review (i.e. an exempt file actually drops to zero violations
between cycles) OR (b) the audit is promoted to a dedicated
`lint:touch-targets` script per AGG1-M02 follow-up — at that point
a structured staleness report becomes natural.

### DEF1-L04 (was AGG1-L04 / D1-LOW-01) — `extractFunctionBody` walker doesn't skip strings

**Severity/confidence:** LOW / Medium (preserved).

**File:** `apps/web/src/__tests__/data-tag-names-sql.test.ts:42-72`.

**Reason for deferral:** Latent only. Verified the four
`getImages*` functions don't carry brace literals inside strings.
The fix is non-trivial (needs string/template-literal state machine
or AST library). Cost-benefit at current scale favors deferral.

**Exit criterion:** Re-open when a refactor adds a string literal
containing `{` or `}` to one of the four functions, OR when the
walker is reused beyond `data.ts`.

### DEF1-L05 (was AGG1-L05 / C1-LOW-02) — Sharp blur output regression test

**Severity/confidence:** LOW / Medium (preserved).

**File:** `apps/web/src/lib/blur-data-url.ts:43`.

**Reason for deferral:** Test requires running the actual Sharp
pipeline against a fixture image. Vitest test infra in this repo
doesn't yet exercise Sharp directly. Adding the harness is a
multi-file change (~50 lines for setup + fixture). Cost-benefit
not justified for a magic-constant regression that surfaces as a
silent-fallback (no preview), not data loss.

**Exit criterion:** Re-open when (a) a blur tile size change is
proposed OR (b) Sharp major version upgrade lands.

### DEF1-L08 (was AGG1-L08 / TE1-LOW-01) — Runtime tag_names DB-fixture test

**Severity/confidence:** LOW / High (preserved).

**File:** `apps/web/src/__tests__/data-tag-names-sql.test.ts`.

**Reason for deferral:** Carry-forward from cycle-2 (was deferred
in plan-304/305). Repo Vitest infra has no live-DB fixture harness.
Setting it up is a multi-file change touching `vitest.config.ts`,
schema setup, and a teardown lifecycle. Out of scope for one
cycle.

**Exit criterion:** Re-open when (a) a live-DB Vitest harness
lands for any reason OR (b) the SQL-shape regex assertion misses
a regression.

## Implementation order

1. T1 (highest signal — fixes the cross-cutting MEDIUM and rolls in three LOW cleanups).
2. T4 (compile-time guard — small surgical change, derisks future regressions).
3. T2 (security ergonomics).
4. T3 (perf micro).
5. T5 (docs).

## Quality-gate checkpoint

After each task:
- `npm run lint --workspace=apps/web` exit 0.
- `npm run lint:api-auth --workspace=apps/web` exit 0.
- `npm run lint:action-origin --workspace=apps/web` exit 0.
- `npm test --workspace=apps/web` all pass.
- `npm run build --workspace=apps/web` exit 0 (run after T4 since it adds a new type guard).

## Deploy

After all five tasks land, gates green, all commits pushed, run
`npm run deploy` once per the per-cycle DEPLOY_MODE.

## Progress

- [x] T1 — AGG1-M01 (audit coverage) — commit `ddd8322`
- [x] T2 — AGG1-L01 (warn log redaction) — commit `6bd99b5`
- [x] T3 — AGG1-L06 (style memoize) — commit `36ae23a`
- [x] T4 — AGG1-L07 (compile-time guard) — commit `6d3d4e4`
- [x] T5 — AGG1-L09 (KNOWN_VIOLATIONS comment) — bundled in commit `ddd8322`
- [x] Gates green (lint exit 0, lint:api-auth exit 0, lint:action-origin exit 0, build exit 0, vitest 64/64 files 438/438 tests)
- [x] Push (commits ddd8322..36ae23a pushed to origin/master)
- [x] Deploy (per-cycle-success — `npm run deploy` completed, container recreated)
