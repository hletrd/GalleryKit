# Plan 236 — Cycle 4 RPF UI/UX, bounded performance, and copy fixes
Status: complete

## Repo rules read before planning
Same rule set as Plan 235: `CLAUDE.md`, `AGENTS.md`, `.context/**`, `plan/**`; no `.cursorrules` or `CONTRIBUTING.md` present.

## Implementation tasks

### P236-01 — Search accessibility and feedback
- **Findings:** AGG-C4-022/023 (`components/search.tsx:52-76,182-263`) MEDIUM/High.
- **Plan:** Restore visible focus styling and add a polite live region for searching/result-count/error states.
- **Acceptance:** Keyboard focus is visually obvious; screen readers receive status changes.
- **Status:** done

### P236-02 — Admin layout, dialogs, controls, and batch actions
- **Findings:** AGG-C4-024, 026, 055, 056, 058, 059 (`dashboard-client.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `switch.tsx`, `image-manager.tsx`) MEDIUM/High.
- **Plan:** Adjust admin dashboard breakpoint, add dialog max-height scroll guard, localizable close labels/defaults, larger switch/checkbox touch targets, and sticky batch toolbar.
- **Acceptance:** UI remains responsive on tablet/mobile; controls meet practical touch/focus targets.
- **Status:** done

### P236-03 — Login/form/footer/loading/shortcut localization polish
- **Findings:** AGG-C4-025, 028, 053, 054 (`login-form.tsx`, `photo-viewer.tsx`, `p/[id]/page.tsx`, `footer.tsx`) LOW-MEDIUM.
- **Plan:** Add inline login error region, visible shortcut hint, localized photo loading fallback, and translated footer admin label.
- **Acceptance:** Error/loading/navigation text is visible/localized and not toast-only.
- **Status:** done

### P236-04 — TagInput, upload preview, and per-file error UX
- **Findings:** AGG-C4-040, 042, 057 (`upload-dropzone.tsx`, `tag-input.tsx`, `image-manager.tsx`) MEDIUM/High.
- **Plan:** Mirror server file-count/size limits in dropzone, provide per-file upload error/status, add contextual accessible labels to tag inputs, and reduce repeated scanning where feasible.
- **Acceptance:** Over-limit uploads are rejected before preview overload; failed files retain visible reasons; tag editors have row/file context.
- **Status:** done

### P236-05 — Alt text and localized icon route safety
- **Findings:** AGG-C4-060/061 (`home-client.tsx`, `photo-viewer.tsx`, icon routes/topic route) LOW-MEDIUM.
- **Plan:** Use concise title-based thumbnail alt fallback instead of long descriptions/tag dumps, and add localized icon route aliases or guards so favicon/PWA requests do not hit topic DB lookups.
- **Acceptance:** Thumbnail alt text is concise; `/en/icon` and `/en/apple-icon` do not run topic lookup.
- **Status:** done

### P236-06 — Settings copy and write-once affordances
- **Findings:** AGG-C4-019/033/051 (`settings-client.tsx`, messages, SEO copy) MEDIUM/High.
- **Plan:** Show locked/help affordance for write-once image size/GPS settings after images exist, remove/de-emphasize stale storage/concurrency locale copy, and correct OG image helper copy.
- **Acceptance:** Settings copy matches actual controls and constraints.
- **Status:** done

## Gates
Run the full cycle gates after implementation: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test`, `npm run test:e2e`.


## Progress / verification
- Completed in cycle 4.
- Gates run green after implementation: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test` (58 files / 341 tests), and `E2E_ENV_FILE=$HOME/.gallerykit-secrets/gallery-web.env.local.cycle4 npm run test:e2e` (20 Playwright tests).
- Local `apps/web/.env.local` was moved outside the repo checkout to `$HOME/.gallerykit-secrets/gallery-web.env.local.cycle4`; no secret values were committed.
