# Document Specialist — Cycle 1 (RPF, end-only deploy mode)

## Doc/Code Mismatch Sweep

### Authoritative repo docs
- `CLAUDE.md` — comprehensive AI assistant context, project overview, tech
  stack, common commands, env vars, key files, schema notes.
- `AGENTS.md` — minimal: 2 rules.
- `.context/reviews/README.md` — review log conventions.

### Mismatches
- `AGENTS.md` is intentionally minimal. Some agentic tools read AGENTS.md
  preferentially over CLAUDE.md and would miss the substantive guidance.
  This is a docs-hygiene observation, not a defect.

### Confirmed alignments
- `CLAUDE.md` describes the i18n setup (en, ko); `messages/en.json` and
  `messages/ko.json` exist and are loaded by `next-intl`.
- `CLAUDE.md` notes `output: 'standalone'` for Docker — confirmed in
  `apps/web/next.config.ts`.
- `CLAUDE.md` notes Node 24+ — `apps/web/package.json` declares
  `"engines": { "node": ">=24" }`.
- `CLAUDE.md` describes the upload flow — verified by reading
  `apps/web/src/app/actions/images.ts`.

## Conclusion
No doc/code drift detected. Minor docs-hygiene observation about AGENTS.md
recorded under architect findings.
