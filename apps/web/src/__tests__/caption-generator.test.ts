/**
 * Tests for caption-generator.ts (US-P52 stub implementation).
 *
 * caption-generator imports 'server-only'; vitest.config.ts aliases that
 * specifier to a no-op stub globally, so no per-file mock is needed here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

    it('does not split supplementary characters when truncating', async () => {
        const prefix = `${ALT_TEXT_STUB_PREFIX}Photo taken with `;
        const model = 'A'.repeat(140 - prefix.length - 1) + '😀' + 'B'.repeat(10);
        const result = await generateCaption({ ...BASE_INPUT, camera_model: model }, true);
        expect(result).not.toBeNull();
        expect([...result!]).toHaveLength(140);
        expect(result).toContain('😀');
        expect(result).not.toContain('\uFFFD');
        expect([...result!].at(-1)).toBe('😀');
    });

    it('emitted caption is prefixed by the canonical caption-constants prefix', async () => {
        // ARCH-R5C2-02 (AGG-R5C3-02): behavioral cross-module pin. The prefix
        // baked into generateCaptionStub's output MUST be the canonical
        // ALT_TEXT_STUB_PREFIX imported from caption-constants. A hardcoded
        // '[WRONG] ' drift in the generator would make indexOf !== 0 and fail
        // here — the previous self-comparison assertion always passed and
        // enforced nothing.
        const result = await generateCaption(BASE_INPUT, true);
        expect(result).not.toBeNull();
        expect(result!.indexOf(ALT_TEXT_STUB_PREFIX)).toBe(0);
    });
});
