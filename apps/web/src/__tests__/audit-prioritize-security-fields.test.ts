import { describe, it, expect } from 'vitest';
import { prioritizeSecurityFields } from '@/lib/audit';

// R12C12 AGG-R12-05 / TEST-02: lock the ordering contract of the audit-metadata
// security-field prioritizer. The function moves forensic keys to the front so
// they are more likely to survive the 4 KB metadata truncation in logAuditEvent.
// SECURITY_PRIORITY_KEYS = ['ip', 'userAgent', 'action', 'userId', 'targetType', 'targetId']
describe('prioritizeSecurityFields', () => {
    it('moves present priority keys to the front in SECURITY_PRIORITY_KEYS order', () => {
        const input = {
            note: 'something',
            targetId: '42',
            extra: 1,
            ip: '203.0.113.7',
            userAgent: 'curl/8',
        };
        const result = prioritizeSecurityFields(input);
        // ip and userAgent come before targetId per the priority order, and all
        // priority keys precede the non-priority keys.
        expect(Object.keys(result)).toEqual(['ip', 'userAgent', 'targetId', 'note', 'extra']);
    });

    it('preserves insertion order of non-priority keys after the priority block', () => {
        const input = { zeta: 1, alpha: 2, userId: 9, beta: 3 };
        const result = prioritizeSecurityFields(input);
        expect(Object.keys(result)).toEqual(['userId', 'zeta', 'alpha', 'beta']);
    });

    it('skips absent priority keys without injecting undefined values', () => {
        const input = { action: 'login', detail: 'ok' };
        const result = prioritizeSecurityFields(input);
        expect(Object.keys(result)).toEqual(['action', 'detail']);
        // No phantom keys for the missing priority fields.
        expect('ip' in result).toBe(false);
        expect('userAgent' in result).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(result, 'userId')).toBe(false);
    });

    it('returns the same values (only reorders, never mutates values)', () => {
        const input = { ip: '198.51.100.4', count: 3, action: 'delete' };
        const result = prioritizeSecurityFields(input);
        expect(result.ip).toBe('198.51.100.4');
        expect(result.count).toBe(3);
        expect(result.action).toBe('delete');
    });

    it('handles an empty object', () => {
        expect(Object.keys(prioritizeSecurityFields({}))).toEqual([]);
    });

    it('orders all six priority keys correctly when all present', () => {
        const input = {
            tail: 'z',
            targetId: 't',
            targetType: 'image',
            userId: 1,
            action: 'update',
            userAgent: 'ua',
            ip: 'i',
        };
        const result = prioritizeSecurityFields(input);
        expect(Object.keys(result)).toEqual([
            'ip', 'userAgent', 'action', 'userId', 'targetType', 'targetId', 'tail',
        ]);
    });
});
