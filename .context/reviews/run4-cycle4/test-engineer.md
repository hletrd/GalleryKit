# Run-4 Cycle 4 — test-engineer angle

## Gate baseline (clean tree, this cycle)
- vitest: **PASS — 164 files, 1591/1591 tests** (227 s)
- typecheck (`typecheck:app` + `typecheck:scripts`): PASS
- eslint: PASS, 0 errors / 0 warnings
- lint:api-auth: PASS · lint:action-origin: PASS ·
  lint:public-route-rate-limit: PASS
- build / e2e: exercised during PROMPT 3 after fixes (build embeds the
  typecheck config; e2e needs the compose DB).

No flaky test observed this cycle (the R4C3 `vi.waitFor` rework of the
backfill detection-failure drain held).

## Coverage gaps tied to this cycle's findings

### TEST-R4C4-10 — debounce SWR behavior unlocked (MED-gap / High)
`serve-upload-settings-debounce.test.ts` pins burst-dedupe + TTL refetch +
ETag hash, but nothing pins "a stale-window request must NOT await the
refresh" — the property PERF-R4C4-01 fixes. Without it, a future revert to
blocking-refresh passes the suite. Add a resolve-order case (slow mock
config fetch; assert the response resolves before the refetch completes)
and keep the call-count TTL assertion.

### TEST-R4C4-11 — refund convergence path untested (MED-gap / High)
`refund-clears-download-token.test.ts` locks the happy-path UPDATE shape.
No case covers the catch branch mapping `charge_already_refunded` →
convergence. Add: Stripe mock throws `{code:'charge_already_refunded'}` →
expect the convergence UPDATE (refunded:true, hash:null) and `{success:true}`;
plus a sub-case where the convergence UPDATE itself fails → error preserved.

### TEST-R4C4-12 — LR route post-save containment uncovered (LOW-MED-gap / High)
`lr-upload-hdr-gate.test.ts` exercises the HDR reject; nothing exercises a
throw between claim and insert. With the COR-R4C4-03 widening, add a case
where `assertBlurDataUrl` (or extractExifForDb) throws → expect JSON 500
`{error:'Upload failed'}`, original deleted, tracker settled to zero.

### TEST-R4C4-13 — tokens-client Enter-key guard unpinned (LOW-gap / High)
`client-source-contracts.test.ts` is the established home for client-side
source contracts. Add an assertion that the tokens-client Enter handler
checks the pending flag (and calls preventDefault), matching the
image-manager/topic-manager sibling pattern, so UX-R4C4-04 cannot regress
silently.

### TEST-R4C4-14 — smart-collections value-type validation (LOW-gap / High)
`smart-collections` suite covers structure/depth/allowlist; no case feeds
non-scalar `value`/`lo`/`hi`/`values[]`. Add reject cases (object, array,
null, NaN-producing) + accept cases (string, number) with HARD-R4C4-07.

### TEST-R4C4-15 — download route open-before-claim contract (LOW-MED-gap / Medium)
After COR-R4C4-06, lock the ordering: file-handle open precedes the
claim UPDATE, ENOENT-at-open returns 404 with the token unconsumed, and the
already-used 410 path closes the handle. A source-contract regex test is
acceptable if a full behavioral harness is disproportionate (route depends
on db + fs mocks); prefer behavioral if the existing
refund/stripe-download test scaffolding extends cheaply.

## Standing observations (no action this cycle)
- The two fixture styles (source-regex contracts vs behavioral mocks) are
  both healthy; keep new locks in whichever file already owns the surface.
- e2e suite (6 specs) remains green per run4-cycle1's cold-DB fix; nothing
  in this cycle's findings needs a new e2e (all are unit-coverable).
