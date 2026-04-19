# Aggregate Review — Cycle 1 UI/UX + reliability focus

Sources merged:
- `code-reviewer.md`
- `security-reviewer.md`
- `critic.md`
- `verifier.md`
- `test-engineer.md`
- `architect.md`
- `debugger.md`
- `designer.md`
- local browser/code inspection by the orchestrator

## AGENT FAILURES
- None.

## Dedupe policy
Overlapping findings were merged below with the highest severity/confidence preserved and cross-agent agreement noted when applicable.

## Merged findings

### 1) [HIGH] Production CSP blocks Next runtime hydration on the live site
- **Evidence:** `apps/web/next.config.ts:51-74`; live review in `designer.md`
- **Cross-agent agreement:** designer + orchestrator browser check
- **Why it matters:** the public site can stay on a loading spinner instead of rendering the gallery UI.
- **Suggested fix:** remove `strict-dynamic` unless nonces/hashes are wired end-to-end, and keep the production `script-src` compatible with Next’s runtime chunks.

### 2) [HIGH] Search modal is not keyboard-safe and the combobox lacks a real label
- **Evidence:** `apps/web/src/components/search.tsx:83-148`; live review in `designer.md`
- **Cross-agent agreement:** designer + orchestrator code inspection
- **Why it matters:** focus does not reliably enter the dialog, Tab can escape behind the overlay, and screen-reader users get an unlabeled combobox.
- **Suggested fix:** make the input the initial focus target, keep focus trapped in the dialog, restore focus on close, and add a programmatic label.

### 3) [HIGH] Several pages use nested interactive elements (`<a><button>…</button></a>`)
- **Evidence:**
  - `apps/web/src/components/photo-viewer.tsx:208-214`
  - `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:87-92`
  - `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:149-154`
  - `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:40-59`
- **Cross-agent agreement:** orchestrator code inspection; consistent with UI/UX review goals
- **Why it matters:** invalid interactive nesting is an accessibility and keyboard-navigation bug and can produce inconsistent click/focus behavior.
- **Suggested fix:** convert these to `Button asChild` / anchor-first composition.

### 4) [HIGH] Admin batch-tag dialog is effectively unusable because open-state and pending-state are conflated
- **Evidence:** `apps/web/src/components/image-manager.tsx:145-180, 193-221`; confirmed by `code-reviewer.md`
- **Cross-agent agreement:** code-reviewer + orchestrator code inspection
- **Why it matters:** opening the dialog immediately sets the same flag used to disable the confirm action, so the action can appear stuck/loading before submission.
- **Suggested fix:** split dialog-open state from submit-pending state.

### 5) [MEDIUM] Tag filter chips are implemented as focusable spans with `role="button"` instead of real buttons
- **Evidence:** `apps/web/src/components/tag-filter.tsx:35-62`
- **Cross-agent agreement:** orchestrator code inspection
- **Why it matters:** semantics, focus behavior, and assistive-technology support are weaker than native button controls.
- **Suggested fix:** render chips as actual buttons via `Badge asChild` or a button-styled primitive.

### 6) [MEDIUM] Theme bootstrapping ignores system light preference on first load
- **Evidence:** `apps/web/src/app/[locale]/layout.tsx:69-76`; `designer.md`
- **Cross-agent agreement:** designer + orchestrator code inspection
- **Why it matters:** visitors with light mode preference can get a surprising dark-first experience.
- **Suggested fix:** use `defaultTheme="system"` if system preference should win.

### 7) [HIGH] Playwright E2E gates are brittle and currently fail in the default local environment
- **Evidence:** `test-engineer.md`; local execution of `npm run test:e2e --workspace=apps/web` on April 19, 2026
- **Cross-agent agreement:** test-engineer + orchestrator gate run
- **Why it matters:** the gate currently depends on a local MySQL instance and uses a `next start` path that conflicts with standalone output. Admin tests fail before meaningful UI verification happens.
- **Suggested fix:**
  - use a standalone-compatible web server command,
  - make DB-dependent/admin E2E tests explicitly opt-in,
  - keep public smoke coverage runnable in the default environment,
  - remove brittle seed/id assumptions where practical.

### 8) [HIGH] Non-UI correctness/security follow-ups remain open and must be tracked explicitly
- **Evidence:** `verifier.md`, `debugger.md`, `critic.md`, `security-reviewer.md`, `architect.md`
- **Representative items:** SQL restore scanner gaps, locale/topic route collisions, upload quota rollback/orphan cleanup, public/admin read-model conflation, process-local rate limits/state.
- **Cross-agent agreement:** multiple reviewers
- **Why it matters:** these are real risks, but they are broader than this UI/UX-focused cycle.
- **Suggested fix:** defer them explicitly with severity preserved and clear exit criteria.
