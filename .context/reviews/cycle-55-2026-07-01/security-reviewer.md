# Cycle 55 Security Review

Current HEAD reviewed: `4dbbbf9b93fc345dc2979b011d0b6cfb1066b3df` on `master`.

## Inventory Examined

- Auth/session/CSRF: `apps/web/src/lib/session.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/api-auth.ts`
- Admin APIs/PATs: DB backup download, Lightroom upload API, `apps/web/src/lib/admin-tokens.ts`
- Server actions: auth, admin users, images, topics, tags, sharing, settings, SEO, collections, embeddings, LR tokens, DB actions
- Public APIs/actions: semantic search, similar search, OG routes, public load/search/view actions, rate-limit helpers
- Privacy/selects: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, tracked-secrets tests
- Deploy/secrets: `.env.deploy` handling, `.env.local` handling, Dockerfile, compose, deploy scripts, DB backup/restore child-process env handling

Reviewer validation:

- `npm run lint:api-auth --workspace=apps/web` - pass
- `npm run lint:action-origin --workspace=apps/web` - pass
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass
- `npm audit --workspace=apps/web --audit-level=low` - 0 vulnerabilities

## Findings

### C55-02 - Production runtime `.env.local` secrets are not permission-gated

- Severity: Medium
- Confidence: High
- Files: `apps/web/deploy.sh:15`, `apps/web/deploy.sh:32`
- Failure scenario: `apps/web/deploy.sh` only checks that `apps/web/.env.local` exists before passing it to Docker Compose. Unlike `scripts/deploy-remote.sh`, it does not reject group/world-readable secret files. On a multi-user deploy host, shared checkout, backup host, or misconfigured file sync, another local user able to traverse the repo can read DB credentials, `SESSION_SECRET`, admin bootstrap material, and operator flags. `SESSION_SECRET` compromise enables session forgery; DB credential compromise exposes gallery data and plaintext SQL backups.
- Suggested fix: Add the same group/world permission gate used by `scripts/deploy-remote.sh` before the Docker Compose call and document `chmod 600 apps/web/.env.local` in setup docs/examples.

## Final Sweep

No confirmed authz, CSRF, public rate-limit, PAT scope, SQL injection, path traversal, OG SSRF/open redirect, or public privacy-select leak was found in the inspected app surfaces.
