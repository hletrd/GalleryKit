# GalleryKit Product Marketer Reviewer - Cycle 9

Date: 2026-07-07
Reviewed workspace: `/Users/hletrd/flash-shared/gallery`
Lane: product-marketer-reviewer
Prompt: PROMPT 1 deep review from product messaging, user-facing copy, information scent, positioning consistency, docs/readme communication, onboarding, and photographer/operator expectations.

The local reviewer prompt at `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` was used for its evidence-first product review posture. Its BurstPick-specific product assumptions were not applied to GalleryKit.

## Scope And Inventory

I built the review inventory before filing findings.

- Control docs read: `AGENTS.md`, `CLAUDE.md`.
- Product docs read: `README.md`, `apps/web/README.md`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`.
- README inventory checked from tracked files: `README.md`, `apps/web/README.md`, `apps/web/__test_fixtures__/color/README.md`, `.context/plans/README.md`, `.context/plans/photographer-r22/README.md`.
- Localized copy read: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Public UI/source reviewed: localized public home/topic/photo/share/group-share/smart-collection/map/timeline/year/privacy/about pages under `apps/web/src/app/[locale]/(public)/`, public metadata/manifest/robots/sitemap/feed/OG routes, and public components including `search.tsx`, `similar-photos.tsx`, `photo-viewer.tsx`, `footer.tsx`, `nav.tsx`, `map/*`, `masonry-card.tsx`, and `wide-gamut-hint.tsx`.
- Admin/operator UI/source reviewed: admin login, dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics, protected shell, and admin nav under `apps/web/src/app/[locale]/admin/` plus `apps/web/src/components/admin-*`, `image-manager.tsx`, `upload-dropzone.tsx`, `bulk-edit-dialog.tsx`, and related server actions.
- Product-claim source truth reviewed: semantic search routes/config/model/backfill, similar-photo route/UI, upload-token route/actions, DB backup/restore actions, analytics data/view tracking, SEO/OG data, privacy-sensitive data guards, smart-collection parser/data/routes/actions, storage abstraction, deploy scripts, and site config.

The review was repository-wide for files relevant to product promise, user-facing copy, operator guidance, onboarding, SEO/OG, i18n, and support expectations. Generated/vendor outputs (`node_modules`, `.next`, `.git`, `.claude/worktrees`) were not treated as live product surfaces.

## Findings

### PMR-C9-01 - Smart-collection delete guidance points admins to a nonexistent remediation path

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- `CLAUDE.md:162` says smart collections have a public read route and hardened server actions, but "no admin UI or API surface invokes them yet"; rows are currently authored by direct DB insert and the docs warn not to document authoring as an operable admin feature.
- `apps/web/src/app/actions/topics.ts:461-470` scans every `smart_collections.query_json` row while deleting a category and throws `TopicReferencedBySmartCollectionError` when a smart-collection predicate references the category slug.
- `apps/web/src/app/actions/topics.ts:508-514` maps that exception to `t('cannotDeleteCategoryReferencedByCollection')`.
- `apps/web/messages/en.json:505-506` tells admins: "Remove this category from smart collections before deleting it."
- `apps/web/messages/ko.json:505-506` tells Korean admins: "이 카테고리를 참조하는 스마트 컬렉션을 먼저 수정해 주세요."
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:127-138` displays the returned error directly as a toast; there is no additional remediation link or operator context.
- `apps/web/src/components/admin-nav.tsx:15-25` exposes Dashboard, Categories, Tags, SEO, Settings, Tokens, Password, Users, DB, and Analytics, but no Collections entry.
- `apps/web/src/app/[locale]/admin/(protected)/` contains no collections page.

Why this is a product/support issue:

The copy describes an in-product task ("remove this category from smart collections" / "modify the smart collection") as if the admin can complete it from the dashboard. The product currently does not expose a smart-collection authoring or editing surface, and the only supported authoring path documented in the repo is direct DB insertion. This violates information scent at the exact moment an operator is blocked from deleting a category.

Concrete failure scenario:

An operator previously seeded a smart collection via DB, later opens Admin -> Categories, and tries to delete an empty category. The deletion fails with a toast telling them to remove the category from smart collections. They search the admin UI for "Collections" and find no route, no nav item, no query editor, and no collection identifier. The support path becomes "read source/docs or inspect MySQL manually" even though the user-facing message implied an ordinary dashboard workflow.

Suggested fix:

Change the localized error to be explicit about the current operator path until a Collections UI ships. For example:

- English: `This category is referenced by a smart collection that is not editable in the admin UI yet. Update or remove the matching smart_collections query_json row before deleting it.`
- Korean: `이 카테고리는 아직 관리자 화면에서 편집할 수 없는 스마트 컬렉션에서 참조하고 있습니다. 삭제하려면 smart_collections의 해당 query_json을 먼저 수정하거나 제거하세요.`

If feasible, include the blocking collection id/name/count in the server action result so the toast can point the operator at the exact row. A broader product fix is to ship a Collections admin surface and then update the copy to link there.

## Non-Findings Verified During Final Sweep

- Finished-photo positioning is consistent: `README.md` and in-app About copy avoid editor/culling/scoring/proofing/payment promises.
- Semantic search copy is appropriately gated: root/app READMEs, settings copy, `search.tsx`, semantic/similar routes, and `gallery-config.ts` align on disabled-by-default, stub-vs-production honesty, env opt-in, model weights, and backfill requirements.
- The historical CLIP spec/plan under `docs/superpowers/` is clearly labeled as historical and points readers back to `CLAUDE.md` and `apps/web/README.md` for live runbooks.
- Upload-token copy does not overclaim a bundled Lightroom Classic plugin; docs and UI describe a PAT-authenticated upload API.
- DB backup/restore copy correctly says SQL rows only and calls out missing original files, derivatives, and resources.
- SEO/OG copy and source align on runtime DB-editable fields versus build-time `site-config.json` fields.
- Privacy copy covers processed derivatives, optional Google Analytics, local analytics, IP rate-limit buckets, public map tile requests, and GPS visibility in a way that matches reviewed source.
- No supported S3/MinIO, hosted SaaS, payment, proofing, or full offline-gallery-sync promise was found in live user/operator docs.

## Verification Notes

No application code was changed. This review artifact is the only intended file modification.

Validation performed:

- Read control docs, product docs, localized messages, public/admin UI copy, and product-claim source paths listed above.
- Cross-checked the finding against source behavior, i18n strings, admin navigation, and the documented smart-collection product boundary.
- Final sweep specifically checked semantic search, similar photos, upload API tokens, DB backups, SEO/OG, privacy/analytics, storage claims, and no-edit/no-culling positioning for additional substantiated product communication defects.
