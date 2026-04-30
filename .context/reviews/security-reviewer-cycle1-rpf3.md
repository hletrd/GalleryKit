# security-reviewer — Cycle 1 RPF v3 (HEAD: 67655cc)

## Scope

Audit whether the proposed fixes introduce any new security concerns.

## Findings

### SR-1 (No-finding) — Login form size changes do not affect auth

`<Button className="w-full">` -> `w-full h-11`, password toggle `w-9 h-9`
-> `w-11 h-11`. Purely visual. The `useActionState(login, initialState)`
pipeline and rate-limited `login` action in `apps/web/src/app/actions/
auth.ts` are unchanged.

### SR-2 (No-finding) — `tag_names` correlated-subquery fix has no SQL injection surface

Whether the fix takes the JOIN approach or the column-ref approach, all
interpolations are Drizzle schema column or table references — never user
input. `tagSlugs` is filtered through `isValidTagSlug` regex in
`buildTagFilterCondition` before reaching `eq(tags.slug, slug)`.

### SR-3 (No-finding) — Action-origin lint passes after fix

No mutating server-action files are modified. `lint:action-origin` and
`lint:api-auth` remain green.

### SR-4 (No-finding) — No CSRF, SSRF, or path-traversal regressions

No upload, no file-system ops, no admin-route changes.

## Verdict

**No new security findings.** The fix wave is purely visual (touch
targets) plus a data-layer correctness fix. No new attack surface, no new
attack paths, no auth/CSRF/input-validation regressions.
