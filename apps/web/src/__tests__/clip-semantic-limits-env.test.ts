/**
 * R21C21 T4 (CRIT21-02): SEMANTIC_TOP_K_MAX and SEMANTIC_SCAN_LIMIT are
 * documented in CLAUDE.md ("Runtime limits") as env-tunable operational caps,
 * but were previously hardcoded `export const` with no process.env read — a
 * doc/code mismatch. They are now wired to the environment with a positive-
 * integer guard (Number(), not parseInt — matching the cycle-20 env-parse
 * sweep). These tests re-import the module per case (the limits are computed at
 * module load from process.env).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const ENV_KEYS = ['SEMANTIC_SCAN_LIMIT', 'SEMANTIC_TOP_K_MAX'];

function clearEnv() {
    for (const k of ENV_KEYS) delete process.env[k];
}

afterEach(() => {
    clearEnv();
    vi.resetModules();
});

async function load(env: Record<string, string>) {
    clearEnv();
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    vi.resetModules();
    return import('@/lib/clip-embeddings');
}

describe('semantic limits env wiring (R21C21 T4)', () => {
    it('falls back to the documented defaults (2000 / 50) when env is unset', async () => {
        const m = await load({});
        expect(m.SEMANTIC_SCAN_LIMIT).toBe(2000);
        expect(m.SEMANTIC_TOP_K_MAX).toBe(50);
    });

    it('reads an integer override from the environment', async () => {
        const m = await load({ SEMANTIC_SCAN_LIMIT: '3000', SEMANTIC_TOP_K_MAX: '30' });
        expect(m.SEMANTIC_SCAN_LIMIT).toBe(3000);
        expect(m.SEMANTIC_TOP_K_MAX).toBe(30);
    });

    it('parses scientific notation in full (4e3 -> 4000, not 4)', async () => {
        // The whole point of the cycle-20 Number()-over-parseInt sweep:
        // parseInt('4e3', 10) === 4 would have silently capped the scan at 4 rows.
        const m = await load({ SEMANTIC_SCAN_LIMIT: '4e3' });
        expect(m.SEMANTIC_SCAN_LIMIT).toBe(4000);
    });

    it('floors a fractional value to an integer', async () => {
        const m = await load({ SEMANTIC_TOP_K_MAX: '25.9' });
        expect(m.SEMANTIC_TOP_K_MAX).toBe(25);
    });

    it.each(['abc', '', '0', '-5', 'Infinity'])(
        'falls back to the default for invalid/non-positive input %j',
        async (bad) => {
            const m = await load({ SEMANTIC_SCAN_LIMIT: bad, SEMANTIC_TOP_K_MAX: bad });
            expect(m.SEMANTIC_SCAN_LIMIT).toBe(2000);
            expect(m.SEMANTIC_TOP_K_MAX).toBe(50);
        },
    );

    // R22C22 T4 (critic m1): a fractional value that floors below 1 must fall
    // back, NOT yield 0 (a 0 scan-limit would scan nothing).
    it.each(['0.5', '0.9', '0.001'])(
        'falls back to the default when the value floors below 1 (%j)',
        async (sub) => {
            const m = await load({ SEMANTIC_SCAN_LIMIT: sub, SEMANTIC_TOP_K_MAX: sub });
            expect(m.SEMANTIC_SCAN_LIMIT).toBe(2000);
            expect(m.SEMANTIC_TOP_K_MAX).toBe(50);
        },
    );

    // R22C22 T4 (SEC-22-INFO): generous upper clamp against operator misconfig.
    it('clamps an unbounded override to ENV_INT_MAX (1_000_000)', async () => {
        const m = await load({ SEMANTIC_SCAN_LIMIT: '5e9', SEMANTIC_TOP_K_MAX: '2000000' });
        expect(m.SEMANTIC_SCAN_LIMIT).toBe(1_000_000);
        expect(m.SEMANTIC_TOP_K_MAX).toBe(1_000_000);
    });

    it('keeps a value exactly at the clamp ceiling', async () => {
        const m = await load({ SEMANTIC_SCAN_LIMIT: '1000000' });
        expect(m.SEMANTIC_SCAN_LIMIT).toBe(1_000_000);
    });
});
