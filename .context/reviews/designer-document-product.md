# Cycle 25 Designer / Document / Product Review

Date: 2026-07-08 KST  
Repository: `/Users/hletrd/flash-shared/gallery`  
Review HEAD: `7c0c4db8` (`docs(review): 📝 add cycle 25 perf debugger tracer review`)  
Lane: designer, document-specialist, product-marketer-reviewer, ui-ux-designer-reviewer. Review-only for product code; this report is the only intended write.

## Inventory

Control docs and prompts read first:

- AGENTS instructions from the prompt, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Local review prompts in `.context/reviews/prompts/common_review_scope.md`, `designer.md`, and `document-specialist.md`.
- Recent review context: `.context/reviews/product-marketer-reviewer.md`, `.context/reviews/designer-ui-ux-reviewer.md`, `.context/reviews/document-specialist.md`, `.context/reviews/ui-ux-designer-reviewer.md`, and `.context/reviews/_aggregate.md`.

Relevant app/docs files inventoried and examined:

- Public routes: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `[topic]/layout.tsx`, `p/[id]/page.tsx`, `map/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `about-gallerykit/page.tsx`, `privacy/page.tsx`, share routes, loading/error/not-found shells.
- Public components: `nav-client.tsx`, `footer.tsx`, `home-client.tsx`, `tag-filter.tsx`, `masonry-card.tsx`, `search.tsx`, `photo-viewer.tsx`, `info-bottom-sheet.tsx`, `similar-photos.tsx`, `lightbox.tsx`, `color-details-section.tsx`, `wide-gamut-hint.tsx`, map components, loading/empty/error components.
- Admin UI: login, admin header/nav, dashboard/image manager, categories, tags, SEO, settings, DB, tokens, users, password, analytics.
- Design/i18n/system surfaces: `globals.css`, shadcn UI primitives, `messages/en.json`, `messages/ko.json`, locale direction helpers, site config, site-config validation, README files.

## Runtime and Validation Evidence

- Local dev server attempt: `npm run dev --workspace=apps/web` could not start because Next reported a stale dev-server lock for PID `7042`; `ps -p 7042` showed no process and `lsof`/`curl` showed nothing listening on port 3000. I did not kill/remove anything under the destructive-action rule.
- `agent-browser` live read-only checks on `https://gallery.atik.kr`:
  - Mobile `/en` at 390x844 exposed skip link, named main navigation, icon search/theme/locale controls, collapsed tag disclosure, H1 "Latest", photo links, Load more, and footer links for GalleryKit, Timeline, Map, Privacy, GitHub, Admin.
  - Search dialog snapshot exposed a named dialog, labelled combobox, Close button, semantic-search switch, and production-mode newest-embeddings warning.
  - Mobile `/en/p/348` exposed H1, Back to TWS, fullscreen, Info, Next photo, named zoom button, and footer.
  - Dark media `/en/privacy` exposed H1 and H2 sections for Analytics, Photo Metadata, and Map Tiles.
  - `/en/admin` exposed labelled username/password fields, show-password button, and Sign in.
- Targeted tests passed: `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/password-form-a11y.test.ts src/__tests__/search-disclaimer.test.ts src/__tests__/semantic-search-settings-ui.test.ts src/__tests__/theme-token-contract.test.ts src/__tests__/i18n-key-parity.test.ts` -> 7 files, 43 tests passed.

## Confirmed Issues

### C25-DP-01 - Category, tag, and SEO save failures still rely on transient toasts instead of persistent form errors

Severity: Medium  
Confidence: High  
Perspectives: UI/UX, WCAG 2.2 status/error identification, admin form validation UX

Evidence:

