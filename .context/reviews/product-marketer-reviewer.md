# Product Marketer Reviewer - Cycle 23 Deep Review

Reviewer surface: globally registered `product-marketer-reviewer`.

Important routing note: the installed prompt body is BurstPick-specific. I treated that as a prompt mismatch, ignored non-existent BurstPick paths/requirements, and reviewed the current GalleryKit repository surfaces instead.

## Scope Reviewed

- Project operating docs: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`.
- Product and operator claims around gallery publishing, color/HDR, semantic search, sharing, admin, privacy, deployment, demo, and Lightroom-token upload API.
- User-facing/admin copy in `apps/web/messages/en.json` and `apps/web/messages/ko.json`.
- Public/admin implementation touchpoints: semantic search routes/components, similar-photo UI, settings UI, token UI/API, GA loading, color/HDR display capability, caption stub, privacy/map data selectors.

## Findings

### PMR-23-01 - Color positioning overstates cross-browser delivery guarantees

- Severity: Medium
- Confidence: High
- Risk type: Confirmed implementation/documentation mismatch risk
- Evidence:
  - `README.md:8` claims GalleryKit publishes photography with "accurate color".
  - `README.md:31` says "color-faithful delivery".
  - `README.md:38` markets "Photographer-grade color management" with P3 / Adobe RGB / ProPhoto / Rec.2020 mapping.
  - `CLAUDE.md:270` states the product premise is to deliver gamut, tonality, and dynamic range "accurately to every viewer's display, on every supported browser."
  - `apps/web/src/lib/use-display-capability.ts:64-69` explicitly treats Firefox as effectively `srgb` because Firefox does not implement wide-gamut rendering.
  - `CLAUDE.md:297-301` says HDR ingest is rejected by default, accepted HDR is delivered through an SDR-only pipeline, and public HDR badges are hidden until real HDR delivery ships.
  - `apps/web/src/components/wide-gamut-hint.tsx:152-166` correctly limits delivered wide-gamut framing to Display P3 even when source gamut is wider.
- Failure scenario: A photographer reads the README/CLAUDE positioning and expects GalleryKit to preserve "photographer intent" for wide-gamut and HDR across all supported browsers. Firefox visitors and HDR-source uploads then receive SDR/sRGB-constrained behavior that is documented in implementation comments and admin copy, but not made prominent in the product positioning.
- Concrete fix: Reword top-level product claims to "browser-managed, best-effort color-faithful delivery" and explicitly call out: Display P3 is the delivery ceiling for wide-gamut derivatives, Firefox is treated as sRGB, and HDR ingest currently delivers SDR derivatives. Keep the detailed matrix in `CLAUDE.md`, but make the README feature bullet carry the caveat instead of only linking to the matrix.

### PMR-23-02 - Similar-photos marketing is accurate only for operator-enabled production mode

- Severity: Low
- Confidence: High
- Risk type: Confirmed expectation mismatch risk
- Evidence:
  - `README.md:42` advertises semantic search in English/Korean plus `"similar photos"` as one combined feature, then says it is disabled by default and operator-enabled.
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:771-778` exposes only `disabled` and `stub` in the admin settings UI; production is intentionally not selectable.
  - `apps/web/src/components/similar-photos.tsx:47-52` documents that `/api/search/similar/[id]` serves only in production mode and that the control is hidden otherwise.
  - `apps/web/src/components/similar-photos.tsx:94-97` returns `null` unless `semanticSearchMode === 'production'`.
  - `apps/web/src/app/api/search/similar/[id]/route.ts:14-16` states the production-only gate because stub vectors make "similar" meaningless.
  - `apps/web/src/app/api/search/similar/[id]/route.ts:121-125` returns 503 outside production mode.
- Failure scenario: An admin enables the only UI-reachable semantic test mode, sees text-search wiring, and expects the README's "similar photos" claim to appear as part of that setup. The image-to-image surface never appears until an operator sets the DB row, env opt-in, model weights, and backfill outside the admin UI.
- Concrete fix: Add one sentence to the README semantic-search bullet and settings copy: "Text search has a stub wiring mode; similar photos appears only when production semantic search is operator-enabled and embeddings are backfilled." This keeps the claim true while preventing admins from treating stub mode as a full semantic-search preview.

### PMR-23-03 - Lightroom token scopes imply read/delete capabilities that are not shipped routes

