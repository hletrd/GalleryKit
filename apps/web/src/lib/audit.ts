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
            serializedMetadata = JSON.stringify({
                truncated: true,
                preview: serializedMetadata.slice(0, 4000),
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
    const retentionDays = Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10) || 90;
    const effectiveMaxAgeMs = maxAgeMs ?? retentionDays * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - effectiveMaxAgeMs);
    await db.delete(auditLog).where(lt(auditLog.created_at, cutoff));
}
