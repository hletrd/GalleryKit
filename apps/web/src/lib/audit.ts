import { db, auditLog } from '@/db';
import { lt } from 'drizzle-orm';

// Security-relevant fields that should be preserved when truncating audit metadata.
// These are prioritized so they appear first in the serialized JSON, making them
// more likely to survive truncation while still capturing the full metadata when
// it fits within the limit.
const SECURITY_PRIORITY_KEYS = ['ip', 'userAgent', 'action', 'userId', 'targetType', 'targetId'];

/**
 * Reorder metadata object so security-relevant fields appear first.
 * This maximizes the chance that critical forensic fields survive truncation.
 *
 * R12C12 AGG-R12-05: exported so the ordering contract is locked by
 * `__tests__/audit-prioritize-security-fields.test.ts`. This is intentionally
 * defensive — most current callers pass these keys as dedicated `logAuditEvent`
 * parameters (stored as columns), but any caller that DOES put `userAgent`/`ip`
 * inside `metadata` benefits from the reorder under 4 KB truncation.
 */
export function prioritizeSecurityFields(metadata: Record<string, unknown>): Record<string, unknown> {
    const prioritized: Record<string, unknown> = {};
    // Copy priority keys first (only if present)
    for (const key of SECURITY_PRIORITY_KEYS) {
        if (key in metadata) {
            prioritized[key] = metadata[key];
        }
    }
    // Copy remaining keys
    for (const key of Object.keys(metadata)) {
        if (!SECURITY_PRIORITY_KEYS.includes(key)) {
            prioritized[key] = metadata[key];
        }
    }
    return prioritized;
}

/**
 * Fire-and-forget audit log writer.
 * Callers should use `.catch(console.debug)` to avoid blocking.
 *
 * Security note: When metadata exceeds 4096 chars, it is truncated to a 4000-char
 * preview. Security-relevant fields (ip, userAgent, action, userId, targetType,
 * targetId) are reordered to appear first in the JSON so they are more likely
 * to survive truncation. The `preview` field is a raw character slice and is NOT
 * meant to be parsed programmatically.
 */
export async function logAuditEvent(
    userId: number | null,
    action: string,
    targetType?: string,
    targetId?: string,
    ip?: string,
    metadata?: Record<string, unknown>,
): Promise<void> {
    let serializedMetadata: string | null = null;
    if (metadata) {
        try {
            const prioritizedMetadata = prioritizeSecurityFields(metadata);
            serializedMetadata = JSON.stringify(prioritizedMetadata);
        } catch {
            serializedMetadata = JSON.stringify({ note: 'metadata serialization failed' });
        }

        if (serializedMetadata && serializedMetadata.length > 4096) {
            // C3L-CR-01: Use array-spread slicing to avoid splitting
            // UTF-16 surrogate pairs. `[...str]` iterates by code point
            // (not UTF-16 code unit), so `.slice()` on the resulting
            // array cannot bisect a surrogate pair.
            // C14-AGG-01: The `preview` field is a raw character slice of
            // the stringified JSON and may terminate mid-key or mid-value,
            // producing an invalid JSON fragment. This is intentional — the
            // `preview` is for human forensic debugging only and is not
            // meant to be parsed programmatically. The trailing "…" marker
            // makes the truncation visually unambiguous.
            const codePoints = [...serializedMetadata];
            serializedMetadata = JSON.stringify({
                truncated: true,
                preview: codePoints.slice(0, 4000).join('') + '…',
            });
        }
    }

    await db.insert(auditLog).values({
        userId,
        action,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        ip: ip ?? null,
        metadata: serializedMetadata,
    });
}

/**
 * Purge audit log entries older than the specified age.
 * Default retention: 90 days. Override with AUDIT_LOG_RETENTION_DAYS env var.
 */
export async function purgeOldAuditLog(maxAgeMs?: number): Promise<void> {
    // Precedence: 1) explicit parameter, 2) AUDIT_LOG_RETENTION_DAYS env var, 3) default 90 days
    //
    // R4C6 COR-R4C6-10: a NEGATIVE retention (operator typo like
    // AUDIT_LOG_RETENTION_DAYS=-1, or a negative maxAgeMs param) put the
    // cutoff in the FUTURE — `created_at < cutoff` then matched every row
    // and purged the ENTIRE audit log. The previous `|| 90` rescued only
    // 0/NaN. Both inputs now require a finite POSITIVE value; anything
    // else falls back to the 90-day default.
    const DEFAULT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
    let effectiveMaxAgeMs: number;
    if (maxAgeMs !== undefined) {
        effectiveMaxAgeMs = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : DEFAULT_MAX_AGE_MS;
    } else {
        const retentionDays = Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10);
        effectiveMaxAgeMs = Number.isFinite(retentionDays) && retentionDays > 0
            ? retentionDays * 24 * 60 * 60 * 1000
            : DEFAULT_MAX_AGE_MS;
    }
    const cutoff = new Date(Date.now() - effectiveMaxAgeMs);
    await db.delete(auditLog).where(lt(auditLog.created_at, cutoff));
}
