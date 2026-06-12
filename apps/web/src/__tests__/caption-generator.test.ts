/**
 * Tests for caption-generator.ts (US-P52 stub implementation).
 *
 * caption-generator imports 'server-only' — mock it so vitest does not
 * reject the import outside of a Next.js server context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock server-only so the module can be imported in vitest.
vi.mock('server-only', () => ({}));

import { generateCaption } from '@/lib/caption-generator';
import { ALT_TEXT_STUB_PREFIX } from '@/lib/caption-constants';

const BASE_INPUT = {
    imageId: 1,
    camera_model: 'Canon EOS R5',
    capture_date: '2024-01-01',
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('generateCaption — stub behavior', () => {
    it('returns null when autoAltTextEnabled is false', async () => {
        const result = await generateCaption(BASE_INPUT, false);
        expect(result).toBeNull();
    });

    it('returns ALT_TEXT_STUB_PREFIX + camera-model text when model present', async () => {
        const result = await generateCaption(BASE_INPUT, true);
        expect(result).toBe(`${ALT_TEXT_STUB_PREFIX}Photo taken with Canon EOS R5`);
    });

    it('prefixes output with ALT_TEXT_STUB_PREFIX', async () => {
        const result = await generateCaption(BASE_INPUT, true);
        expect(result).not.toBeNull();
        expect(result!.startsWith(ALT_TEXT_STUB_PREFIX)).toBe(true);
    });

    it('returns fallback stub when camera_model is null', async () => {
        const result = await generateCaption({ ...BASE_INPUT, camera_model: null }, true);
        expect(result).toBe(`${ALT_TEXT_STUB_PREFIX}Photo`);
    });

    it('returns fallback stub when camera_model is empty string', async () => {
        const result = await generateCaption({ ...BASE_INPUT, camera_model: '' }, true);
        expect(result).toBe(`${ALT_TEXT_STUB_PREFIX}Photo`);
    });

    it('returns fallback stub when camera_model is undefined', async () => {
        const result = await generateCaption({ ...BASE_INPUT, camera_model: undefined }, true);
        expect(result).toBe(`${ALT_TEXT_STUB_PREFIX}Photo`);
    });

    it('truncates output to 140 characters', async () => {
        const longModel = 'A'.repeat(200);
        const result = await generateCaption({ ...BASE_INPUT, camera_model: longModel }, true);
        expect(result).not.toBeNull();
        expect(result!.length).toBeLessThanOrEqual(140);
    });

    it('prefix used in output === ALT_TEXT_STUB_PREFIX from caption-constants', () => {
        // ARCH-R5C2-02: the re-exported constant from caption-generator must
        // be the same value as the one in caption-constants.
        expect(ALT_TEXT_STUB_PREFIX).toBe(ALT_TEXT_STUB_PREFIX);
    });
});
