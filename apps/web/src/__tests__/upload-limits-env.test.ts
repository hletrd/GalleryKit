/**
 * R20C20: upload-limits env parsing must use Number(), not parseInt(..., 10).
 *
 * parseInt('2e9', 10) === 2, which passes the `> 0` guard in parsePositiveIntEnv
 * and would silently set the cumulative-upload byte cap to 2 bytes — blocking
 * every real upload. Number('2e9') === 2_000_000_000. These tests re-import the
 * module per case (the limits are computed at module load from process.env).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const ENV_KEYS = [
    'UPLOAD_MAX_TOTAL_BYTES',
    'UPLOAD_MAX_FILES_PER_WINDOW',
    'NEXT_UPLOAD_BODY_MAX_BYTES',
];

function clearEnv() {
    for (const k of ENV_KEYS) delete process.env[k];
}

afterEach(() => {
    clearEnv();
    vi.resetModules();
});

async function loadLimits(env: Record<string, string>) {
    clearEnv();
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    vi.resetModules();
    return import('@/lib/upload-limits');
}

describe('upload-limits env parsing (R20C20)', () => {
    it('parses scientific-notation byte cap in full (2e9 -> 2_000_000_000, not 2)', async () => {
        const m = await loadLimits({ UPLOAD_MAX_TOTAL_BYTES: '2e9' });
        expect(m.MAX_TOTAL_UPLOAD_BYTES).toBe(2_000_000_000);
    });

    it('floors a fractional scientific value to an integer byte count', async () => {
        const m = await loadLimits({ UPLOAD_MAX_TOTAL_BYTES: '1.5e9' });
        expect(m.MAX_TOTAL_UPLOAD_BYTES).toBe(1_500_000_000);
    });

    it('honors a plain integer file-count cap', async () => {
        const m = await loadLimits({ UPLOAD_MAX_FILES_PER_WINDOW: '250' });
        expect(m.UPLOAD_MAX_FILES_PER_WINDOW).toBe(250);
    });

    it('falls back to the 2 GiB default on empty / NaN / non-positive', async () => {
        const def = 2 * 1024 * 1024 * 1024;
        expect((await loadLimits({})).MAX_TOTAL_UPLOAD_BYTES).toBe(def);
        expect((await loadLimits({ UPLOAD_MAX_TOTAL_BYTES: 'lots' })).MAX_TOTAL_UPLOAD_BYTES).toBe(def);
        expect((await loadLimits({ UPLOAD_MAX_TOTAL_BYTES: '0' })).MAX_TOTAL_UPLOAD_BYTES).toBe(def);
        expect((await loadLimits({ UPLOAD_MAX_TOTAL_BYTES: '-5' })).MAX_TOTAL_UPLOAD_BYTES).toBe(def);
    });
});
