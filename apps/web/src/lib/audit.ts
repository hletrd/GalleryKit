import { db, auditLog } from '@/db';

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