- Category create/update errors call `toast.error(...)` only at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:91-125`.
- Category create inputs are labelled and constrained, but have no error state, `aria-invalid`, field-level `aria-describedby`, persistent `role="alert"`, or focus recovery at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:205-223`.
- Category edit repeats the same shape at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:363-383`; alias errors are also toast-only at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:152-178`.
- Tag update errors call `toast.error(...)` only at `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:53-67`, while the edit form at `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:169-182` has no persistent invalid state.
- SEO save errors are toast-only at `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-70`, while the fields at `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:98-162` expose help text but not returned validation errors.
- Stronger local patterns already exist: login uses focused client validation, `aria-invalid`, `aria-describedby`, and `role="alert"` at `apps/web/src/app/[locale]/admin/login-form.tsx:31-45` and `apps/web/src/app/[locale]/admin/login-form.tsx:65-129`; settings/tokens/image edit also keep field errors (`settings-client.tsx`, `tokens-client.tsx`, `image-manager.tsx` per the grep sweep).

Failure scenario:

An admin submits a duplicate category slug, invalid alias, duplicate tag name, or invalid SEO locale/URL. A toast appears briefly, focus stays on the submit/control path, and a screen-reader or keyboard user has no durable field-level recovery target after the toast disappears.

Suggested fix:

Promote these forms to the existing login/settings pattern: keep local `formError`/`fieldErrors`, render persistent inline `role="alert"` messages inside the dialog/card, wire `aria-invalid` plus error/help IDs, focus the first invalid field or alert after rejected submission, and keep toast as secondary feedback only.

### C25-DP-02 - The committed Atik deployment config can still pass as a fresh install's canonical brand

Severity: Medium  
Confidence: High  
Perspectives: product-marketing truthfulness, documentation-code mismatch, self-hosting trust

Evidence:

- The tracked app config contains deployment-specific values: `Atik Gallery`, `https://gallery.atik.kr`, `Atik`, and `Atik Gallery` footer/nav fallback at `apps/web/src/site-config.json:2-10`.
- The generic template is separate and still placeholder-based at `apps/web/src/site-config.example.json:2-11`.
- Production validation only rejects missing, malformed, localhost, and example hosts; it accepts any real non-placeholder URL, including the committed Atik host, at `apps/web/scripts/ensure-site-config.mjs:11-42`.
- The root README tells operators to copy the example over `apps/web/src/site-config.json` at `README.md:118-122`, but the destination already exists in a fresh clone. The docs also correctly warn that JSON imports are build-time inlined and become production metadata at `README.md:60-77`, `README.md:171-172`, and `README.md:198-200`.
- The app README repeats the copy/edit instruction at `apps/web/README.md:15-20` and the build-time warning at `apps/web/README.md:48-50`.

Failure scenario:

A self-hosting operator clones the repository, configures `.env.local`, skips the site-config copy step because `site-config.json` already exists, and builds without `BASE_URL`. The production guard passes because `gallery.atik.kr` is real. Sitemap, metadata, footer, OpenGraph fallback, and site title can ship as Atik's deployment, undermining the self-hosted/fresh-install positioning.

Suggested fix:

Track only `site-config.example.json` and ignore the real `site-config.json`, or replace the tracked config with a production-rejected placeholder. If the Atik config must remain for this deployment, add an explicit denylist/allowlist gate so `gallery.atik.kr` cannot be accepted as an accidental fallback when `BASE_URL` is unset. Add a source test around `ensure-site-config.mjs`.

### C25-DP-03 - Production semantic search is visible only after an icon-only search affordance is opened on mobile/tablet

Severity: Low-Medium  
Confidence: High  
Perspectives: product discovery, IA/affordance clarity

Evidence:

- Semantic search and similar photos are positioned as differentiators in `README.md:50` and `apps/web/README.md:67-73`.
- The public nav mounts `<Search>` next to theme/locale controls at `apps/web/src/components/nav-client.tsx:145-151`.
- The closed search trigger only renders a visible text label when `semanticSearchMode === 'production'`, and even then hides the label below `lg` via `hidden lg:inline` at `apps/web/src/components/search.tsx:380-401`.
- The semantic switch and production warning are only visible after opening the dialog at `apps/web/src/components/search.tsx:536-570`.
- Agent-browser mobile `/en` snapshot showed the closed control as `button "Search photos"` by accessible name, but no visible "Search" or "Semantic search" text in the first-screen nav; the opened dialog did expose `Semantic search` and the newest-embeddings warning.

Failure scenario:

