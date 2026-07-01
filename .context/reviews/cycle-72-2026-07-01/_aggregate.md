# Cycle 72/100 Aggregate Review

HEAD reviewed: `363dc1c9` (`fix(cycle-71): guard sidecars during restore maintenance`).
Cycle date: 2026-07-01.

## Agent Coverage

- Code reviewer / architect: 2 findings.
- Security reviewer: 0 findings; security lint/audit evidence clean.
- Performance / deploy reviewer: 1 finding.
- Test engineer / verifier: 3 findings.
- Designer / accessibility reviewer: 2 findings.
- Critic / product-photographer reviewer: 0 findings.

## Deduplicated Findings

### C72-01 - Durable restore-maintenance marker can fail open on unreadable paths

- Severity/confidence: Medium / High.
- Source: code-reviewer.
- File/line: `apps/web/src/lib/restore-maintenance-durable.ts:36-43`.
- Problem: the durable marker read uses `existsSync`, which can produce false for unreadable marker paths instead of failing closed.
- Failure scenario: sidecar processes proceed into writes during restore maintenance if their marker path is unreadable or permission-misconfigured.
- Plan: scheduled.

### C72-02 - Color sidecar can rewrite derivative files after restore maintenance starts mid-row

- Severity/confidence: Medium / Medium.
- Source: code-reviewer.
- File/line: `apps/web/scripts/backfill-color-pipeline.ts:515`, `apps/web/scripts/backfill-color-pipeline.ts:227`, `apps/web/src/lib/process-image.ts:1182`, `CLAUDE.md:217`.
- Problem: the sidecar DB guards do not cover the derivative final-write boundary inside `processImageFormats()`.
- Failure scenario: derivative bytes are rewritten during a restore window while the later DB update is blocked, leaving files out of sync with restored SQL state.
- Plan: scheduled.

### C72-03 - Temporary per-photo OG fallback redirects are cached as long-lived successes

- Severity/confidence: Medium / High.
- Source: perf-deploy-reviewer.
- File/line: `apps/web/src/app/api/og/photo/[id]/route.tsx:19`, `apps/web/src/app/api/og/photo/[id]/route.tsx:131`, `apps/web/src/app/api/og/photo/[id]/route.tsx:136`, `apps/web/src/app/api/og/photo/[id]/route.tsx:282`, `apps/web/src/app/api/og/photo/[id]/route.tsx:296`.
- Problem: temporary fallback redirects reuse the long `s-maxage=86400` generated-image cache policy.
- Failure scenario: social previews can show the default card for a day after the actual derivative becomes available.
- Plan: scheduled.

### C72-04 - Feed conditional tests are stale and do not prove route behavior

- Severity/confidence: Medium / High.
- Source: test-engineer.
- File/line: `apps/web/src/__tests__/feed-conditional.test.ts:2`, `apps/web/src/__tests__/feed-sized-derivative.test.ts:63`, `apps/web/src/__tests__/feed-sized-derivative.test.ts:68`, `apps/web/src/app/feed.xml/route.ts:156`, `apps/web/src/app/feed.xml/route.ts:157`.
- Problem: a stale helper test exercises dead code instead of current feed route ETag/304 behavior.
- Failure scenario: route-level feed conditional regressions can pass the suite.
- Plan: deferred with exit criterion.

### C72-05 - Shipped restore-maintenance recovery command is only syntax/source-contract tested

- Severity/confidence: Medium / Medium.
- Source: test-engineer.
- File/line: `apps/web/package.json:20`, `apps/web/Dockerfile:125`, `apps/web/scripts/restore-maintenance-recovery.mjs:13`, `apps/web/scripts/restore-maintenance-recovery.mjs:21`, `apps/web/src/lib/restore-maintenance-durable.ts:24`.
- Problem: the production-copied `.mjs` recovery command duplicates marker logic and lacks subprocess behavior coverage.
- Failure scenario: durable marker path behavior drifts between the app helper and shipped recovery command.
- Plan: scheduled.

### C72-06 - Browser matrix invariants are mostly mocked, not engine-smoked

- Severity/confidence: Low / High.
- Source: test-engineer.
- File/line: `CLAUDE.md:365`, `CLAUDE.md:377`, `apps/web/playwright.config.ts:72`, `apps/web/src/__tests__/use-display-capability.test.ts:4`.
- Problem: documented Firefox/WebKit display-capability behavior is not covered by a real-engine smoke.
- Failure scenario: non-Chromium behavior regresses while mocked unit tests and Chromium e2e stay green.
- Plan: deferred with exit criterion.

### C72-07 - Settings validation ignores reduced-motion preference

- Severity/confidence: Medium / High.
- Source: designer.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:167`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:173`, `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:23`.
- Problem: invalid settings focus always smooth-scrolls and the source contract locks that behavior.
- Failure scenario: admins with reduced motion enabled still receive smooth animated scrolling on validation failure.
- Plan: scheduled.

### C72-08 - Swipe navigation haptics do not respect reduced-motion preference

- Severity/confidence: Low / Medium.
- Source: designer.
- File/line: `apps/web/src/components/photo-navigation.tsx:127`, `apps/web/src/components/photo-navigation.tsx:129`, `apps/web/src/components/photo-navigation.tsx:135`.
- Problem: `navigator.vibrate()` is called without checking `shouldReduceMotion`.
- Failure scenario: swipe navigation can produce haptic feedback for users who prefer reduced motion.
- Plan: scheduled.

### C72-09 - Cycle 71 plan/index still mark completed work as active

- Severity/confidence: Low / High.
- Source: local aggregation sweep.
- File/line: `.context/plans/README.md:7`, `.context/plans/cycle-71-2026-07-01-plan.md:42`.
- Problem: the ledger still marks Cycle 71 active and leaves commit/deploy progress unchecked even though `363dc1c9` is the current pushed/deployed cycle baseline.
- Failure scenario: future cycles infer the wrong current plan state from the index.
- Plan: scheduled.

## Agent Failures

None. One initial critic lane spawn hit the thread limit; it was retried after a completed lane closed and returned successfully.

## Deferred Items Summary

New deferred findings this cycle: `C72-04`, `C72-06`.

Security, correctness, and data-consistency findings are scheduled, not deferred. Carry-forward deferred items remain in the matching cycle plan/deferred artifact.
