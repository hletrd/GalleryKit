import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { isLosslessWebpByChunk } from '@/lib/process-image';

/**
 * AGG-C7-05 (run-9 c4): the Tier-2 GPS re-encode fallback must pick
 * `lossless: true` vs `quality: 95` for a WebP whose lossless byte-scrub
 * failed. The prior implementation used `input.includes(Buffer.from('VP8L'))`
 * — a whole-buffer substring scan that misclassifies a LOSSY VP8 file whose
 * metadata coincidentally contains the bytes "VP8L" as lossless (re-encoding
 * it lossless → a bloated stored original). `isLosslessWebpByChunk` reads the
 * actual RIFF pixel-chunk FourCC instead. These tests pin that contract; the
 * planted-substring case is the exact regression the fix closes.
 */
describe('isLosslessWebpByChunk (AGG-C7-05)', () => {
    async function lossyWebp(): Promise<Buffer> {
        return sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 10, g: 120, b: 200 } } })
            .webp({ quality: 80 })
            .toBuffer();
    }
    async function losslessWebp(): Promise<Buffer> {
        return sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 10, g: 120, b: 200 } } })
            .webp({ lossless: true })
            .toBuffer();
    }

    // Inject a spec-shaped RIFF sub-chunk carrying the given payload right
    // after the WEBP header (before the pixel chunk), fixing the top-level size.
    function injectChunk(webp: Buffer, tag: string, payload: Buffer): Buffer {
        const padded = payload.length + (payload.length % 2);
        const chunk = Buffer.alloc(8 + padded);
        chunk.write(tag, 0, 4, 'ascii');
        chunk.writeUInt32LE(payload.length, 4);
        payload.copy(chunk, 8);
        const out = Buffer.concat([webp.subarray(0, 12), chunk, webp.subarray(12)]);
        out.writeUInt32LE(out.length - 8, 4);
        return out;
    }

    it('classifies a genuine lossy WebP (VP8 ) as NOT lossless', async () => {
        const buf = await lossyWebp();
        expect(buf.toString('ascii', 12, 16)).toBe('VP8 '); // fixture sanity
        expect(isLosslessWebpByChunk(buf)).toBe(false);
    });

    it('classifies a genuine lossless WebP (VP8L) as lossless', async () => {
        const buf = await losslessWebp();
        // lossless encode is VP8X-wrapped or bare VP8L depending on sharp/libwebp;
        // either way the walker must reach a VP8L pixel chunk.
        expect(isLosslessWebpByChunk(buf)).toBe(true);
    });

    it('does NOT misclassify a lossy WebP whose metadata contains the bytes "VP8L"', async () => {
        // THE regression the fix closes: a planted "VP8L" substring inside an
        // XMP/metadata chunk must not flip a lossy file to lossless.
        const lossy = await lossyWebp();
        const withPlantedSubstring = injectChunk(
            lossy,
            'XMP ',
            Buffer.from('<x:xmpmeta><rdf:Description dc:note="codec VP8L mentioned here"/></x:xmpmeta>', 'latin1'),
        );
        // Precondition: the naive substring scan WOULD have matched.
        expect(withPlantedSubstring.includes(Buffer.from('VP8L', 'ascii'))).toBe(true);
        // The chunk-aware check correctly reports lossy (the real pixel chunk is VP8 ).
        expect(isLosslessWebpByChunk(withPlantedSubstring)).toBe(false);
    });

    it('returns false for non-WebP / malformed input (safe lossy default)', () => {
        expect(isLosslessWebpByChunk(Buffer.from('not a webp file at all'))).toBe(false);
        expect(isLosslessWebpByChunk(Buffer.alloc(4))).toBe(false); // too short
        // RIFF header but a zero-size chunk that would not progress → no infinite loop, false.
        const riffHead = Buffer.concat([
            Buffer.from('RIFF', 'ascii'),
            Buffer.from([0, 0, 0, 0]),
            Buffer.from('WEBP', 'ascii'),
            Buffer.from('ICCP', 'ascii'),
            Buffer.from([0, 0, 0, 0]),
        ]);
        expect(isLosslessWebpByChunk(riffHead)).toBe(false);
    });
});
