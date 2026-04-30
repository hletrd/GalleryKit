# Plan 319 — Cycle 1 lightbox touch target and metadata hygiene

## Source reviews

- `.context/reviews/_aggregate.md` findings F1 and F2 from review-plan-fix cycle 1/100 on 2026-04-28.

## Repo rules applied

- `AGENTS.md`: always commit and push changes; use gitmoji.
- `CLAUDE.md`: all interactive elements must present a 44x44 px touch target; run lint/typecheck/build/test/e2e and custom auth/origin lint gates.
- `.agent/rules/commit-and-push.md`: commit and push changes with gitmoji.

## Implementation tasks

### F1 — Lightbox touch target

- [x] Update `apps/web/src/components/lightbox.tsx` close and fullscreen controls from `h-10 w-10` to `h-11 w-11`.
- [x] Update `apps/web/src/__tests__/touch-target-audit.test.ts` documentation so the known-violations note accurately states that close/fullscreen controls meet 44 px.
- [ ] Verify with the touch-target audit via `npm run test --workspace=apps/web`.

### F2 — AppleDouble metadata hygiene

- [x] Add `._*` to `.gitignore` next to `.DS_Store`.
- [x] Remove untracked AppleDouble files `apps/web/._data` and `apps/web/public/._uploads` from the worktree.
- [ ] Verify `git status --short` no longer shows AppleDouble files.

## Deferred items

None. No new confirmed review finding is deferred.

## Progress log

- 2026-04-28: Plan created from aggregate review; implementation started in this cycle.
- 2026-04-28: Source changes applied; awaiting full gate verification.
