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
    it('holds the admin mutation barrier through updatePassword expensive work and DB mutation', () => {
        expect(authSource).toContain("from '@/lib/admin-mutation-barrier'");
        const functionIndex = indexAfter(authSource, 'export async function updatePassword');
        const slotIndex = indexAfter(authSource, 'using mutationSlot = acquireAdminMutationSlot();');
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
});
