# Critic — Cycle 5/100 RPF loop (HEAD `be53b44`, 2026-04-26)

## Skeptical sweep

1. **Is the AGG4-L01 fix actually load-bearing?** The producer writes `data:image/jpeg;base64,${buffer.toString('base64')}`. Today this always matches `ALLOWED_PREFIXES[0]`. The fix is purely speculative defense. Accepted: this is documented in the comment block at `process-image.ts:287-299` as a regression guard for "future MIME drift". Symmetry-with-consumer is itself a maintainability win.

2. **Could the throttle's first-8-char head ever leak more than the warn line already does?** No. The warn line at `:118` prints the same `slice(0,8)`. Throttle key cannot be more leaky than the visible log.

3. **Is the rejection-log Map a memory leak surface for an attacker who crafts varying first-8-char prefixes?** Cap 256 + LRU eviction. Bounded. Worst-case attacker fills the Map with 256 distinct prefixes; each replaces the oldest. No unbounded growth.

4. **Are there other DB columns that flow into CSS `url()` without a similar contract?** Searched `grep -rn 'style.*url('` and found no other CSS url() injections from DB-sourced values. The `<picture>`/`<img src>` paths use Next/Image which rejects non-allowlisted hosts.

5. **Tests deterministic across run order?** `_resetBlurDataUrlRejectionLogForTests()` is invoked in `beforeEach`. Yes.

## Findings

**No new findings.** Convergence prediction from cycle 4 confirmed.

## Confidence

High.
