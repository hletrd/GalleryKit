import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, '..', 'components', 'load-more.tsx'), 'utf8');

describe('load-more source contracts (R2C10-LOW-01)', () => {
    it('has a maintenance cooldown ref to prevent repeated toast spam', () => {
        expect(source).toContain('maintenanceCooldownRef');
        expect(source).toContain('MAINTENANCE_COOLDOWN_MS');
    });

    it('checks cooldown before showing maintenance toast', () => {
        expect(source).toMatch(/maintenanceCooldownRef\.current/);
        expect(source).toMatch(/now - maintenanceCooldownRef\.current > MAINTENANCE_COOLDOWN_MS/);
    });

    it('backs off transient server failures before re-calling the server action', () => {
        expect(source).toContain('transientRetryAfterRef');
        expect(source).toContain('TRANSIENT_RETRY_COOLDOWN_MS');
        expect(source).toMatch(/if\s*\(\s*transientRetryAfterRef\.current\s*>\s*retryNow\s*\)\s*return;/);
        expect(source).toMatch(/page\.status === 'rateLimited' \|\| page\.status === 'maintenance' \|\| page\.status === 'error'/);
    });
});
