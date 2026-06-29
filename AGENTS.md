# AGENTS.md — Gallery Workspace Rules

This file is the canonical short-form reference for AI agents and contributors. The detailed knowledge base lives in `CLAUDE.md`.

## Git workflow

- Always commit and push all changes.
- Use **gitmoji** + **Conventional Commits** (`feat(scope): ✨ description`, `fix(scope): 🐛 description`, etc.).
- Always **GPG-sign** commits (`git commit -S`).
- Never add `Co-Authored-By` lines (no Claude attribution).
- Always `git pull --rebase` before `git push`.
- Fine-grained commits: one commit per work item; don't bundle unrelated changes.
- Never `--no-verify` / `--no-gpg-sign` / `--amend` published commits unless the user explicitly asks.

## Deploy

- **`npm run deploy` from repo root** is per-iteration policy. Runs after every commit pushed to `master`. Reads gitignored `.env.deploy`. No staging.
- The deploy host and SSH credentials are config-driven via the gitignored root `.env.deploy` (copy from `.env.deploy.example`); the helper derives the SSH deploy command from it. Do NOT hardcode hostnames or key paths here — keep them in `.env.deploy` (see `CLAUDE.md` "Remote Deploy Helper").
- **`apps/web/deploy.sh` auto-prunes Docker after every deploy** (`container` + `image -af` + `builder -af` + `volume` prune — `volume` WITHOUT `-a`) so the disk-constrained host stays clean. The prune runs AFTER `up -d`, so the live container + its image survive; in-use data is never touched (persistence is bind mounts `./data`, `./public/uploads`, `./public/resources`, read-only `./src/site-config.json`, plus host MySQL; immutable public assets come from the built image). Preserve all three guarantees (prune-after-up, bind-mounted data, no `-a` on the auto `volume prune`) if you change it. See `CLAUDE.md` "Disk hygiene".
- **Never `npm install` inside the running `gallerykit-web` container** — it clobbers prod-deps and crashes the site. For one-off scripts use a `--rm` sidecar from `web-web:latest` with read-only source mounts (see `CLAUDE.md` "Backfill" section).

## Schema

- Migrations live in `apps/web/drizzle/NNNN_*.sql`. To add one, also append to `apps/web/drizzle/meta/_journal.json` with a `when` value **strictly greater** than `Math.max(...current journal whens)`. Drizzle's MySQL migrator silently skips entries whose `when` is below the current `MAX(__drizzle_migrations.created_at)` cursor.
- The post-condition assertion in `apps/web/scripts/migrate.js` fails the deploy if any committed journal entry's hash isn't recorded in `__drizzle_migrations`.
- Mirror the new schema state in `reconcileLegacySchema` in `migrate.js` so a fresh DB without `__drizzle_migrations` rows can baseline cleanly.
- New admin-only column? Add to the `_omit*` block in `apps/web/src/lib/data.ts` AND to the `_PrivacySensitiveKeys` type guard AND to the `SENSITIVE_KEYS` fixture in `apps/web/src/__tests__/privacy-fields.test.ts`.

## Quality gates (all blocking)

- `npm run lint --workspace=apps/web` — ESLint
- `npm run lint:api-auth --workspace=apps/web` — every admin-API export must wrap `withAdminAuth(...)`
- `npm run lint:action-origin --workspace=apps/web` — every mutating server action must return-early on `requireSameOriginAdmin()` (or carry an explicit `@action-origin-exempt` comment)
- `npm run lint:public-route-rate-limit --workspace=apps/web` — every PUBLIC API route exporting a mutating handler (POST/PUT/PATCH/DELETE) must call a rate-limit pre-increment helper (or carry an explicit `@public-no-rate-limit-required: <reason>` comment); GET handlers are not scanned
- `npm run typecheck --workspace=apps/web` — `typecheck:app` (tsc against `tsconfig.typecheck.json`, which INCLUDES `src/__tests__/`) + `typecheck:scripts`; test-file type errors only surface here, not through the build
- `npm run build --workspace=apps/web` — Next.js + tsc
- `npm test --workspace=apps/web` — Vitest 2000+ unit tests including the touch-target audit (≥ 44 px) and the `_PrivacySensitiveKeys` symmetric privacy guard

## Plans, reviews, conventions

- `.context/reviews/` and `.context/plans/` are committed review/plan history. Keep local-only scratch plans in ignored workspace paths rather than assuming `.context/plans/` is private.
- Photographer-perspective audits: see `.context/reviews/photographer-r{3,4}/` and `cycle{1..8}-rpf-photographer/`.
- Touch targets: 44 px minimum on every interactive element. Enforced by `__tests__/touch-target-audit.test.ts`.
- Color/HDR convention: photos arrive AFTER editing. Deliver photographer's intent accurately. **No edit / culling / scoring features.**

## Read CLAUDE.md for everything else

`CLAUDE.md` carries the full architecture, security model, color & HDR pipeline, **CLIP semantic-search activation / weight-seeding (US-P51 — live in production)**, race-condition protections, migration runbook, operational playbook, and lint-gate / touch-target / Korean i18n details.
