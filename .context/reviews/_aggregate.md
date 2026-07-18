# Cycle 3 Aggregate Review

Date: 2026-07-18 KST
Review HEAD: `afa11cf4`

## Agent coverage

Completed provenance reviews: code-reviewer, perf-reviewer,
security-reviewer, critic, verifier, test-engineer, tracer, architect,
debugger, document-specialist, and designer. No reviewer failed.

The environment exposed two concurrent worker slots rather than eleven named
reviewer profiles, so the required perspectives were distributed across two
workers and each perspective produced its own provenance file. Both workers
first inventoried the full repository and recorded final missed-file sweeps.
The designer read and used the complete applicable `agent-browser` skill set
and exercised the production UI at 1536x900 and 393x852 with accessibility
snapshots, computed DOM/box metrics, focus/keyboard interaction, theme/search
states, network/debug/trace tooling, and responsive geometry. Authenticated
admin pages, trustworthy reduced-motion emulation, and a cold retained request
log remained live-validation limitations; findings below do not depend on
those unavailable proofs.

## New deduplicated findings

### C3-01 — Closed mobile tag disclosure leaves its flex panel rendered beneath the gallery

- Severity/Confidence: **High / High**
- Agreement: designer, with direct fresh-session Chromium evidence
- Regions: `apps/web/src/components/tag-filter.tsx:143-160`
- Failure: the author `flex` utility overrides Chromium's closed-`details`
  hiding rule. At 393 px, `details.open` was false and its box was 44 px tall,
  but the tag group still computed to `display:flex` with a 361x200 rectangle
  starting below the summary. The accessibility tree and Tab order omitted the
  controls while the panel painted underneath the first masonry card; hit
  testing selected the photo layer instead of a tag chip. Opening correctly
  exposed the group and moved the grid, then closing reproduced the mismatch.
- Disposition: schedule this cycle. Explicitly hide the group while closed,
  preserve the open flex layout, and add a real mobile browser regression for
  rendered box/hit-target/flow behavior.

### C3-02 — CSS multi-column placement invalidates first-N image priority and preload targeting

- Severity/Confidence: **Medium / High**
- Agreement: code-reviewer, perf-reviewer, architect, debugger, tracer, and
  designer; independently reproduced in isolated and live Chromium geometry
- Regions: `apps/web/src/components/home-client.tsx:129-169,272-314,363-375`;
  `apps/web/src/components/masonry-card.tsx:21-33,121-145`;
  analogous first-N scheduling in
  `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:187-196,220-245`,
  `apps/web/src/app/[locale]/(public)/timeline/page.tsx:138,227-282`, and
  `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:131,189-241`
- Failure: the scheduling code equates DOM indices `0..columnCount-1` with a
  visual first row, but CSS columns balance top-to-bottom chunks. Live 1536 px
  production geometry put eager/high cards 0-4 in the first column while the
  visible second-column leader was index 6 and remained lazy/auto. An isolated
  four-column proof placed top cards at indices 0/5/10/15. Parser-time hints
  therefore consume bandwidth on below-fold cards and can miss the actual LCP.
- Disposition: schedule this cycle. Remove the invalid first-N inference on all
  affected masonry surfaces and keep explicit high/eager/preload ownership to
  the universally visible first card unless layout placement becomes
  deterministic. Lock the layout/scheduling boundary with browser geometry.

### C3-03 — Expanded mobile navigation skips newly revealed links in keyboard order

- Severity/Confidence: **Medium / High**
- Agreement: designer, with direct keyboard/accessibility evidence
- Regions: `apps/web/src/components/nav-client.tsx:112-216`;
  incomplete source contract at
  `apps/web/src/__tests__/client-source-contracts.test.ts:64`
- Failure: topic links precede controls and the menu toggle in DOM order. After
  activating **Expand menu**, focus remains on the now **Collapse menu** toggle;
  the next Tab goes directly to the main tag-filter summary, skipping the
  newly visible topic links. Escape does not collapse. Keyboard users must
  reverse-tab through unrelated controls to reach the content they revealed.
- Disposition: schedule this cycle. Restore logical disclosure focus order,
  support Escape collapse/focus restoration, and add mobile browser coverage
  for open, Tab/Shift+Tab, and Escape.

### C3-04 — Responsive image work claims a browser regression that was never committed

- Severity/Confidence: **Medium / High**
- Agreement: code-reviewer, architect, debugger, tracer, critic, verifier,
  test-engineer, and document-specialist
- Regions: `.context/plans/cycle-2-2026-07-18-plan.md:29-32,64-78`;
  `apps/web/src/__tests__/masonry-card-memo.test.ts:115-123`;
  `apps/web/e2e/public.spec.ts:21-50`
- Failure: Cycle 2 checks off mobile/desktop request-timeline coverage, but its
  only preload regression reads source text and checks literals. The Playwright
  change covers combobox state, not resource hints, requests, or geometry. The
  exact C3-02 wrong-identity behavior stays green, and later framework/media
  regressions could do the same.
- Disposition: schedule this cycle together with C3-02. Correct the Cycle 2
  evidence and commit browser coverage that crosses emitted hints/priority into
  actual responsive geometry rather than asserting final source strings.

### C3-05 — Cycle 2 remains documented as active and unreleased after release

- Severity/Confidence: **Low / High**
- Agreement: critic, verifier, document-specialist; corroborated by git and
  live production state
- Regions: `.context/plans/cycle-2-2026-07-18-plan.md:5,45-48,79-80`;
  `.context/plans/README.md:34-38`
- Failure: the plan says signed push/deploy remain pending and the index lists
  Cycle 2 as active, while `master == origin/master`, all five implementation
  commits have good GPG signatures, and production exposes the shipped search
  and responsive-preload behavior. Recovery work can resume from a false
  frontier or repeat terminal actions.
- Disposition: schedule this cycle. Record the signed release frontier and
  production evidence, mark the prior plan complete, and archive it when the
  Cycle 3 plan becomes active.

## Revalidated carry-forward findings

These are not newly discovered and retain their original severity/confidence,
reasons, and exit criteria in `.context/plans/deferred-carry-forward.md`:

- shared queue/backfill DB-budget oversubscription (High / High);
- warn-only single-writer enforcement and process-local coordination
  (High / High in the security lane; documented single-instance boundary);
- failed deploy health recovery/rollback (Medium / High);
- SQL-restore/file-store generation mismatch (Medium / High);
- 10,000-row map rendering and repeated semantic vector scans
  (Medium / High);
- existing authenticated-admin, browser-matrix, zoom, and broad test-infra
  validation items.

No security, correctness, or data-loss finding is newly deferred by this
review. Prompt 2 must preserve all carry-forward policy and exit criteria.

## Baseline evidence and final aggregation sweep

Review lanes reported green ESLint, API-auth/action-origin/public-route
scanners, typecheck, production build, production dependency audit, and full
Vitest (361 files passed, 2 skipped; 3,410 tests passed, 4 expected CLIP skips).
The built sitemap remains dynamic and absent from the prerender manifest. The
designer revalidated search combobox ownership and exposed C3-01/C3-03 through
live interaction rather than screenshots alone.

The final aggregation sweep merged the CSS-column finding at Medium/High across
six reviewers, promoted the missing-browser-proof finding to Medium/High based
on eight-agent agreement and its role in allowing C3-02, preserved the mobile
tag disclosure at its original High/High classification, retained the nav focus
issue at Medium/High, and kept ledger drift at Low/High. Every new provenance
finding is scheduled above; every surviving non-new issue maps to the existing
carry-forward register. There are no agent failures.
