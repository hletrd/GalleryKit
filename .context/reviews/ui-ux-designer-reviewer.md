# UI/UX Designer Reviewer - Cycle 18

Role surface: `ui-ux-designer-reviewer`, adapted from the stale BurstPick-oriented global prompt to GalleryKit's Next.js web UI.

## Inventory

Reviewed `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, newest available plan/deferred pointers, root/app READMEs, current source, EN/KO messages, PWA files, tests, and prior UI/product review artifacts.

Relevant surfaces inventoried:

- Public visitor IA: home, topic galleries, photo viewer, lightbox, similar photos, search, map, timeline/year pages, shared links, smart collection read route, about/privacy, footer/nav.
- Admin IA: login, dashboard upload/image manager, taxonomy, SEO/settings, upload tokens, password/users, DB backup/restore, analytics, admin shell.
- Accessibility/interaction: Radix/shadcn dialogs/selects/sheets, focus restoration helpers, skip links, touch-target audit patterns, reduced-motion CSS, theme tokens, i18n routing.
- Performance/perceived performance: masonry placement, image sizing, `content-visibility`/hover transforms, loading/error/empty states, service worker/offline fallback.

Agent-browser requirement: used core/config/query/wait/debug-style commands where feasible. Local dev was blocked by an existing Next lock (`PID 7042`) while port 3000 refused connections, so I did not kill/delete anything. `next start` on port 3001 was reachable but `/en` returned HTTP 500 due local DB/config; `/ko/admin` rendered and agent-browser measured controls. Playwright was used as a read-only fallback for live DOM metrics after agent-browser became unresponsive; evidence below is DOM/box/source based, not screenshot-only.

## Confirmed Issues

### UIUX-C18-01 - Mobile gallery hierarchy delays the first photo behind a tag wall

Severity: Medium
Confidence: High
Exact file/region: `apps/web/src/components/home-client.tsx:287-330`; `apps/web/src/components/tag-filter.tsx:63-122`

Why it is a real problem: GalleryKit's public visitor contract is finished-photo browsing. The current mobile hierarchy renders heading/count and all tags before the grid. Since every tag is a full 44 px chip, a realistic tag set consumes a large first-viewport block.

Evidence: live DOM probe on `https://gallery.atik.kr/en` at `390x844` returned `tagGroup y=180 h=200`, first photo link `y=412 h=238`, and controls 8-16 as tag chips before control 17, the first `/en/p/348` photo link.

Concrete failure scenario: after a photographer adds many tags, a phone visitor lands on "Latest", count text, and multiple filter rows. The page's first impression becomes administrative filtering rather than photography.

Suggested fix: collapse or defer secondary filters on mobile. Show at most active filters plus a "Filters" affordance above the grid; put the full `TagFilter` in a sheet/disclosure or horizontal overflow rail. Keep the expanded controls keyboard-accessible and 44 px minimum.

### UIUX-C18-02 - Admin image manager is visually and ergonomically table-first

