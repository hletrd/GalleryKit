# Verifier Review - review-plan-fix Cycle 5

Date: 2026-06-29
Role: verifier
Scope: current HEAD during cycle 5 review fan-out; no application source edits.

## Inventory Checked

- Deployment/runtime: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, root/app `.dockerignore` files.
- Docs/contracts: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, deploy/nginx/SW/source-contract tests.
- Runtime asset consumers: service-worker registration, histogram worker loading, font CSS, manifest icons, and public asset inventory.

## Findings

### V-C5-01 - Docker runner omits immutable public assets

Severity: High
Confidence: High
Status: Confirmed

Regions:
- `apps/web/Dockerfile:105-120`
- `apps/web/docker-compose.yml:23-27`
- `CLAUDE.md` disk-hygiene contract for immutable public assets

Why this is a problem:
The runner copies standalone output and static chunks, then creates only `apps/web/public/uploads` and `apps/web/public/resources`. It does not copy `apps/web/public`, while compose now bind-mounts only mutable subdirectories. Runtime consumers expect immutable public assets such as `/sw.js`, `/histogram-worker.js`, `/fonts/PretendardVariable.woff2`, and `/icons/*`.

Failure scenario:
After deploy, production requests for the service worker, histogram worker, font, or PWA icons can 404 unless an old broad public mount happens to mask the issue.

Concrete fix:
Copy the built public tree into the runner image, keep `public/uploads` and `public/resources` as runtime bind mounts, and add a Dockerfile/deploy contract test that locks the public copy plus narrow mounts.

### V-C5-02 - Docker build context still admits mutable topic resources

Severity: Medium
Confidence: Medium
Status: Likely

Regions:
- `.dockerignore:16-18`
- `apps/web/.dockerignore:7-8`
- `apps/web/docker-compose.yml:23-27`

Why this is a problem:
The root and app Docker ignore files exclude upload derivatives but not `public/resources`, even though topic cover resources are runtime-generated and bind-mounted at deploy time.

Failure scenario:
Runtime topic-cover files on the deploy host enter the Docker build context and may be baked into intermediate/final artifacts, bloating images and weakening the mutable/immutable storage boundary.

Concrete fix:
Ignore `apps/web/public/resources/**` in the root context and `public/resources/**` in the app context, while preserving `.gitkeep` as a source placeholder.

## Validation Evidence

Passed in verifier lane:
- `npm test --workspace=apps/web -- deploy-script-contract.test.ts nginx-config.test.ts next-config-uploads-headers.test.ts sw-template-contract.test.ts`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run lint --workspace=apps/web`

Not run in verifier lane:
- Full `npm run build`; the review was report-only and avoided source/generated artifact mutation.

