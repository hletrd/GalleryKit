# Tracer — Run-9 Cycle-8 (evidence-driven causal trace)

**Repo:** GalleryKit · **HEAD:** `4e132b03` · READ-ONLY causal data-flow tracing.

## Chains traced

### Chain 1 — The 6 admin processing settings (admin_settings DB → config → enqueue job → handler gate → processImageFormats)
- **INTACT.** admin_settings row → `gallery-config-shared.ts` (validation) → `gallery-config.ts` (resolution) → enqueue job snapshot. Both external enqueue paths (browser `images.ts:440-466`, LR `lr/upload/route.ts:420-449`) forward all 6. Retry (`images.ts:1139`) + bootstrap (`image-queue.ts:674`) omit quality+imageSizes → handler gate `if (!quality && !imageSizes)` (`image-queue.ts:336`) reloads all 6 from config. Internal re-enqueues (`:290`, `:510`) pass the same `job` by reference.
- **Destination-side check:** `processImageFormats` USES all the values the handler passes (forceSrgbDerivatives, wideGamutJpegChroma, avifEffort, sdrJpegChroma, wideGamutMaxSourcePixels, quality, imageSizes, iccProfileName, colorSignals). The ONE observable non-propagation — `autoAltTextEnabled` is NOT passed to `processImageFormats` — is **correct by architecture**: it is consumed at the queue-handler level for the fire-and-forget `generateCaption` hook (`image-queue.ts:415-417`), not inside the pixel encoder. No divergence.

### Chain 2 — settings-hash → ETag → cache-invalidation
- **INTACT.** All 9 COLOR_IMPACTING_KEYS influence served bytes; `buildHashFromConfig` (`settings-hash.ts`) maps all 9; the serve-upload-path ETag `W/"v${PIPELINE}-${mtime}-${size}-${settingsHash}"` invalidates on any of the 9 flipping. Static-path invalidation rides mtime+size on re-encode (documented CRT-D1 gotcha — correct).

### Chain 3 — privacy-field chain (adminSelectFields → publicSelectFields → query → API response)
- **INTACT.** publicSelectFields is a separate object derived by omitting 20 PII keys; no downstream JOIN/spread/manual-augment re-adds any omitted field. `avif_10bit` IS in public select fields (CLAUDE.md correctly states public-safe). Compile-time `_SensitiveKeysInPublic` / `_MapSensitiveKeys` guards hold.

### Chain 4 — pipeline_version → backfill → ETag
- **INTACT.** Backfill re-encodes rows where pipeline_version != IMAGE_PIPELINE_VERSION, rewrites bytes (changing mtime+size → static-path ETag), bumps pipeline_version on success. Both entry points persist the identical 10 audit columns.

### Chain 5 — HDR-honesty + blur-data-url + GPS-strip
- **INTACT.** is_hdr is admin-only (publicSelectFields omits it); the public HDR badge is gated on `isAdmin && isHdr` explicitly. blur_data_url enforced at producer + write + read. GPS strip operates on the private original only; derivatives never use withMetadata().

## DISPOSITION: 0 DEFECTS, 0 POLISH

All five traced chains are intact. Consistent with the c7 critic's "settings-drift class exhausted" verdict. No silent divergence, missing propagation, or unenforced invariant found. The lone observable non-propagation (`autoAltTextEnabled` not reaching `processImageFormats`) is correct-by-architecture (consumed at the caption hook, not the encoder).
