/**
 * R19-M1 legacy helper: RFC 7232 §3.3 If-Modified-Since comparison.
 *
 * C74-01: current feed routes intentionally do NOT import this helper.
 * Their 304 decisions are ETag-only because rendered feed XML depends on
 * SEO/feed-shaping settings that do not have a reliable Last-Modified
 * timestamp. Keep this helper only as a legacy parser for future route-level
 * work that can preserve that invalidation contract.
 *
 * Returns `true` when the response should be a 304 Not Modified (the
 * request carried a valid `If-Modified-Since` whose value is at or
 * after the resource's `feedUpdated` instant, compared at HTTP-date
 * second precision). Returns `false` otherwise — including when the
 * header is missing, malformed, or the resource is newer.
 */

export function isFeedNotModified(
    ifModifiedSince: string | null,
    feedUpdatedIso: string,
): boolean {
    if (!ifModifiedSince) return false;

    // HTTP-date parsing: Date.parse honors RFC 7231 §7.1.1.1
    // (preferred IMF-fixdate, plus the deprecated RFC 850 / asctime
    // formats). Malformed headers degrade to "not-modified=false" so a
    // legitimate visitor with a stale clock still gets the body.
    const imsMs = Date.parse(ifModifiedSince);
    if (!Number.isFinite(imsMs)) return false;

    let feedMs: number;
    try {
        feedMs = new Date(feedUpdatedIso).getTime();
    } catch {
        return false;
    }
    if (!Number.isFinite(feedMs)) return false;

    // RFC 7232 §3.3: compare at second precision. The ISO ms must be
    // floored to a whole-second instant to match the HTTP-date format
    // that the response's `Last-Modified` header carries.
    const feedSec = Math.floor(feedMs / 1000);
    const imsSec = Math.floor(imsMs / 1000);
    return imsSec >= feedSec;
}
