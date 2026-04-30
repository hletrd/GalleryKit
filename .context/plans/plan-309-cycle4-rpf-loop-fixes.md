# Plan 309 — Cycle 4 RPF loop fixes (HEAD `1234be7`)

Source review: `.context/reviews/_aggregate.md` (cycle 4) and
`.context/reviews/_aggregate-cycle4-rpf-loop.md`.

## Scope

Address every cycle-4 finding from the aggregate. All 1 LOW + 4 INFO
findings center on a single, focused producer/consumer wiring asymmetry
plus a doc cross-reference that resolves automatically once the wiring
fix lands. Per repo policy (CLAUDE.md, Git Commit Rules), every commit
will be GPG-signed (`-S`), use Conventional Commits + gitmoji, and be
pushed immediately after each iteration.

## Tasks

### TASK-309-1 — Wire `assertBlurDataUrl` on the producer side (AGG4-L01)

- **Severity:** Low / **Confidence:** High
- **Cross-agent agreement:** 9/11
- **Files:**
  - `apps/web/src/lib/process-image.ts:286` (wrap the literal)
  - `apps/web/src/lib/process-image.ts` import section (add import)

**Approach:** import `assertBlurDataUrl` from `@/lib/blur-data-url`.
Replace the existing literal assignment:
```ts
if (blurBuffer.length > 0) {
    blurDataUrl = `data:image/jpeg;base64,${blurBuffer.toString('base64')}`;
}
```
with:
```ts
if (blurBuffer.length > 0) {
    const candidate = `data:image/jpeg;base64,${blurBuffer.toString('base64')}`;
    blurDataUrl = assertBlurDataUrl(candidate);
}
```

The existing outer `try`/`catch` already handles the "blur generation
failed" path by leaving `blurDataUrl = null`; `assertBlurDataUrl`
returning `null` on a contract miss falls into the same null path
naturally — no callers need to change. The downstream consumer at
`actions/images.ts:307` continues to call `assertBlurDataUrl()` (it's
now a guaranteed no-op for already-validated values, which is fine and
keeps the defense-in-depth shape).

**Done when:**
- `process-image.ts` imports `assertBlurDataUrl` from `@/lib/blur-data-url`.
- The literal assignment is wrapped through the validator.
- All existing tests still pass; no behavior change in the happy path
  (every blur output today fits inside the cap).

### TASK-309-2 — Add producer-side wiring fixture test (AGG4-L01 / TE4-LOW-01 / V4-LOW-01)

- **Severity:** Low / **Confidence:** Medium
- **Files:** new test
  `apps/web/src/__tests__/process-image-blur-wiring.test.ts`

**Approach:** mirror the shape of
`apps/web/src/__tests__/images-action-blur-wiring.test.ts`:
- Read source of `apps/web/src/lib/process-image.ts`.
- Assert it imports `assertBlurDataUrl` from `@/lib/blur-data-url`.
- Assert the literal `data:image/jpeg;base64,` appears wrapped in
  `assertBlurDataUrl(`. Concretely:
  - Positive: the source contains
    `assertBlurDataUrl(\`data:image/jpeg;base64,` (template-literal
    wrapped) OR `assertBlurDataUrl(candidate)` where the prior line
    builds the literal into `candidate`.
  - Negative: the source does NOT directly assign the unwrapped
    literal to `blurDataUrl`.

A regex pair similar to the action wiring test:
```ts
expect(source).toMatch(/import\s*\{[^}]*\bassertBlurDataUrl\b[^}]*\}\s*from\s*['"]@\/lib\/blur-data-url['"]/);
expect(source).toMatch(/assertBlurDataUrl\s*\(/);
expect(source).not.toMatch(/blurDataUrl\s*=\s*`data:image\/jpeg;base64,/);
```

**Done when:** test file exists; all assertions pass against the new
producer wiring; refactor regression (e.g. unwrapping the literal back
to a direct assignment) is caught.

### TASK-309-3 — CLAUDE.md doc precision tighten (AGG4-I04 / DS4-INFO-01)

- **Severity:** Info / **Confidence:** High
- **Files:** `CLAUDE.md` (Image Processing Pipeline, step 9)

**Approach:** the existing wording is forward-leaning ("at both write
time (upload action) and read time (photo viewer)"). After TASK-309-1
lands, "write time" actually has TWO call sites: producer
(`process-image.ts`) and consumer (`actions/images.ts`). Update the
parenthetical to:

> at write time (upload action AND `process-image.ts` blur producer)
> and read time (photo viewer)

(or equivalent — short addition to lock the new producer-side call site
in documentation).

**Done when:** CLAUDE.md step 9 reflects the new producer-side call site.

## Quality gates (per cycle policy)

After all three tasks land, run the full gate set against the whole
repo:

- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm test --workspace=apps/web`

Errors are blocking. No suppressions.

## Deferred items

None. All cycle-4 findings (1 LOW + 4 INFO) are scheduled in this plan;
the INFO items either resolve automatically as positive observations
(AGG4-I01, AGG4-I02, AGG4-I03) or as a side effect of TASK-309-1 +
TASK-309-3 (AGG4-I04).

## Commits expected

3 commits (per task), each GPG-signed and pushed:
1. `fix(process-image): 🛡️ wire assertBlurDataUrl on blur producer`
2. `test(process-image): ✅ lock assertBlurDataUrl wiring on producer`
3. `docs(claude-md): 📝 record producer-side blur contract call site`

(Plus optional gate-fix commits if any new gate failure appears, none
expected.)
