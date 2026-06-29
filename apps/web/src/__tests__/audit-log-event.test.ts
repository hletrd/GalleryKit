import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbInsertMock, valuesMock } = vi.hoisted(() => ({
    dbInsertMock: vi.fn(),
    valuesMock: vi.fn(),
}));

vi.mock('@/db', () => ({
    db: {
        insert: dbInsertMock,
    },
    auditLog: { table: 'audit_log' },
}));

import { logAuditEvent } from '@/lib/audit';

describe('logAuditEvent metadata serialization', () => {
    beforeEach(() => {
        dbInsertMock.mockReset();
        valuesMock.mockReset();
        dbInsertMock.mockReturnValue({ values: valuesMock });
        valuesMock.mockResolvedValue(undefined);
    });

    it('serializes prioritized security metadata before non-priority fields', async () => {
        await logAuditEvent(7, 'image_update', 'image', '42', '203.0.113.9', {
            note: 'tail',
            targetId: 'metadata-target',
            userAgent: 'curl/8',
            ip: '198.51.100.1',
        });

        expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
            userId: 7,
            action: 'image_update',
            targetType: 'image',
            targetId: '42',
            ip: '203.0.113.9',
        }));
        const payload = valuesMock.mock.calls[0][0] as { metadata: string };
        expect(Object.keys(JSON.parse(payload.metadata))).toEqual(['ip', 'userAgent', 'targetId', 'note']);
    });

    it('truncates oversized metadata to a marked preview without splitting code points', async () => {
        await logAuditEvent(null, 'bulk', undefined, undefined, undefined, {
            ip: '203.0.113.10',
            userAgent: 'agent',
            note: '😀'.repeat(5000),
        });

        const payload = valuesMock.mock.calls[0][0] as { metadata: string };
        const metadata = JSON.parse(payload.metadata) as { truncated: boolean; preview: string };
        expect(metadata.truncated).toBe(true);
        expect(metadata.preview).toMatch(/^{"ip":"203\.0\.113\.10","userAgent":"agent"/);
        expect(metadata.preview.endsWith('…')).toBe(true);
        expect(metadata.preview).not.toContain('\uFFFD');
    });
});
