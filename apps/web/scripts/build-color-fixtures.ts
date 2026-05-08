/**
 * Build synthetic color test fixtures.
 *
 * Generates ICC profiles with the canonical primary chromaticities for
 * each gamut (sRGB / P3-D65 / AdobeRGB / ProPhoto / BT.2020) so the
 * chromaticity-based detector can be exercised against real-shaped
 * buffers without needing to bundle proprietary calibration files.
 *
 * Run with:
 *   tsx apps/web/scripts/build-color-fixtures.ts
 *
 * Output goes to apps/web/__test_fixtures__/color/.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

interface Xy { x: number; y: number }
interface Preset {
    name: string;
    description: string;
    wp: Xy;
    r: Xy;
    g: Xy;
    b: Xy;
}

const PRESETS: Preset[] = [
    {
        name: 'synth-srgb-chromaticities.icc',
        description: 'CustomCalibrationsRGBv1',
        wp: { x: 0.3127, y: 0.3290 },
        r: { x: 0.640, y: 0.330 },
        g: { x: 0.300, y: 0.600 },
        b: { x: 0.150, y: 0.060 },
    },
    {
        name: 'synth-p3-chromaticities.icc',
        description: 'CustomP3D65v1',
        wp: { x: 0.3127, y: 0.3290 },
        r: { x: 0.680, y: 0.320 },
        g: { x: 0.265, y: 0.690 },
        b: { x: 0.150, y: 0.060 },
    },
    {
        name: 'synth-adobergb-flavored.icc',
        description: 'CG2700Xcalibrated',
        wp: { x: 0.3128, y: 0.3291 },
        r: { x: 0.6395, y: 0.3303 },
        g: { x: 0.2102, y: 0.7100 },
        b: { x: 0.1501, y: 0.0601 },
    },
    {
        name: 'synth-prophoto-chromaticities.icc',
        description: 'CustomProPhotoD50v1',
        wp: { x: 0.3457, y: 0.3585 },
        r: { x: 0.7347, y: 0.2653 },
        g: { x: 0.1596, y: 0.8404 },
        b: { x: 0.0366, y: 0.0001 },
    },
    {
        name: 'synth-bt2020-chromaticities.icc',
        description: 'CustomRec2020v1',
        wp: { x: 0.3127, y: 0.3290 },
        r: { x: 0.708, y: 0.292 },
        g: { x: 0.170, y: 0.797 },
        b: { x: 0.131, y: 0.046 },
    },
];

function xyToXyz(p: Xy): { x: number; y: number; z: number } {
    return { x: p.x / p.y, y: 1, z: (1 - p.x - p.y) / p.y };
}

function writeS15Fixed16(buf: Buffer, offset: number, value: number): void {
    buf.writeInt32BE(Math.round(value * 65536), offset);
}

function makeXyzPayload(xyz: { x: number; y: number; z: number }): Buffer {
    const b = Buffer.alloc(20);
    b.write('XYZ ', 0, 4, 'ascii');
    b.writeUInt32BE(0, 4);
    writeS15Fixed16(b, 8, xyz.x);
    writeS15Fixed16(b, 12, xyz.y);
    writeS15Fixed16(b, 16, xyz.z);
    return b;
}

/**
 * Build a minimal but well-formed ICC profile (RGB color space,
 * D50 PCS, descriptor + chromaticity tags only).
 *
 * We intentionally stick to a self-contained 4 KB layout that the
 * existing tag-table walker can parse. The fixture is *not* meant
 * for decoder use — it is structural input for the parser.
 */
function buildIcc(preset: Preset): Buffer {
    // Layout:
    //   0..127      ICC header (acsp magic at offset 36)
    //   128..131    tag count (5)
    //   132..191    tag table (5 × 12)
    //   192..       desc tag payload (32 bytes, ascii)
    //   224..       wtpt payload (20 bytes)
    //   244..       rXYZ payload (20)
    //   264..       gXYZ payload (20)
    //   284..       bXYZ payload (20)
    const total = 304;
    const buf = Buffer.alloc(total);
    buf.writeUInt32BE(total, 0);              // profile size
    buf.write('RGB ', 16, 4, 'ascii');        // color space
    buf.write('XYZ ', 20, 4, 'ascii');        // PCS
    buf.write('acsp', 36, 4, 'ascii');        // magic
    buf.writeUInt32BE(5, 128);                // tag count

    // desc tag entry
    const descName = preset.description.slice(0, 24);
    const descAsciiLen = descName.length + 1;
    const descPayload = Buffer.alloc(32);
    descPayload.write('desc', 0, 4, 'ascii');
    descPayload.writeUInt32BE(0, 4);
    descPayload.writeUInt32BE(descAsciiLen, 8);
    descPayload.write(descName + '\0', 12, descAsciiLen, 'ascii');

    const tagEntries: { sig: string; offset: number; size: number; payload: Buffer }[] = [
        { sig: 'desc', offset: 192, size: descPayload.length, payload: descPayload },
        { sig: 'wtpt', offset: 224, size: 20, payload: makeXyzPayload(xyToXyz(preset.wp)) },
        { sig: 'rXYZ', offset: 244, size: 20, payload: makeXyzPayload(xyToXyz(preset.r)) },
        { sig: 'gXYZ', offset: 264, size: 20, payload: makeXyzPayload(xyToXyz(preset.g)) },
        { sig: 'bXYZ', offset: 284, size: 20, payload: makeXyzPayload(xyToXyz(preset.b)) },
    ];

    for (let i = 0; i < tagEntries.length; i++) {
        const t = tagEntries[i];
        const tagOff = 132 + i * 12;
        buf.write(t.sig, tagOff, 4, 'ascii');
        buf.writeUInt32BE(t.offset, tagOff + 4);
        buf.writeUInt32BE(t.size, tagOff + 8);
        t.payload.copy(buf, t.offset);
    }
    return buf;
}

const fixturesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '__test_fixtures__',
    'color',
);

mkdirSync(fixturesDir, { recursive: true });

for (const preset of PRESETS) {
    const out = path.join(fixturesDir, preset.name);
    writeFileSync(out, buildIcc(preset));
    console.log(`wrote ${out} (${(buildIcc(preset).length / 1024).toFixed(1)} KB)`);
}

console.log('Done.');
