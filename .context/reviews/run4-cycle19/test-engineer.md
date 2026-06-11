# Run-4 Cycle 19 — test-engineer angle

## TEST-R4C19-02 — mock-shape divergence let a hard-broken feature pass every gate — **HIGH / High**

The central testing lesson of this cycle: `topics-actions.test.ts`
(`:185`, `:251-252`, `:389` regions) mocks `db.execute` to resolve a
**bare rows array**, but the real drizzle-mysql2 raw `execute` returns
the `[rows, fields]` tuple. The mock encodes the author's wrong
assumption, so the suite green-lights code that fails on every real
request. Eight gates ran every cycle for 6 weeks while topic creation
was deterministically broken in production.

Required with the COR-R4C19-01 fix:
1. **Mock fidelity:** every `db.execute` mock in topics-actions.test.ts
   must resolve runtime-accurate tuples (`[[], []]` for no-conflict,
   `[[{ found: 1 }], []]` for conflict).
2. **Failing-pre-fix regression lock:** assert `createTopic` SUCCEEDS
   when the segment-exists query matches zero rows, and that the
   conflict branch still fires on `[[{found:1}],[]]`. The success
   assertion must be proven failing against the pre-fix source.
3. **Rename + alias coverage:** same two assertions through
   `updateTopic` (slug change) and `createTopicAlias`.

## TEST-R4C19-07 — no admin topic-management e2e — **MED / High**

`e2e/admin.spec.ts` covers login/nav, the GPS toggle, and upload+delete
— but no topic CRUD, which is why no e2e caught a fully broken
create-topic flow. Schedule a `topic create → visible in categories
table → delete` spec inside the existing `adminE2EEnabled` describe
(same opt-in lane as upload). Keep it self-cleaning like the upload
test's try/finally. Rename/alias e2e is nice-to-have; the unit locks
cover those branches — do not over-build the slow lane.

## Backfill scripts have zero test coverage (recorded, partially scheduled)

- The keyset-pagination fix (COR-R4C19-04) touches alt-text +
  clip-embeddings backfills. Both scripts import `../src/db` at module
  scope, which makes them awkward to unit-test without refactoring to
  injectable deps — out of proportion for operator one-shots. The
  fix's correctness argument (cursor strictly increases; terminal
  condition `rows.length === 0`) is reviewable by inspection.
  RECORD: no unit tests scheduled for the scripts themselves; the
  pagination shape is locked by comment + this review trail.
- `backfill-cicp-recheck` tuple fix: same rationale.

## Mock-fidelity sweep for other `db.execute` mocks

Grepped `__tests__` for `db.execute` mock shapes: the admin-tokens and
admin-backfill-runner suites mock at module boundaries
(`vi.mock('@/lib/admin-tokens')`) or feed tuple-tolerant code (their
production code unwraps either shape), so no other suite encodes the
bare-array assumption against raw-tuple consumers. topics-actions is
the only divergent suite. (`check-api-auth.test.ts` and
`check-action-origin.test.ts` exercise the scanners on source-string
fixtures — no DB mocks.)

## e2e suite quality review (rotation surface, first run-4 pass)

- `helpers.ts`: auto-enable logic for local admin e2e is careful
  (production refusal, remote double opt-in, hash-as-password
  refusal). `waitForImageProcessed` polls the DB directly with a 30 s
  deadline — deterministic, no UI-timing flake.
- `public.spec.ts`: locks H1/H2/H3 hierarchy, focus trap, restore-on-
  close, shared-group context preservation — good a11y regression
  locks, all selector-stable (role/name based).
- `origin-guard.spec.ts`: asserts the 403 spoofed-origin branch with a
  real DB-minted session; also asserts the unauthenticated branch.
  The CI-only `expect(adminE2EEnabled).toBe(true)` canary prevents the
  silent-skip failure mode. Sound.
- `nav-visual-check.spec.ts` / `test-fixes.spec.ts`: viewport-driven
  visibility + focus-reveal polls — stable patterns (expect.poll on
  computed opacity, not screenshots).
- Gap noted above (TEST-R4C19-07) is the only material hole found.

## Cycle-18 lock verification

- `feed-sized-derivative.test.ts` (+34 lines): guard-above-data-layer
  source-order locks present for the topic feed locale fix.
- `stripe-webhook-source.test.ts` (+43 lines): guard-above-INSERT +
  FK-coded-catch-200 + transient-500-preserved locks present.
Both proven failing pre-fix per plan-307's evidence trail.
