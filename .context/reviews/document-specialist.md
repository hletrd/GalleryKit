# Document Specialist Review — Cycle 3

Scope: repository-wide documentation audit focused on README.md, CLAUDE.md, deployment docs, env examples, code comments, and the main configuration/deployment surfaces.

## Inventory Reviewed
- Root docs: `README.md`, `CLAUDE.md`, `.env.deploy.example`, `.env.deploy`, `package.json`
- Web app docs/config: `apps/web/README.md`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `apps/web/src/site-config.json`
- Deployment helper: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`
- Supporting code/comments: `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`

## Confirmed Issues

### DOC-01 — Storage backend docs/strings describe a configurable feature that is not actually wired into the app
**Regions:**
- `apps/web/src/lib/storage/index.ts:1-18, 113-183`
- `apps/web/src/lib/gallery-config-shared.ts:1-44`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:1-10`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:1-120`
- `apps/web/messages/en.json:532-539`
- `apps/web/messages/ko.json:532-539`

**Mismatch:**
The storage module comments and translation strings describe a switchable Local/MinIO/S3 storage backend and say the admin UI can switch backends. In the actual settings surface, there is no storage control at all, and the shared settings key list contains only image-processing and privacy keys. The `switchStorageBackend()` helper exists, but nothing in the app calls it.

**Concrete failure scenario:**
An operator reads the repo-local docs/strings, assumes the gallery can be moved to S3 or MinIO from the admin UI, and prepares deployment around that assumption. In reality, uploads continue to use the filesystem pathing, so the operator can end up with a false sense of storage durability or with dead configuration that never takes effect.

**Suggested fix:**
Either remove/hide the storage-backend documentation/strings until the pipeline is actually wired end-to-end, or connect the admin settings page and upload/serve pipeline to `getStorage()` / `switchStorageBackend()` so the described behavior becomes real.

**Confidence:** High

---

### DOC-02 — Site-config guidance says the file must be provided manually, but build-time fallbacks silently synthesize it from the example
**Regions:**
- `README.md:149-153`
- `apps/web/README.md:27-34`
- `CLAUDE.md:219-227`
- `apps/web/package.json:8-10`
- `apps/web/Dockerfile:35-36`
- `apps/web/deploy.sh:21-23`

**Mismatch:**
The docs treat `apps/web/src/site-config.json` as a required, host-provided file and say the example is only a template. However, both the workspace prebuild hook and the Dockerfile quietly copy `src/site-config.example.json` into place if `src/site-config.json` is missing. That means a missing config does not fail fast during build, even though the deployment guidance implies it should be supplied explicitly.

**Concrete failure scenario:**
A build or container image is produced without a real site config and silently picks up placeholder title/URL/metadata from the example. The deployment appears to work, but sitemap, OG tags, and site branding ship with template values until someone notices.

**Suggested fix:**
Either make the build fail when `src/site-config.json` is missing in production-oriented paths, or explicitly document the fallback as a non-production convenience and warn that it can ship placeholder metadata if left untouched.

**Confidence:** High

## Risks / Missing Operational Guidance

### RISK-01 — Remote deploy helper supports `DEPLOY_REMOTE_SCRIPT`, but the main docs only describe `DEPLOY_CMD`
**Regions:**
- `README.md:95-105`
- `.env.deploy.example:4-12`
- `scripts/deploy-remote.sh:22-43, 57-63`

**Risk:**
The deploy helper has a dedicated `DEPLOY_REMOTE_SCRIPT` knob, but the README only explains `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`, `DEPLOY_PATH`, and `DEPLOY_CMD`. Operators who want to customize the remote script path or wrapper have to discover that variable from the example file or the shell script itself.

**Concrete failure scenario:**
Someone wants to point the helper at a different remote deployment entrypoint, does not realize `DEPLOY_REMOTE_SCRIPT` exists, and instead edits the shell script or bakes the command into `DEPLOY_CMD`. That creates unnecessary drift between the docs and the actual deploy configuration.

**Suggested fix:**
Document `DEPLOY_REMOTE_SCRIPT` in the README and deployment checklist, or remove it if it is not intended to be a supported override.

**Confidence:** Medium

## Final Sweep
I did a last pass for additional high-confidence doc/code mismatches across the deployment, config, and storage surfaces. I did not find any other issues as strong as the three above.
