import { db, auditLog } from '@/db';
import { lt } from 'drizzle-orm';

/**
 * Fire-and-forget audit log writer.
 * Callers should use `.catch(console.debug)` to avoid blocking.
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
            serializedMetadata = JSON.stringify(metadata);
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
    let effectiveMaxAgeMs: number;
    if (maxAgeMs !== undefined) {
        effectiveMaxAgeMs = maxAgeMs;
    } else {
        const retentionDays = Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10) || 90;
        effectiveMaxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
    }
    const cutoff = new Date(Date.now() - effectiveMaxAgeMs);
    await db.delete(auditLog).where(lt(auditLog.created_at, cutoff));
}