Severity: Medium
Confidence: High
Exact file/region: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`; `apps/web/src/components/image-manager.tsx:427-591`

Why it is a real problem: The admin's core loop is reviewing finished images, fixing metadata, and checking color/GPS state. The table layout makes the photo a small cell and separates it from tags/actions across horizontal columns. This is functional but not ergonomic for repeat photo operations.

Evidence: source shows `overflow-x-auto` table, `h-32 w-32` preview, `min-w-[220px]` tags column, and action buttons at the far-right table cell. Dashboard constrains the manager inside a viewport-height scroll region.

Concrete failure scenario: on a tablet or small laptop, an admin sees the preview and title, then must scroll horizontally to reach tags/actions. While editing several similar images, row context is easy to lose.

Suggested fix: introduce a responsive image-workbench layout for non-wide desktop: card/list rows with larger previews, metadata/action grouping near the image, and inline status chips. Preserve the table as a dense desktop mode.

### UIUX-C18-03 - Admin navigation lacks stable information architecture

Severity: Low-Medium
Confidence: High
Exact file/region: `apps/web/src/components/admin-nav.tsx:15-49`; `apps/web/src/components/admin-header.tsx:13-26`

Why it is a real problem: Publishing, taxonomy, site settings, access control, credentials, DB operations, and analytics all appear as peer links in one wrapping row. Touch targets are acceptable, but the IA does not separate routine workflows from sensitive/operator workflows.

Evidence: `links` contains ten peers and renders `flex flex-wrap`. The header then wraps brand, nav, and logout together, so viewport width and locale length change link placement.

Concrete failure scenario: a Korean admin on a narrow viewport sees "토큰", "비밀번호", "사용자", "DB", and "분석" wrapped among daily publishing pages. Finding the common upload/edit path takes more scanning, and destructive DB operations are visually normalized.

Suggested fix: group navigation into sections and use a mobile/tablet drawer or section selector. Keep Operations/Access visually separated from Publish/Organize.

## Likely Issues

None filed. I checked the previous likely issues and found current fixes:

- Token revoke confirmation now interpolates the token label.
- Alias deletion confirmation now names the alias and category.
- Analytics country display uses `Intl.DisplayNames`.
- Semantic-search Settings copy no longer says the panel enables production search.

## Manual-Validation Risks

### UIUX-C18-RISK-01 - Authenticated admin responsive behavior needs a credentialed browser pass

Severity: Low-Medium
Confidence: Medium
Exact file/region: admin protected pages under `apps/web/src/app/[locale]/admin/(protected)` and `apps/web/src/components/image-manager.tsx`

Why it matters: source strongly indicates table/navigation ergonomics issues, but runtime validation of protected pages needs a seeded local DB and admin credentials.

Failure scenario: a responsive issue in settings, DB restore, or token flows could be missed because local DB-backed pages did not render in this pass.

Suggested validation: run `npm run test:e2e:admin --workspace=apps/web` with local e2e credentials, plus mobile/tablet Playwright snapshots and accessibility snapshots for dashboard, settings, DB, tokens, analytics.

### UIUX-C18-RISK-02 - RTL is structurally signaled but not supported as a product surface

Severity: Low
Confidence: Medium
Exact file/region: `apps/web/src/app/[locale]/layout.tsx` root `dir` handling; physical left/right classes across nav/lightbox/admin components.

Why it matters: only EN/KO ship now, so this is not a live defect. If an RTL locale is added, physical `left/right`, chevron direction, and row/table alignment need a dedicated pass.

Failure scenario: Arabic/Hebrew is added to locale config and `dir="rtl"` changes text flow while controls and icons remain LTR.

Suggested validation/fix: declare RTL unsupported until an RTL Playwright matrix exists, or replace physical positioning with logical utilities and mirrored icons before adding an RTL locale.

## Coverage Map

- Information architecture: UIUX-C18-01, UIUX-C18-03.
- Affordances/admin ergonomics: UIUX-C18-02, UIUX-C18-03.
- Focus/keyboard/touch: admin login measured 44 px; existing source uses skip links and focus-visible rings; no new control-size defect filed.
- WCAG 2.2 contrast/ARIA/focus traps/reduced motion: no confirmed current defect found in this lane; reduced-motion CSS and Radix dialogs are present.
- Responsive breakpoints: UIUX-C18-01, UIUX-C18-02, UIUX-C18-03.
- Loading/empty/error states: local error shell is usable; no new issue filed.
- Forms/validation: prior token/alias/analytics copy defects are fixed.
- Dark/light: live admin login and photo page dark probes had no console/page errors.
- i18n/RTL: EN/KO checked; RTL is a future risk only.
- Perceived performance/LCP/CLS/INP: UIUX-C18-01 is the main perceived-content delay; no CLS/INP claim made without lab metrics.
