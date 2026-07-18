# Cycle 10 — debugger

Reviewed HEAD: `1e3646e3` (2026-07-18)

## Inventory and fault search

I used the complete 946-file inventory and traced failure paths through upload admission, original persistence, processing claims/retries, three-format encode and rollback, delete/pending cleanup, restore/drain/resume, detached settings refresh, public responsive rendering, and shutdown/background work. I checked error branches, `finally` ownership, races around invalidation, timers, partial DB/file commits, parser bounds, null/empty inputs, and tests that assert source text without exercising runtime behavior.

## Finding DBG-C10-01 — small inputs deterministically generate lying candidate metadata

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed, deterministic; same root as CORE-C10-01**
- Regions: `apps/web/src/lib/process-image.ts:1212-1234`; `apps/web/src/lib/image-url.ts:91-95`; `apps/web/src/__tests__/image-url.test.ts:110-136`; `apps/web/src/__tests__/public-grid-srcset-contract.test.ts:11-28`.
- Competing hypotheses tested: (a) Sharp might upscale to the configured suffix — disproved by `resizeWidth = processingBaseWidth < size ? processingBaseWidth : size`; (b) oversized aliases might be omitted — disproved by the loop and duplicate hard-link/copy branch; (c) the helper may know the source width — disproved by its four-argument signature and suffix-only mapping; (d) tests may inspect file metadata — disproved, they assert literal strings/source call counts.
- Concrete failure: a 1000 px input creates `_1536`, `_2048`, `_4096`, `_5120`, and `_7680` files whose pixel width is 1000. The helper advertises those values verbatim as `1536w`…`7680w`. Browser selection is therefore based on false resource metadata. WI-15 can cause the same result with an originally larger wide-gamut input.
- Fix: propagate actual processed candidate widths, dedupe aliases resolving to the same width, and add an integration regression that encodes a narrow fixture, reads each output's Sharp metadata, and compares it to emitted descriptors.

## Detached-config race recheck (non-finding)

The latest owner/generation fix at `gallery-config.ts:234-282` is sound for the reported race. A pre-invalidation read captures an old generation and cannot publish. Its `finally` clears only its unique owner; after invalidation/read B, owner A cannot clear B. The controlled test at `gallery-config-uncached-microcache.test.ts:143-187` exercises the decisive resolution order. I found no remaining same-process stale-owner interleaving.

## Final sweep

I revisited partial encoder rollback, backup cleanup, delete-during-reencode, restore marker recovery, pending revocation/deletion drains, `Promise.allSettled` side effects, parser bounds, and route input normalization. No second new reproducible bug met the filing threshold. The stale Cycle 9 plan is recorded by code/architecture reviewers rather than duplicated as a runtime debugger finding.
