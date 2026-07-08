import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const authSource = readFileSync(resolve(__dirname, '../app/actions/auth.ts'), 'utf8');

function indexAfter(source: string, needle: string, fromIndex = 0): number {
    const start = source.indexOf(needle, fromIndex);
    expect(start, `${needle} should exist`).toBeGreaterThanOrEqual(0);
    return start;
}

describe('auth mutation barrier source contracts', () => {
    it('holds the admin mutation barrier before login rate-limit and session writes', () => {
        const functionIndex = indexAfter(authSource, 'export async function login');
        const originIndex = indexAfter(authSource, 'if (!hasTrustedSameOrigin(requestHeaders))', functionIndex);
        const slotIndex = indexAfter(authSource, 'using mutationSlot = acquireAdminMutationSlot();', originIndex);
        const acquiredCheckIndex = indexAfter(authSource, 'if (!mutationSlot.acquired)', slotIndex);
        const rateLimitIndex = indexAfter(authSource, "incrementRateLimit(ip, 'login'", acquiredCheckIndex);
        const sessionInsertIndex = indexAfter(authSource, 'tx.insert(sessions)', rateLimitIndex);

        expect(slotIndex).toBeGreaterThan(originIndex);
        expect(acquiredCheckIndex).toBeGreaterThan(slotIndex);
        expect(rateLimitIndex).toBeGreaterThan(acquiredCheckIndex);
        expect(sessionInsertIndex).toBeGreaterThan(rateLimitIndex);
    });

    it('holds the admin mutation barrier through updatePassword expensive work and DB mutation', () => {
        expect(authSource).toContain("from '@/lib/admin-mutation-barrier'");
        const functionIndex = indexAfter(authSource, 'export async function updatePassword');
        const slotIndex = indexAfter(authSource, 'using mutationSlot = acquireAdminMutationSlot();', functionIndex);
        const acquiredCheckIndex = indexAfter(authSource, 'if (!mutationSlot.acquired)', slotIndex);
        const rateLimitIndex = indexAfter(authSource, "incrementRateLimit(ip, 'password_change'", slotIndex);
        const verifyIndex = indexAfter(authSource, 'argon2.verify', slotIndex);
        const transactionIndex = indexAfter(authSource, 'db.transaction', slotIndex);

        expect(slotIndex).toBeGreaterThan(functionIndex);
        expect(acquiredCheckIndex).toBeGreaterThan(slotIndex);
        expect(authSource.slice(slotIndex, rateLimitIndex)).not.toContain('if (!mutationSlot)');
        expect(rateLimitIndex).toBeGreaterThan(slotIndex);
        expect(verifyIndex).toBeGreaterThan(slotIndex);
        expect(transactionIndex).toBeGreaterThan(slotIndex);
    });

    it('holds the admin mutation barrier before logout verifies or deletes the session', () => {
        const functionIndex = indexAfter(authSource, 'export async function logout');
        const sameOriginIndex = indexAfter(authSource, 'if (!hasTrustedSameOrigin(requestHeaders))', functionIndex);
        const slotIndex = indexAfter(authSource, 'using mutationSlot = acquireAdminMutationSlot();', sameOriginIndex);
        const acquiredCheckIndex = indexAfter(authSource, 'if (!mutationSlot.acquired)', slotIndex);
        const maintenanceIndex = indexAfter(authSource, 'const maintenanceError = getRestoreMaintenanceMessage', acquiredCheckIndex);
        const verifyIndex = indexAfter(authSource, 'verifySessionToken(token)', maintenanceIndex);
        const deleteIndex = indexAfter(authSource, 'db.delete(sessions)', verifyIndex);
        const cookieDeleteIndex = indexAfter(authSource, 'cookieStore.delete', deleteIndex);

        expect(slotIndex).toBeGreaterThan(sameOriginIndex);
        expect(acquiredCheckIndex).toBeGreaterThan(slotIndex);
        expect(maintenanceIndex).toBeGreaterThan(acquiredCheckIndex);
        expect(verifyIndex).toBeGreaterThan(maintenanceIndex);
        expect(deleteIndex).toBeGreaterThan(verifyIndex);
        expect(cookieDeleteIndex).toBeGreaterThan(deleteIndex);
    });

    it('queues logout revocation unless the DB delete actually succeeds', () => {
        const functionIndex = indexAfter(authSource, 'export async function logout');
        const deleteIndex = indexAfter(authSource, 'await db.delete(sessions)', functionIndex);
        const revokedIndex = indexAfter(authSource, 'revoked = true;', deleteIndex);
        const queueIndex = indexAfter(authSource, 'enqueuePendingSessionRevocation(hashSessionToken(token))', revokedIndex);
        const deleteWindow = authSource.slice(deleteIndex, revokedIndex);

        expect(deleteWindow).not.toContain('.catch(() => {})');
        expect(queueIndex).toBeGreaterThan(revokedIndex);
    });
});
