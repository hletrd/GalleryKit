# Cycle 3 critic review

## Inventory / review surface

I built an inventory first, then inspected the repo across these surfaces:
- product/docs/config: `README.md`, `apps/web/README.md`, `CLAUDE.md`, root/workspace package files, deploy/config files
- runtime/deploy: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/next.config.ts`, nginx config
- public app shell + metadata: localized layouts/pages, `manifest.ts`, `robots.ts`, `sitemap.ts`, `global-error.tsx`
- admin flows: topic/tag/settings/SEO/user/db actions and admin pages/components
- data + processing: `data.ts`, `gallery-config*.ts`, `process-image.ts`, `process-topic-image.ts`, `image-queue.ts`, upload/serve helpers
- auth/security: `session.ts`, `auth.ts`, `rate-limit.ts`, `api-auth.ts`, `proxy.ts`, `sql-restore-scan.ts`
- tests: unit tests and E2E specs

## Verification baseline

- `npm test --workspace=apps/web` ✅ (97 tests passed)
- `npm run lint --workspace=apps/web` ✅
- `npm run build --workspace=apps/web` ✅
- Build still emits repeated production `TRUST_PROXY` warnings when unset; noted, but not counted below as a new finding by itself.

---

## Confirmed issues

### 1) Restore upload ingress limit is materially larger than the action-level restore limit
- **File / code region:**
  - `apps/web/src/app/[locale]/admin/db-actions.ts:224-227, 263-279`
  - `apps/web/next.config.ts:96-100`
  - `apps/web/src/lib/upload-limits.ts:1-22`
- **Why it matters:** `restoreDatabase()` documents that its limit is kept in sync with the framework body-size gate, but it is not. The framework currently accepts server-action bodies up to `NEXT_UPLOAD_BODY_SIZE_LIMIT` (default 2 GiB), while the restore action rejects anything above 250 MiB only after the request has already reached the action.
- **Failure scenario:** an admin uploads a 1–2 GiB SQL dump. Next.js accepts/parses the request because the global server-action limit is 2 GiB; only then does `runRestore()` return `fileTooLarge`. That means the app still pays the network, parsing, and temporary-file cost for a payload the feature claims not to support. The advisory lock also does not help here, because the oversized request has already crossed the ingress boundary before `GET_LOCK` is checked.
- **Suggested fix:** split restore traffic off from the general upload server-action limit. Best options: move restore to a dedicated route with its own stricter body limit, or lower the effective restore ingress limit at the proxy/framework boundary and keep the app-level constant truly aligned. At minimum, fix the misleading comment so future changes do not assume the current protection exists.
- **Confidence:** High

### 2) `updateTopic()` dropped the topic-label length guard that `createTopic()` and the UI still enforce
- **File / code region:**
  - `apps/web/src/app/actions/topics.ts:62-64` (create path has the guard)
  - `apps/web/src/app/actions/topics.ts:117-145` (update path lacks the equivalent guard)
  - `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:167-168, 245-246` (UI still advertises `maxLength={100}`)
- **Why it matters:** the create and update paths no longer enforce the same contract. The UI and create action both imply “topic labels are capped at 100 characters,” but the update action will accept longer server-side payloads.
- **Failure scenario:** a scripted/admin-crafted update submits a 150–255 character label. The edit form allows the request to reach the server, the update path accepts it, and the database now contains labels outside the product’s published limit. That creates inconsistent behavior between create vs. edit, and opens the door to layout and UX regressions that the rest of the codebase assumes the 100-character cap prevents.
- **Suggested fix:** extract shared topic validation (label length, slug rules, reserved segments) and use it in both create and update paths. Add a regression test that proves create and update reject the same overlong label.
- **Confidence:** High

### 3) Topic image processing failures are silently downgraded to “success” in both create and edit flows
- **File / code region:**
  - `apps/web/src/app/actions/topics.ts:66-73`
  - `apps/web/src/app/actions/topics.ts:152-158`
  - `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:59-68, 74-84`
- **Why it matters:** both server actions swallow `processTopicImage()` failures and proceed with the topic mutation. The client only checks `res.error`, so it shows a success toast and refreshes even when the category image failed to process.
- **Failure scenario:** an admin uploads a corrupt or unsupported category image while creating/updating a topic. The topic create/update succeeds, the UI reports `categories.created` / `categories.updated`, but the avatar is missing or unchanged. From the operator’s perspective, the system lies about what succeeded.
- **Suggested fix:** either make topic-image failure fatal for the whole mutation, or return a structured warning (for example `{ success: true, warning: ... }`) and surface it in `TopicManager` so the admin knows the text fields saved but the image did not.
- **Confidence:** High

### 4) The `image_sizes` setting has no operational guardrail on list length, so a single admin misconfiguration can multiply every future upload’s cost
- **File / code region:**
  - `apps/web/src/lib/gallery-config-shared.ts:48-52, 98-101`
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:128-136`
  - `apps/web/src/lib/image-queue.ts:196-216`
  - `apps/web/src/lib/process-image.ts:345-410`
