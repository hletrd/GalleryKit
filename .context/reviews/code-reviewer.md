# Code Reviewer — Cycle 7 (review-plan-fix loop, 2026-04-25)

## Lens

General code quality, maintainability, idiomatic correctness. Skipping Unicode work per directive.

## Findings

### C7L-CR-01 — Duplicate `tagsString.split(',')` parse in `uploadImages`
- File: `apps/web/src/app/actions/images.ts:141-149`
- Severity: LOW
- Confidence: High
- Issue: `tagsString.split(',')` runs twice; the second pass only counts the non-empty parts to compare against the validated tag-name count. Aside from cost (small), the divergence creates a maintenance hazard: changing the parse rule in line 142 (e.g. supporting `;` as a separator) requires updating line 147 too.
- Failure scenario: Future change introduces semicolon as separator in line 142 only — `tagNames` populates but the count check at line 147 silently rejects every batch with `invalidTagNames`.
- Fix: Single split, derive `rawCandidates` and `tagNames` from one source.

### C7L-CR-02 — `images.ts:142` filter chain runs `getTagSlug(t)` for every `t`, then again at line 325
- File: `apps/web/src/app/actions/images.ts:142,325`
- Severity: INFO
- Confidence: Medium
- Issue: `getTagSlug` runs twice for tags that survive both filters (once in validate, once when persisting). Minor work duplication. Acceptable for now.
- Fix: Defer.

### C7L-CR-03 — `loadMoreImages` reads `loadMoreRateLimit.get(ip)?.count` after just `set`-ing the entry
- File: `apps/web/src/app/actions/public.ts:64`
- Severity: INFO
- Confidence: Medium
- Issue: After `preIncrementLoadMoreAttempt` modifies the entry, line 64 re-reads via `loadMoreRateLimit.get(ip)?.count ?? 0`. In single-threaded Node this is impossible to mis-read, but the indirect access is needlessly verbose. Reading the entry's `count` directly through the locally-assigned reference would be cleaner.
- Fix: Use the local `entry` variable directly.

### C7L-CR-04 — `console.debug` swallowing audit-log failures
- File: Multiple (e.g. `topics.ts:133`, `sharing.ts:151,346`, `admin-users.ts:153,243`, `seo.ts:163`, `images.ts:482,594,707`)
- Severity: LOW
- Confidence: High
- Issue: `console.debug` is the level for operational quiet-down. For audit log writes, `console.warn` would be more visible without spamming. Production NODE_ENV=production frequently filters debug.
- Fix: Defer; promote audit-log catch sites to `console.warn`. Not urgent.

### C7L-CR-05 — `topics.ts:185` lineage comment carries C5L/C6L IDs as the lineage extends
- File: `apps/web/src/app/actions/topics.ts:183-185`
- Severity: INFO
- Confidence: Low
- Issue: Comment cites C5L-SEC-01 / C6L-ARCH-01, but as lineage grows, ID-based comments accumulate. Not a functional issue.
- Fix: None this cycle.