- Severity: Low
- Confidence: High
- Risk type: Confirmed API positioning risk
- Evidence:
  - `CLAUDE.md:159` describes `admin_tokens` as "Lightroom-compatible publish API PATs" and says `AdminTokenScope = 'lr:upload' | 'lr:read' | 'lr:delete'`.
  - `apps/web/src/lib/admin-tokens.ts:1-3` says tokens are for integrations such as the Lightroom Classic publish plugin.
  - `apps/web/src/lib/admin-tokens.ts:24-25` defines and exports all three scopes.
  - API inventory under `apps/web/src/app/api/admin` currently has only `db/download/route.ts` and `lr/upload/route.ts`; no `lr/read` or `lr/delete` route exists.
  - `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:59-62` creates tokens with only `lr:upload`.
  - `README.md:45` and `README.md:205-214` correctly say the shipped surface is a PAT-authenticated upload API and no bundled Lightroom Classic plugin.
- Failure scenario: An integrator or operator reads the scope set in `CLAUDE.md`/source comments and assumes GalleryKit supports a fuller Lightroom publish lifecycle, including read/delete sync. They design an external client around capabilities that are reserved in code but absent from shipped API routes and UI.
- Concrete fix: In product/operator docs, say "only `lr:upload` is currently shipped; `lr:read` and `lr:delete` are reserved/internal until matching routes exist." Consider narrowing `ALL_SCOPES` to shipped scopes or moving future scopes behind comments that cannot be mistaken for supported API surface.

### PMR-23-04 - README analytics sample can accidentally enable a placeholder GA tag

- Severity: Low
- Confidence: High
- Risk type: Confirmed operator-copy risk
- Evidence:
  - `README.md:29` says local view analytics are first-party/self-hosted by default and Google Analytics is optional and disabled unless `google_analytics_id` is configured.
  - `README.md:55-66` shows a JSON configuration sample with `"google_analytics_id": "G-XXXXXXXXXX"`.
  - `apps/web/src/app/[locale]/layout.tsx:147-159` loads Google Analytics for any value matching `^(G-[A-Z0-9]+|UA-\d+-\d+)$`; `G-XXXXXXXXXX` matches that regex.
  - `apps/web/src/site-config.example.json:10` correctly uses an empty string.
- Failure scenario: An operator copies the README JSON block instead of `site-config.example.json`, leaves the placeholder in place, and unintentionally loads the Google tag script with a fake measurement ID. That conflicts with the "first-party by default" positioning even though the checked-in example file is safe.
- Concrete fix: Change the README sample to `"google_analytics_id": ""` and add a short note below the block that real `G-...` or `UA-...` IDs opt into Google Analytics. Avoid syntactically valid placeholder IDs in copy-pasteable config.

### PMR-23-05 - Auto alt-text internal naming can leak a future AI claim into docs

- Severity: Low
- Confidence: Medium
- Risk type: Likely future-documentation drift risk
- Evidence:
  - `apps/web/src/db/schema.ts:82-85` labels `alt_text_suggested` as "AI-generated alt text suggestion."
  - `apps/web/src/lib/caption-generator.ts:1-15` says the current implementation is a stub, no Florence-2 weights or captioning runner are wired, and generated suggestions are deterministic EXIF-derived hints.
  - `apps/web/src/lib/caption-generator.ts:31-40` produces strings like "Photo taken with {camera_model}" rather than vision captions.
  - Admin copy in `apps/web/messages/en.json:737-740` and `apps/web/messages/ko.json:737-740` correctly frames the feature as EXIF-derived hints and says local Florence-2 is not wired yet.
- Failure scenario: Future marketing, docs, or generated API descriptions copy the schema comment and claim AI alt text exists today. That would mislead operators because the product currently ships an EXIF-derived placeholder, not model inference.
- Concrete fix: Update internal comments/docs language from "AI-generated" to "auto-generated EXIF-derived alt-text suggestion; future AI captioning hook." Keep the user-facing copy as-is because it is already honest.

## Validated Claims With No Finding

- Private originals/public derivatives: README claims are consistent with the directory model in `README.md:80-83` and deployment notes in `README.md:194-201`.
- Lightroom plugin caveat: public README/admin copy correctly says no plugin is bundled even though the upload API is compatible with external clients.
- GPS privacy framing: public data selectors omit lat/lon by default and map exposure is explicitly topic-gated in source; the reviewed privacy copy matches that posture.
- Semantic production honesty gate: route behavior correctly returns setup errors rather than silently serving random production results when embeddings are absent.
- "No editing/culling/scoring" positioning: README and `CLAUDE.md` match the current product direction reviewed here.

## Final Sweep

No BurstPick paths or product assumptions were used as requirements. The review file itself is the only intended change for this task.