A mobile visitor evaluating the demo or a newly deployed gallery sees a small search icon beside theme/language controls. The feature works and is honestly labelled once opened, but the strongest search capability is not discoverable as a visible option until after the visitor guesses the icon.

Suggested fix:

When `semanticSearchMode === 'production'`, make the mobile/tablet trigger visibly say `Search` or `Search photos`, or add a compact visible hint in the first empty/open state such as "Keyword or semantic search." Keep the existing accessible name and 44 px touch target.

## Verified Fixes / Non-Findings

- Prior map/timeline discoverability issue appears fixed: footer links are present in source at `apps/web/src/components/footer.tsx:41-50`, and the mobile `/en` snapshot exposed Timeline and Map links.
- Prior mobile tag-wall issue appears fixed: mobile `TagFilter` is a collapsed `<details>` by default at `apps/web/src/components/tag-filter.tsx:143-157`, with desktop chips separated at `apps/web/src/components/tag-filter.tsx:158-160`; live mobile snapshot showed only the collapsed "Filter by tag" disclosure before photos.
- Prior similar-photos mobile parity issue appears fixed: `InfoBottomSheet` renders `<SimilarPhotos>` at `apps/web/src/components/info-bottom-sheet.tsx:384-388`, matching the desktop sidebar mount at `apps/web/src/components/photo-viewer.tsx:807-811`.
- Touch targets are source/test-backed: nav controls use min 44 px at `apps/web/src/components/nav-client.tsx:151-184`, map Leaflet controls are forced to 44 px in `apps/web/src/app/[locale]/globals.css:240-258`, and the touch-target audit passed.
- Focus/keyboard fundamentals are source/test-backed: search focus trap/restoration at `apps/web/src/components/search.tsx:349-360` and `apps/web/src/components/search.tsx:426-438`; focus-visible link scan passed.
- Dark/light/OLED contrast tokens are documented in `apps/web/src/app/[locale]/globals.css:14-101`; theme-token tests passed.
- Reduced motion and forced-colors safeguards are present at `apps/web/src/app/[locale]/globals.css:276-323`.
- i18n parity passed for EN/KO. RTL is not currently shipped: `RTL_LOCALES` is empty and `getLocaleDirection()` returns RTL only for a future supported RTL locale at `apps/web/src/lib/locale-path.ts:37-40`.
- Product boundary claims mostly align: no editor/culling/scoring/payment promise in README; semantic search is operator-gated; PWA is not full offline sync; Lightroom is an API compatibility route, not a bundled plugin; HDR public delivery is not claimed as shipped. The main remaining product trust issue is the tracked Atik config above.

## Manual-Validation Risks

- Authenticated admin pages were reviewed by source, not live credentials. Admin runtime clipping for `TagInput` inside horizontal table overflow (`apps/web/src/components/image-manager.tsx:427-503`, `apps/web/src/components/tag-input.tsx:200-250`) remains worth a future authenticated browser check, but I did not file it as confirmed without live layout evidence.
- Live production state was sampled for read-only DOM only; I did not validate deployed DB settings, actual semantic embedding coverage, analytics retention, CDN/SW offline behavior, or physical HDR/P3 output.
- The stale local `.next/dev` log contained repeated React/Next dev warnings around JSON-LD `<script>` tags and `performance.measure` negative timestamps. Current official Next JSON-LD guidance still recommends rendering structured data as `<script type="application/ld+json">` in app router pages, so I did not file that warning as a product bug without a reproducible local server.

## Final Missed-Issue Sweep

Swept IA, nav/footer, search and semantic affordances, photo/mobile parity, map/timeline access, admin nav, admin table/tag editing, form validation, focus/keyboard, WCAG 2.2 touch/status/error paths, reduced motion, forced colors, dark/light/OLED tokens, loading/empty/error copy, EN/KO and RTL readiness, PWA/offline claims, semantic-search honesty, Lightroom/plugin wording, payment/editor/proofing claims, storage/S3 claims, backup/privacy claims, site-config build-time behavior, and prior review carry-forward. No additional distinct issue had enough current evidence to file.