- **Why it matters:** validation only checks that each comma-separated value is a positive number ≤ 10000. It does not cap how many sizes may be configured, dedupe them, or warn about the derivative explosion this setting causes. The queue consumes that list directly for all future uploads, and `processImageFormats()` generates three full derivative sets across the entire list.
- **Failure scenario:** an admin pastes a long list of widths (`320,480,640,768,960,...`) into the settings page. Every future upload now generates 3 × N resized derivative families plus base copies, dramatically increasing queue time, CPU, storage growth, and failure blast radius. The app has no inline warning, no server-side count cap, and no test coverage around this misconfiguration path.
- **Suggested fix:** enforce a bounded, unique, sorted size list server-side (for example max 4–8 sizes), reject pathological configs, and reflect the constraint in the settings UI. If large/custom lists are intentionally supported, add an explicit warning showing the derivative multiplier before save.
- **Confidence:** High

---

## Risks / carry-forward concerns

### R1) `image_sizes` is still treated as a live runtime toggle even though existing derivatives are immutable build artifacts
- **File / code region:**
  - `apps/web/src/app/actions/settings.ts:35-86`
  - `apps/web/src/lib/gallery-config.ts:68-72`
  - `apps/web/src/app/[locale]/(public)/page.tsx:29-31, 47-53`
  - `apps/web/src/components/photo-viewer.tsx:200-223`
  - `apps/web/src/lib/image-queue.ts:196-216`
- **Why it matters:** saving `image_sizes` revalidates the app immediately, and the public readers/metadata start requesting the new sizes immediately, but only future uploads are guaranteed to generate them. There is still no migration/backfill/compatibility story for the already-processed corpus.
- **Failure scenario:** an operator changes `image_sizes` in production to a new set. Existing photos still only have the old derivatives on disk, while viewers, metadata, and OG surfaces begin requesting the new filenames. Result: broken thumbnails/OG images or partial 404s across older content.
- **Suggested fix:** treat `image_sizes` as a migration-governed setting rather than a live toggle: either lock it after first production use, add a backfill job, or serve legacy-size fallbacks until regeneration completes.
- **Confidence:** High

### R2) Branding/config still has more than one live source of truth
- **File / code region:**
  - `apps/web/src/app/[locale]/layout.tsx:15-40`
  - `apps/web/src/components/nav.tsx:5-10`
  - `apps/web/src/app/global-error.tsx:45-52`
- **Why it matters:** normal runtime metadata and nav branding now come from `getSeoSettings()`, but the fatal global error surface still renders from static `site-config.json`. That means the repo is still split between DB-backed branding and file-backed branding depending on code path.
- **Failure scenario:** an admin rebrands the gallery in the SEO screen and sees the new name across normal pages, but any fatal app-level failure still shows the old brand string from `site-config.json`. This is not a security issue, but it is a product-trust and maintainability inconsistency.
- **Suggested fix:** either unify the global error brand source with the runtime SEO accessor, or explicitly document that the fatal fallback shell is intentionally deploy-time/file-backed.
- **Confidence:** Medium

---

## Final missed-issues sweep

I did one last targeted sweep over branding/config/runtime mismatches (`siteConfig` vs `getSeoSettings`), body-size/restore limits, topic mutation validation symmetry, and settings-driven image-size behavior. After that pass, I did **not** find additional higher-signal confirmed issues beyond the items above.
