/**
 * R19C19 A2 / MAJOR-1 (3-agent): single compile-guarded enrichment select for
 * the PUBLIC semantic + image-similarity search routes
 * (`api/search/semantic/route.ts`, `api/search/similar/[id]/route.ts`).
 *
 * Both routes previously hand-copied an identical inline `db.select({...})` for
 * result-card enrichment, bypassing the `Extract<…, PrivacySensitiveKeys>`
 * compile guard that `publicSelectFields` / `searchFields` carry in data.ts.
 * That made them the ONLY public image-select surfaces protected at *test* time
 * (`search-route-privacy.test.ts` denylist) rather than at `tsc` time, and the
 * two copies already drifted once (lens_model/capture_date landed in semantic
 * first, AGG-C10-11a, then back-ported to similar, AGG-C8-10). Centralizing the
 * shape here gives them the same tsc-time PII guard as their siblings and
 * deletes the duplication.
 *
 * This lives in its own small module — NOT in data.ts — so the routes do not
 * transitively import the entire 1700-line data-access layer (whose
 * module-level `sql` templates + view-count buffer would otherwise be pulled
 * into the route bundle and into any test importing the route). The privacy
 * guard uses a TYPE-ONLY import of `PrivacySensitiveKeys`, which is erased at
 * runtime, so no runtime dependency on data.ts is introduced.
 *
 * `topic_label` is a JOINed column (topics.label), not an `images` column — it
 * is not privacy-sensitive and not in `PrivacySensitiveKeys`.
 */
import { images, topics } from '@/db';
import type { PrivacySensitiveKeys } from '@/lib/data';

export const searchEnrichmentSelectFields = {
    id: images.id,
    title: images.title,
    description: images.description,
    filename_jpeg: images.filename_jpeg,
    width: images.width,
    height: images.height,
    topic: images.topic,
    topic_label: topics.label,
    camera_model: images.camera_model,
    lens_model: images.lens_model,
    capture_date: images.capture_date,
};

type _SearchEnrichmentSensitive = Extract<keyof typeof searchEnrichmentSelectFields, PrivacySensitiveKeys>;
const _searchEnrichmentPrivacyGuard: _SearchEnrichmentSensitive extends never
    ? true
    : ['ERROR: privacy-sensitive field found in searchEnrichmentSelectFields — these routes are anonymous/public', _SearchEnrichmentSensitive] = true;
void _searchEnrichmentPrivacyGuard;
