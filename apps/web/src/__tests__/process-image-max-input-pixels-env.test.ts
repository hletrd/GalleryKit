/**
 * R21C21 T5 (TEST21-01): the cycle-20 env-parse fix switched
 * IMAGE_MAX_INPUT_PIXELS / IMAGE_MAX_INPUT_PIXELS_TOPIC from parseInt() to
 * Number() (parseInt('256e6',10) === 256 would cap the decompression-bomb
 * guard at 256 pixels, rejecting EVERY upload as a bomb) but shipped with no
 * regression test. `MAX_INPUT_PIXELS_TOPIC` is exported and computed at module
 * load from process.env, so a resetModules re-import per env case locks it.
 *
 * sharp is mocked to a no-op so the module imports without the native binding;
 * the constant computation reads only process.env.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('sharp', () => ({ default: Object.assign(() => ({}), { cache: () => undefined, concurrency: () => 1 }) }));

const KEY = 'IMAGE_MAX_INPUT_PIXELS_TOPIC';
const DEFAULT_TOPIC_PIXELS = 64 * 1024 * 1024; // 67_108_864

afterEach(() => {
    delete process.env[KEY];
    vi.resetModules();
});

async function loadTopicCap(value?: string): Promise<number> {
    delete process.env[KEY];
    if (value !== undefined) process.env[KEY] = value;
    vi.resetModules();
    const m = await import('@/lib/process-image');
    return m.MAX_INPUT_PIXELS_TOPIC;
}

describe('IMAGE_MAX_INPUT_PIXELS_TOPIC env parsing (R21C21 T5)', () => {
    it('parses scientific notation in full (64e6 -> 64_000_000, not 64)', async () => {
        // parseInt('64e6', 10) === 64 would cap topic decode at 64 pixels.
        expect(await loadTopicCap('64e6')).toBe(64_000_000);
    });

    it('reads a plain integer override', async () => {
        expect(await loadTopicCap('33554432')).toBe(33_554_432);
    });

    it('falls back to the 64 MiB-pixel default when unset', async () => {
        expect(await loadTopicCap(undefined)).toBe(DEFAULT_TOPIC_PIXELS);
    });

    it.each(['abc', '', '0', '-1'])(
        'falls back to the default for invalid/non-positive input %j',
        async (bad) => {
            expect(await loadTopicCap(bad)).toBe(DEFAULT_TOPIC_PIXELS);
        },
    );
});
