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
});
