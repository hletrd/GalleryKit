import sharp from 'sharp';
import exifReader from 'exif-reader';

import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';

import { UPLOAD_DIR_ORIGINAL, UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG } from '@/lib/upload-paths';
import { DEFAULT_IMAGE_SIZES } from '@/lib/gallery-config-shared';
import { isValidExifDateTimeParts } from '@/lib/exif-datetime';
import { assertBlurDataUrl } from '@/lib/blur-data-url';
import { detectColorSignals, type ColorSignals } from '@/lib/color-detection';
import { extractIccProfileName } from '@/lib/icc-extractor';
export { extractIccProfileName } from '@/lib/icc-extractor';

const cpuCount = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus()?.length ?? 1;
// CM-LOW-10: processImageFormats fans out to AVIF + WebP + JPEG via
// Promise.all, and sharp.concurrency() is the PER-CALL libvips thread cap.
// One image at the default cap can therefore spawn 3*(cores-1) threads,
// drowning the libuv pool when QUEUE_CONCURRENCY > 1. Divide by the format
// fan-out so the per-image total stays close to (cores - 1).
const maxConcurrency = Math.max(1, Math.floor((cpuCount - 1) / 3));
const envConcurrency = Number.parseInt(process.env.SHARP_CONCURRENCY ?? '', 10);
const sharpConcurrency = Number.isFinite(envConcurrency) && envConcurrency > 0
    ? Math.min(envConcurrency, Math.max(1, cpuCount - 1))
    : maxConcurrency;
// Limit libvips worker threads to keep the server responsive during conversions.
sharp.concurrency(sharpConcurrency);
// CM-LOW-9: server processes never see cache hits (every UUID is fresh) and
// the libvips operation cache pins buffers in heap. Disable for steady RSS.
sharp.cache(false);

// CM-MED-1: Gate 10-bit AVIF on libheif availability. Sharp's prebuilt
// binaries bundle libheif which may or may not support 10/12-bit AVIF
// encoding; passing bitdepth:10 throws when it doesn't. Detect at first
// use so we can gate the wide-gamut bit-depth bump cleanly.
// PP-BUG-2: the original `!sharp.versions.heif` was inverted — on Docker
// production libheif IS bundled (truthy), so the negation made the gate
// evaluate false and 8-bit AVIFs were shipped despite 10-bit being
// available. A simple `!!sharp.versions.heif` fix is also wrong because
// some builds report heif but still reject bitdepth:10 at encode time.
// C12-LOW-04: replace the lazy probe-with-side-effects pattern (which
// races when multiple images are processed concurrently) with a
// Promise-based singleton. The first caller triggers a standalone
// 2x2 probe encode; all concurrent callers await the same promise so
// the result is observed exactly once and consistently.
let _highBitdepthAvifProbePromise: Promise<boolean> | null = null;

async function _probeHighBitdepthAvif(): Promise<boolean> {
    try {
        // Minimal 2x2 encode — enough to exercise the codec path without
        // wasting CPU on a real image decode + resize pipeline.
        await sharp({
            create: {
                width: 2,
                height: 2,
                channels: 3,
                background: { r: 128, g: 128, b: 128 },
            },
        })
            .avif({ quality: 1, effort: 1, bitdepth: 10 })
            .toBuffer();
        return true;
    } catch {
        return false;
    }
}

async function canUseHighBitdepthAvif(): Promise<boolean> {
    if (_highBitdepthAvifProbePromise) return _highBitdepthAvifProbePromise;
    _highBitdepthAvifProbePromise = _probeHighBitdepthAvif();
    return _highBitdepthAvifProbePromise;
}
const envMaxInputPixels = Number.parseInt(process.env.IMAGE_MAX_INPUT_PIXELS ?? '', 10);
const maxInputPixels = Number.isFinite(envMaxInputPixels) && envMaxInputPixels > 0
    ? envMaxInputPixels
    : 256 * 1024 * 1024;
// limitInputPixels is passed per-constructor call (Sharp 0.33+ API)

// Topic images are resized to 512x512 and don't need the same pixel headroom.
// A separate env var allows independent tuning without affecting full-image processing.
export const MAX_INPUT_PIXELS_TOPIC = (() => {
    const envTopicPixels = Number.parseInt(process.env.IMAGE_MAX_INPUT_PIXELS_TOPIC ?? '', 10);
    return Number.isFinite(envTopicPixels) && envTopicPixels > 0
        ? envTopicPixels
        : 64 * 1024 * 1024;
})();

/**
 * Color-pipeline version. Bumped whenever the encoder semantics change so
 * downstream caches (browser, CDN, service worker) can re-fetch automatically
 * via the ETag emitted by serve-upload.ts. Skip 1 to mark the cutover from
 * pre-fix bytes (any version < 2 is the un-versioned legacy output).
 *
 * History:
 *   2 — first versioned cut: failOn:'error', autoOrient, ETag-based cache,
 *       strict P3 detection, toColorspace + withIccProfile encode chain.
 *   3 — perf + bit-depth tuning: pipelineColorspace('rgb16') for wide-gamut,
 *       10-bit AVIF for wide-gamut, 4:4:4 JPEG chroma for wide-gamut,
 *       AVIF effort:6, sharp.cache(false), per-image concurrency divided
 *       by format fan-out.
 */
export const IMAGE_PIPELINE_VERSION = 5;

const ALLOWED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.heif', '.tiff', '.tif', '.gif', '.bmp'
]);

const MAX_FILE_SIZE = 200 * 1024 * 1024;

// Singleton promise — clears on failure so transient errors don't permanently break uploads.
let dirsPromise: Promise<void> | null = null;
const ensureDirs = () => {
    if (!dirsPromise) {
        dirsPromise = Promise.all([
            fs.mkdir(UPLOAD_DIR_ORIGINAL, { recursive: true }),
            fs.mkdir(UPLOAD_DIR_WEBP, { recursive: true }),
            fs.mkdir(UPLOAD_DIR_AVIF, { recursive: true }),
            fs.mkdir(UPLOAD_DIR_JPEG, { recursive: true }),
        ]).then(() => {}).catch((e) => {
            dirsPromise = null;
            throw e;
        });
    }
    return dirsPromise;
};

// NOTE: ALLOWED_EXTENSIONS entries must only contain [a-z0-9.] — the sanitizer strips everything else.
function getSafeExtension(filename: string): string {
    let ext = path.extname(filename).toLowerCase();

    ext = ext.replace(/[^a-z0-9.]/g, '');

    if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new Error(`File extension not allowed: ${ext}`);
    }

    return ext;
}

/** Minimal interface for exif-reader output — covers the fields we actually access. */
interface ExifParamsRaw {
    FNumber?: number;
    ISO?: number;
    ISOSpeedRatings?: number;
    ExposureTime?: string | number;
    DateTimeOriginal?: unknown;
    LensModel?: string;
    FocalLength?: number;
    ColorSpace?: number;
    WhiteBalance?: string | number;
    MeteringMode?: string | number;
    ExposureBiasValue?: number;
    ExposureCompensation?: number;
    ExposureProgram?: string | number;
    Flash?: string | number;
    [key: string]: unknown;
}

interface ExifImageRaw {
    Model?: string;
    Make?: string;
    [key: string]: unknown;
}

interface ExifGpsRaw {
    GPSLatitude?: number[];
    GPSLatitudeRef?: string;
    GPSLongitude?: number[];
    GPSLongitudeRef?: string;
    [key: string]: unknown;
}

export interface ExifDataRaw {
    exif?: ExifParamsRaw;
    Photo?: ExifParamsRaw;
    image?: ExifImageRaw;
    Image?: ExifImageRaw;
    gps?: ExifGpsRaw;
    GPSInfo?: ExifGpsRaw;
    [key: string]: unknown;
}

function parseExifDateTime(value: unknown): string | null {
    if (typeof value === 'string') {
        // Common EXIF format: "YYYY:MM:DD HH:MM:SS" (no timezone info from camera).
        // Output directly as "YYYY-MM-DD HH:MM:SS" for MySQL DATETIME without
        // passing through new Date() which would interpret it as local time and
        // shift it by the server's timezone offset.
        const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
        if (match) {
            const [, year, month, day, hour, minute, second] = match;
            const y = Number(year), m = Number(month), d = Number(day);
            const h = Number(hour), mi = Number(minute), s = Number(second);
            if (isValidExifDateTimeParts(y, m, d, h, mi, s)) {
                return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
            }
        }
    }

    // Handle Date objects and numeric timestamps explicitly.
    // PP-BUG-1: exif-reader constructs Date objects by interpreting EXIF local-time
    // as server-local. Using UTC getters (getUTCHours etc.) then shifts by the
    // server's TZ offset — masked in Docker UTC but silently corrupts by +9h on
    // a JST NAS deployment. Use local-time getters instead: the EXIF datetime
    // IS the camera's local time, so getFullYear/getHours etc. return the
    // original components the Date was constructed from.
    // Run isValidExifDateTimeParts calendar validation (same as the string branch)
    // to reject out-of-range dates like year 2101+ that would pass the NaN check
    // but fail the 1900-2100 year range guard.
    const pad2 = (n: number) => String(n).padStart(2, '0');
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const y = value.getFullYear(), m = value.getMonth() + 1, d = value.getDate();
        const h = value.getHours(), mi = value.getMinutes(), s = value.getSeconds();
        if (isValidExifDateTimeParts(y, m, d, h, mi, s)) {
            return `${y}-${pad2(m)}-${pad2(d)} ${pad2(h)}:${pad2(mi)}:${pad2(s)}`;
        }
    }
    if (typeof value === 'number' && !Number.isNaN(value)) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
            const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
            const h = date.getHours(), mi = date.getMinutes(), s = date.getSeconds();
            if (isValidExifDateTimeParts(y, m, d, h, mi, s)) {
                return `${y}-${pad2(m)}-${pad2(d)} ${pad2(h)}:${pad2(mi)}:${pad2(s)}`;
            }
        }
    }

    // Return null instead of current date so images with unparsable EXIF dates
    // don't appear as "taken right now" in a chronologically-sorted gallery.
    return null;
}

// Default output sizes — shared with gallery-config-shared.ts for client components
const DEFAULT_OUTPUT_SIZES = DEFAULT_IMAGE_SIZES;

/**
 * Delete all sized variants for a given base filename deterministically.
 * Avoids expensive readdir on directories with thousands of files.
 * @param sizes Optional array of configured sizes. Defaults to DEFAULT_OUTPUT_SIZES.
 */
export async function deleteImageVariants(dir: string, baseFilename: string, sizes: number[] = DEFAULT_OUTPUT_SIZES) {
    const ext = path.extname(baseFilename);
    const name = path.basename(baseFilename, ext);
    const filesToDelete = new Set([
        baseFilename,
        ...sizes.map(size => `${name}_${size}${ext}`),
    ]);

    // Scan the directory only when sizes are unknown — this catches leftover
    // variants from a prior sizes config that no longer matches the current list.
    // When sizes are provided, all variant filenames are deterministic
    // ({name}_{size}{ext}) and are already in filesToDelete, so the scan
    // would just waste I/O on large directories.
    //
    // C3-F02: The sizes=[] path (called from deleteImage/deleteImages) triggers
    // a full directory scan on every deletion to catch orphans from prior configs.
    // After the first cleanup in a running process, subsequent scans are redundant
    // but low-cost at personal-gallery scale. A per-directory cleanup flag could
    // skip repeat scans, but would add state-tracking complexity.
    if (!sizes || sizes.length === 0) {
        try {
            const dirHandle = await fs.opendir(dir);
            try {
                for await (const entry of dirHandle) {
                    if (!entry.isFile()) continue;
                    if (entry.name.startsWith(`${name}_`) && entry.name.endsWith(ext)) {
                        filesToDelete.add(entry.name);
                    }
                }
            } finally {
                await dirHandle.close().catch(() => {});
            }
        } catch {
            // Best-effort cleanup — if the directory scan fails, fall back to the
            // known configured-size candidates above.
        }
    }

    await Promise.all(
        [...filesToDelete].map(f => fs.unlink(path.join(dir, f)).catch(() => {})),
    );
}

export interface ImageProcessingResult {
    id: string;
    filenameOriginal: string;
    filenameWebp: string;
    filenameAvif: string;
    filenameJpeg: string;
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
    exifData: ExifDataRaw;
    color_space?: string | null;
    blurDataUrl?: string | null;
    iccProfileName?: string | null;
    bitDepth?: number | null;
    colorPipelineDecision?: ColorPipelineDecision | null;
    colorSignals?: ColorSignals | null;
}

const MAX_DB_VARCHAR_BYTES = 255;

function clampUtf8Bytes(value: string, maxBytes: number = MAX_DB_VARCHAR_BYTES): string {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
        return value;
    }

    let output = '';
    let bytes = 0;
    for (const char of value) {
        const charBytes = Buffer.byteLength(char, 'utf8');
        if (bytes + charBytes > maxBytes) break;
        output += char;
        bytes += charBytes;
    }
    return output.trim();
}

function cleanMetadataString(value: unknown, maxBytes: number = MAX_DB_VARCHAR_BYTES): string | null {
    if (value === undefined || value === null) return null;
    const s = String(value).replace(/\0/g, '').trim();
    if (s.length === 0) return null;
    // Only reject literal 'undefined'/'null' strings when the input was not
    // already a string — prevents dropping legitimate EXIF metadata that
    // happens to be the word "null" or "undefined".
    if (typeof value !== 'string' && (s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null')) return null;
    return clampUtf8Bytes(s, maxBytes) || null;
}

/**
 * Resolve which ICC profile name to embed in AVIF derivatives given the source
 * ICC profile name (from extractIccProfileName).
 *
 * STRICT P3 DETECTION (CM-CRIT-1 fix). Only sources whose ICC actually IS
 * Display-P3 / P3-D65 / DCI-P3 are tagged 'p3'. Wider-gamut sources
 * (Adobe RGB, ProPhoto, Rec.2020) used to be falsely mapped to 'p3' here,
 * which made the AVIF encoder embed Apple's Display-P3 ICC over the
 * wider-gamut pixel values without any actual gamut conversion. The result
 * was visibly wrong color (washed-out greens, hue shifts) on every
 * ICC-aware browser.
 *
 * The encode chain in processImageFormats() now performs an explicit
 * .toColorspace('srgb') for non-P3 sources, so the right downstream tag
 * is 'srgb' too. Wider-than-P3 gamuts (Adobe RGB / ProPhoto / Rec.2020)
 * are gamut-clipped to sRGB at encode time. This is a knowing trade-off:
 * accurate-but-narrower colors today, in exchange for the option to add
 * a true wide-gamut path later (10-bit AVIF + actual ProPhoto-aware
 * conversion) without breaking existing assets.
 *
 * Decision matrix
 * ───────────────────────────────────────────────────────────────────────────
 * Source ICC name                 │ AVIF ICC output │ Rationale
 * ────────────────────────────────┼─────────────────┼──────────────────────
 * 'Display P3'                    │ p3              │ exact match
 * 'DCI-P3'                        │ p3              │ same primaries, D65 WP
 * 'P3-D65'                        │ p3              │ alias for Display P3
 * 'Display P3 - ACES'             │ p3              │ P3 gamut variant
 * 'sRGB IEC61966-2.1' / sRGB ICC  │ srgb            │ stays sRGB
 * 'Adobe RGB (1998)' / 'AdobeRGB' │ srgb            │ pixels converted to sRGB
 * 'ProPhoto RGB' / 'ProPhoto'     │ srgb            │ pixels converted to sRGB
 * 'ITU-R BT.2020' / 'Rec.2020'    │ srgb            │ pixels converted to sRGB
 * null / unknown                  │ srgb            │ safe default
 * ───────────────────────────────────────────────────────────────────────────
 *
 * WebP and JPEG derivatives are always sRGB for universal compatibility.
 *
 * @returns 'p3' | 'srgb'
 */
export type ColorPipelineDecision =
    | 'srgb'
    | 'srgb-from-unknown'
    | 'p3-from-displayp3'
    | 'p3-from-dcip3'
    | 'p3-from-adobergb'
    | 'p3-from-prophoto'
    | 'p3-from-rec2020';

/**
 * Resolve the color pipeline decision label for observability.
 * This is stored in `images.color_pipeline_decision` so operators can audit
 * wide-gamut coverage and unknown-profile rates.
 *
 * Decision matrix
 * ───────────────────────────────────────────────────────────────────────────
 * Source ICC name                 │ Decision          │ Rationale
 * ────────────────────────────────┼───────────────────┼──────────────────────
 * 'Display P3'                    │ p3-from-displayp3 │ exact match
 * 'DCI-P3'                        │ p3-from-dcip3     │ same primaries, DCI WP
 * 'P3-D65'                        │ p3-from-displayp3 │ alias for Display P3
 * 'Adobe RGB (1998)' / 'AdobeRGB' │ p3-from-adobergb  │ P3 gamut-mapped
 * 'ProPhoto RGB' / 'ProPhoto'     │ p3-from-prophoto  │ P3 gamut-mapped
 * 'ITU-R BT.2020' / 'Rec.2020'    │ p3-from-rec2020   │ P3 gamut-mapped
 * 'sRGB IEC61966-2.1' / sRGB ICC  │ srgb              │ exact match
 * null / unknown                  │ srgb-from-unknown │ safe default
 * ───────────────────────────────────────────────────────────────────────────
 */
export function resolveColorPipelineDecision(
    iccProfileName: string | null | undefined,
    signals?: { colorPrimaries?: string | null } | null,
): ColorPipelineDecision {
    if (!iccProfileName) {
        // P3-11: fall back to NCLX-derived primaries when ICC name is absent
        const primaries = signals?.colorPrimaries;
        if (primaries === 'p3-d65') return 'p3-from-displayp3';
        if (primaries === 'dci-p3') return 'p3-from-dcip3';
        if (primaries === 'adobergb') return 'p3-from-adobergb';
        if (primaries === 'prophoto') return 'p3-from-prophoto';
        if (primaries === 'bt2020') return 'p3-from-rec2020';
        if (primaries === 'bt709') return 'srgb';
        return 'srgb-from-unknown';
    }

    const name = iccProfileName.toLowerCase();

    if (name.includes('display p3') || name === 'p3-d65' || name.startsWith('p3-d65')) {
        return 'p3-from-displayp3';
    }
    if (name === 'dci-p3' || name.startsWith('dci-p3')) {
        return 'p3-from-dcip3';
    }
    if (name.includes('adobe rgb') || name.includes('adobergb')) {
        return 'p3-from-adobergb';
    }
    if (name.includes('prophoto')) {
        return 'p3-from-prophoto';
    }
    if (name.includes('rec.2020') || name.includes('bt.2020') || name.includes('rec2020') || name.includes('bt2020')) {
        return 'p3-from-rec2020';
    }
    if (name.includes('srgb')) {
        return 'srgb';
    }

    return 'srgb-from-unknown';
}

export type AvifIccDecision = 'p3' | 'p3-from-wide' | 'srgb';

/**
 * Resolve the OUTPUT ICC profile for AVIF derivatives.
 *
 * STRICT P3 DETECTION (CM-CRIT-1): only true Display-P3 sources get 'p3'.
 * Wider-than-P3 gamuts (Adobe RGB / ProPhoto / Rec.2020) now return
 * 'p3-from-wide' — the encoder converts pixels to P3 gamut with an
 * explicit pipelineColorspace('rgb16') resize before tagging as P3.
 *
 * This is a quality improvement over the previous sRGB clip: P3 preserves
 * more saturated colors than sRGB while still being deliverable to modern
 * displays and browsers.
 *
 * Decision matrix
 * ───────────────────────────────────────────────────────────────────────────
 * Source ICC name                 │ AVIF decision   │ Rationale
 * ────────────────────────────────┼─────────────────┼──────────────────────
 * 'Display P3'                    │ p3              │ exact match
 * 'DCI-P3'                        │ p3              │ same primaries, D65 WP
 * 'P3-D65'                        │ p3              │ alias for Display P3
 * 'Adobe RGB (1998)' / 'AdobeRGB' │ p3-from-wide    │ ProPhoto-aware → P3
 * 'ProPhoto RGB' / 'ProPhoto'     │ p3-from-wide    │ ProPhoto-aware → P3
 * 'ITU-R BT.2020' / 'Rec.2020'    │ p3-from-wide    │ Rec.2020-aware → P3
 * 'sRGB IEC61966-2.1' / sRGB ICC  │ srgb            │ stays sRGB
 * null / unknown                  │ srgb            │ safe default
 * ───────────────────────────────────────────────────────────────────────────
 */
export function resolveAvifIccProfile(
    iccProfileName: string | null | undefined,
    signals?: { colorPrimaries?: string | null } | null,
): AvifIccDecision {
    if (!iccProfileName) {
        // P3-11: fall back to NCLX-derived primaries when ICC name is absent
        const primaries = signals?.colorPrimaries;
        if (primaries === 'p3-d65' || primaries === 'dci-p3') return 'p3';
        if (primaries === 'adobergb' || primaries === 'prophoto' || primaries === 'bt2020') return 'p3-from-wide';
        if (primaries === 'bt709') return 'srgb';
        return 'srgb';
    }

    const name = iccProfileName.toLowerCase();

    // True P3 families — exact gamut match, no conversion needed.
    if (
        name.includes('display p3') ||
        name.includes('p3-d65') ||
        name === 'dci-p3' ||
        name.startsWith('dci-p3')
    ) {
        return 'p3';
    }

    // Wider-than-P3 gamuts — convert to P3 via rgb16 pipeline for best
    // color preservation. Smaller loss than clipping to sRGB.
    if (name.includes('adobe rgb') || name.includes('adobergb')) {
        return 'p3-from-wide';
    }
    if (name.includes('prophoto')) {
        return 'p3-from-wide';
    }
    if (name.includes('rec.2020') || name.includes('bt.2020') || name.includes('rec2020') || name.includes('bt2020')) {
        return 'p3-from-wide';
    }

    return 'srgb';
}


export async function saveOriginalAndGetMetadata(file: File): Promise<ImageProcessingResult> {
    if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    if (file.size === 0) {
        throw new Error('File is empty');
    }

    await ensureDirs();

    const originalExt = getSafeExtension(file.name);
    const id = randomUUID();
    const filenameOriginal = `${id}${originalExt}`;
    const filenameWebp = `${id}.webp`;
    const filenameAvif = `${id}.avif`;
    const filenameJpeg = `${id}.jpg`;

    // Stream to disk first to avoid materializing up to 200MB on the heap.
    const originalPath = path.join(UPLOAD_DIR_ORIGINAL, filenameOriginal);
    try {
        const webStream = file.stream();
        const nodeStream = Readable.fromWeb(webStream as import('stream/web').ReadableStream);
        await pipeline(nodeStream, createWriteStream(originalPath, { mode: 0o600 }));
    } catch {
        await fs.unlink(originalPath).catch(() => {});
        throw new Error('Failed to save uploaded file');
    }

    // CM-HIGH-3: failOn:'error' tolerates benign libvips warnings (legacy
    // EXIF blocks, JFIF mismatches) while still rejecting truncated input;
    // sequentialRead:true caps peak memory on large originals.
    // CM-HIGH-4: autoOrient:true applies EXIF Orientation pre-decode so
    // metadata().width/height reflect visual orientation and downstream
    // encoders write upright pixels with no orientation tag.
    const image = sharp(originalPath, { limitInputPixels: maxInputPixels, failOn: 'error', sequentialRead: true, autoOrient: true });

    let metadata: sharp.Metadata;
    try {
        metadata = await image.metadata();
    } catch (e) {
        console.error('Sharp metadata validation failed:', e);
        await fs.unlink(originalPath).catch(() => {});
        throw new Error('Invalid image file. Could not process the file as an image.');
    }

    let exifData: ExifDataRaw = {};
    if (metadata.exif) {
        try {
            exifData = exifReader(metadata.exif);
        } catch (e) {
            console.error('Error reading EXIF', e);
        }
    }

    const width = (metadata.width && metadata.width > 0) ? metadata.width : undefined;
    const height = (metadata.height && metadata.height > 0) ? metadata.height : undefined;
    if (!width || !height) {
        await fs.unlink(originalPath).catch(() => {});
        throw new Error('Image dimensions could not be determined — the file may be corrupt or in an unsupported format');
    }

    let blurDataUrl: string | null = null;
    try {
        const blurBuffer = await image.clone()
            .resize(16, undefined, { fit: 'inside' })
            .blur(2)
            .jpeg({ quality: 40 })
            .toBuffer();
        if (blurBuffer.length > 0) {
            // Cycle 4 RPF loop AGG4-L01: route the producer-side
            // literal through the central `assertBlurDataUrl` contract
            // so producer + consumer + reader all consult the same
            // validator. Without this the consumer-side validation in
            // `uploadImages` was the only validator in the
            // pipeline, which created a one-direction information
            // flow: a future MIME drift in this producer (e.g. to
            // AVIF/WebP) would silently write NULL `blur_data_url`
            // for every upload while the cycle-3 throttle masked the
            // breakage. Wrapping here closes the symmetry — the
            // happy path (16x16 q40 JPEG ~270-680 base64 chars) sits
            // comfortably inside MAX_BLUR_DATA_URL_LENGTH (4096), so
            // this is a no-op for valid producer output.
            const candidate = `data:image/jpeg;base64,${blurBuffer.toString('base64')}`;
            blurDataUrl = assertBlurDataUrl(candidate);
        }
    } catch {
        // Non-critical
    }

    const iccProfileName = extractIccProfileName(metadata.icc);

    // US-CM04: detect CICP-equivalent color signals for future HDR delivery.
    // P3-11: compute before pipeline decision so NCLX-derived primaries can
    // be used as fallback when ICC name is absent.
    const colorSignals = await detectColorSignals(originalPath, image, metadata);
    const colorPipelineDecision = resolveColorPipelineDecision(iccProfileName, colorSignals);

    // CM-LOW-1: Sharp's metadata.depth is a string union ('uchar', 'ushort',
    // 'float', etc.), not a numeric string. The pre-fix code did
    // parseInt('uchar', 10) → NaN → null, so the bit_depth column was
    // always empty. Map the documented string values to their bit count.
    const DEPTH_TO_BITS: Record<string, number> = {
        uchar: 8, char: 8,
        ushort: 16, short: 16,
        uint: 32, int: 32,
        float: 32, complex: 64,
        double: 64, dpcomplex: 128,
    };
    const bitDepth: number | null = (typeof metadata.depth === 'string' && metadata.depth in DEPTH_TO_BITS)
        ? DEPTH_TO_BITS[metadata.depth]
        : (typeof metadata.depth === 'number' && Number.isFinite(metadata.depth) ? metadata.depth : null);

    return {
        id,
        filenameOriginal,
        filenameWebp,
        filenameAvif,
        filenameJpeg,
        width,
        height,
        originalWidth: width,
        originalHeight: height,
        exifData,
        blurDataUrl,
        iccProfileName,
        bitDepth,
        colorPipelineDecision,
        colorSignals,
    };
}

export interface ImageQualitySettings {
    webp?: number;
    avif?: number;
    jpeg?: number;
}

export async function processImageFormats(
    inputPath: string,
    filenameWebp: string,
    filenameAvif: string,
    filenameJpeg: string,
    baseWidth: number, // The width from metadata
    quality?: ImageQualitySettings, // Admin-configured quality overrides
    sizes: number[] = DEFAULT_OUTPUT_SIZES, // Admin-configured output sizes
    iccProfileName?: string | null, // Source ICC profile name for AVIF P3 tagging
    forceSrgbDerivatives?: boolean, // US-CM02: when true, force sRGB on WebP/JPEG even for P3 sources
    signals?: { colorPrimaries?: string | null } | null, // P3-11: NCLX fallback for ICC-less sources
) {
    // Ensure sizes are sorted ascending so the last element is always the largest,
    // which is used as the "base" filename for backward compatibility.
    const sortedSizes = [...sizes].sort((a, b) => a - b);

    // CM-CRIT-1 / US-CM03: resolve the OUTPUT colorspace decision first so
    // WI-15 can cap source dimensions and WI-12 can detect DCI-P3 before
    // creating the Sharp instance.
    // P3-11: pass signals so NCLX-derived primaries fill in when ICC name is absent.
    const avifDecision = resolveAvifIccProfile(iccProfileName, signals);
    const isWideGamutSource = avifDecision === 'p3' || avifDecision === 'p3-from-wide';
    // The actual ICC profile to embed: always 'p3' for both P3 and p3-from-wide.
    const avifIcc: 'p3' | 'srgb' = isWideGamutSource ? 'p3' : 'srgb';

    // US-CM02: target colorspace for WebP and JPEG. When the source is wide
    // gamut (P3 or wider) and forceSrgbDerivatives is false (default), emit
    // P3-tagged derivatives so P3-capable browsers render the full gamut.
    const targetIcc: 'p3' | 'srgb' = (isWideGamutSource && !forceSrgbDerivatives) ? 'p3' : 'srgb';

    // WI-12: detect DCI-P3 sources for white-point adaptation.
    const isDciP3 = iccProfileName?.toLowerCase() === 'dci-p3' || iccProfileName?.toLowerCase().startsWith('dci-p3');

    // WI-15: cap source pixel count for wide-gamut to prevent OOM in rgb16 pipeline.
    // Sources exceeding 50MP are downscaled proportionally to an intermediate before fan-out.
    const WIDE_GAMUT_MAX_SOURCE_PIXELS = 50_000_000;
    let processingInputPath = inputPath;
    let processingBaseWidth = baseWidth;
    const inputMeta = await sharp(inputPath, { limitInputPixels: maxInputPixels, failOn: 'error', sequentialRead: true }).metadata();
    const baseHeight = (inputMeta.height && inputMeta.height > 0) ? inputMeta.height : 0;
    const basePixels = baseWidth * baseHeight;
    if (isWideGamutSource && basePixels > WIDE_GAMUT_MAX_SOURCE_PIXELS) {
        const scale = Math.sqrt(WIDE_GAMUT_MAX_SOURCE_PIXELS / basePixels);
        const targetWidth = Math.max(1, Math.round(baseWidth * scale));
        const tmpPath = inputPath + '.wi15.tmp';
        await sharp(inputPath, { limitInputPixels: maxInputPixels, failOn: 'error', sequentialRead: true, autoOrient: true })
            .resize({ width: targetWidth, withoutEnlargement: true })
            .toFile(tmpPath);
        processingInputPath = tmpPath;
        processingBaseWidth = targetWidth;
    }

    // Use file path so Sharp can mmap/stream instead of buffering on the heap.
    // CM-HIGH-3: failOn:'error' rejects truncated/corrupt input; sequentialRead:true
    // streams large files instead of random-access reading them.
    // CM-HIGH-4: autoOrient:true rotates/flips per EXIF Orientation before
    // resize so derivatives are always served upright with no orientation tag.
    const image = sharp(processingInputPath, { limitInputPixels: maxInputPixels, failOn: 'error', sequentialRead: true, autoOrient: true });
    const qualityWebp = quality?.webp ?? 90;
    const qualityAvif = quality?.avif ?? 85;
    const qualityJpeg = quality?.jpeg ?? 90;

    const generateForFormat = async (
        format: 'webp' | 'avif' | 'jpeg',
        dir: string,
        baseFilename: string,
    ) => {
        const ext = path.extname(baseFilename);
        const name = path.basename(baseFilename, ext);
        let lastRendered: { resizeWidth: number; filePath: string } | null = null;

        for (const size of sortedSizes) {
            // Don't upscale if original is smaller.
            const resizeWidth = processingBaseWidth < size ? processingBaseWidth : size;

            // Suffix based filename: id_2048.webp
            const sizedFilename = `${name}_${size}${ext}`;
            const outputPath = path.join(dir, sizedFilename);

            if (lastRendered && lastRendered.resizeWidth === resizeWidth) {
                // C4F-11: prefer hard link (zero-copy on same filesystem) over
                // copyFile for same-size variant dedup, matching the atomic
                // link pattern used for the base filename (line 507). Falls
                // back to copyFile on cross-device or link failure.
                try {
                    await fs.link(lastRendered.filePath, outputPath);
                } catch {
                    await fs.copyFile(lastRendered.filePath, outputPath);
                }
            } else {
                // CM-CRIT-1 / CM-HIGH-1: build per-format pipelines that
                // explicitly convert pixel values into the target colorspace
                // BEFORE encoding, then attach the matching ICC tag via
                // withIccProfile (CM-HIGH-2: ICC bit only — no EXIF leak).
                // CM-MED-2: pipelineColorspace('rgb16') runs the resize in
                // 16-bit linear-light space for wide-gamut sources, killing
                // the edge halos/desaturation that gamma-space resize
                // introduces. Only paid on the wide-gamut path because it
                // doubles peak RAM during resize.
                // WI-12: DCI-P3 sources skip rgb16 pipeline so the source ICC
                // profile (with DCI white point) is preserved for the
                // toColorspace('p3') transform, which then does the correct
                // Bradford adaptation to D65.
                // WI-14: rgb16 path uses a fresh sharp instance per format to
                // eliminate shared-state risk between parallel encodes.
                const needsRgb16 = isWideGamutSource && !isDciP3;
                const base = needsRgb16
                    ? sharp(processingInputPath, { limitInputPixels: maxInputPixels, failOn: 'error', sequentialRead: true, autoOrient: true })
                        .pipelineColorspace('rgb16')
                        .resize({ width: resizeWidth })
                    : image.clone().resize({ width: resizeWidth });

                if (format === 'webp') {
                    // US-CM02: P3-tagged when source is P3 and forceSrgbDerivatives
                    // is false (default). P3-capable browsers render full gamut;
                    // non-capable browsers safely fall back to sRGB clipping.
                    await base
                        .toColorspace(targetIcc)
                        .withIccProfile(targetIcc)
                        .webp({ quality: qualityWebp })
                        .toFile(outputPath);
                } else if (format === 'avif') {
                    // AVIF: P3-tagged only when SOURCE was actually P3
                    // (resolveAvifIccProfile returns 'p3' iff the source ICC
                    // is Display-P3 / P3-D65 / DCI-P3). For everything else
                    // we convert pixels to sRGB and tag accordingly.
                    // CM-MED-1 / PP-BUG-2: 10-bit AVIF for wide-gamut sources
                    // kills banding in skies/skin gradients. Gated on a lazy
                    // probe — first wide-gamut encode tries bitdepth:10; if
                    // the Sharp build rejects it, we downgrade to 8-bit for
                    // the process lifetime. 8-bit for sRGB sources keeps
                    // file sizes tight.
                    // CM-LOW-11: effort:6 squeezes ~10% off file size at
                    // ~30% extra CPU; encode time is amortized over many
                    // views on a self-hosted gallery.
                    const wantHighBitdepth = isWideGamutSource && await canUseHighBitdepthAvif();
                    try {
                        await base
                            .toColorspace(avifIcc)
                            .withIccProfile(avifIcc)
                            .avif({
                                quality: qualityAvif,
                                effort: 6,
                                ...(wantHighBitdepth ? { bitdepth: 10 } : {}),
                            })
                            .toFile(outputPath);
                    } catch (err: unknown) {
                        if (wantHighBitdepth && err instanceof Error && /bitdepth/i.test(err.message)) {
                            // Probe said 10-bit is available but this specific encode
                            // still failed — downgrade to 8-bit for this image only.
                            await base.clone()
                                .toColorspace(avifIcc)
                                .withIccProfile(avifIcc)
                                .avif({
                                    quality: qualityAvif,
                                    effort: 6,
                                })
                                .toFile(outputPath);
                        } else {
                            throw err;
                        }
                    }
                } else {
                    // US-CM02: P3-tagged when source is P3 and forceSrgbDerivatives
                    // is false (default), same as WebP above.
                    // CM-MED-3: wide-gamut sources benefit from 4:4:4 chroma
                    // subsampling regardless of target colorspace (the source
                    // gamut is wide even when forced to sRGB). sRGB sources stay
                    // at the Sharp default for tighter file sizes.
                    await base
                        .toColorspace(targetIcc)
                        .withIccProfile(targetIcc)
                        .jpeg({
                            quality: qualityJpeg,
                            ...(isWideGamutSource ? { chromaSubsampling: '4:4:4' as const } : {}),
                        })
                        .toFile(outputPath);
                }

                lastRendered = { resizeWidth, filePath: outputPath };
            }

            // The largest configured size serves as the "base" filename to satisfy existing schema.
            // Use atomic rename via .tmp file to eliminate the window where the base
            // filename doesn't exist (prevents 404s during concurrent reads).
            //
            // Fallback chain:
            //   1. hard link + rename (atomic, zero-copy on same filesystem)
            //   2. copyFile + rename (atomic if rename succeeds; covers cross-device link failure)
            //   3. direct copyFile (non-atomic — re-introduces the brief window where
            //      basePath is partially written; only reached on severely broken filesystems
            //      where both link and rename fail)
            if (size === sortedSizes[sortedSizes.length - 1]) {
                const basePath = path.join(dir, baseFilename);
                const tmpPath = basePath + '.tmp';
                try {
                    await fs.link(outputPath, tmpPath);
                    await fs.rename(tmpPath, basePath);
                } catch {
                    // Fallback: copy to tmp then rename (covers cross-device or link failure)
                    await fs.copyFile(outputPath, tmpPath).catch(() => {});
                    try {
                        await fs.rename(tmpPath, basePath);
                    } catch {
                        // Final fallback: direct copy if rename fails
                        // C6-AGG6R-11: warn so operators know the filesystem
                        // cannot do atomic rename — signals a severely broken
                        // filesystem that may need attention.
                        console.warn(`[process-image] Atomic rename fallback reached for ${basePath} — using non-atomic copyFile`);
                        await fs.copyFile(outputPath, basePath);
                    }
                } finally {
                    await fs.unlink(tmpPath).catch(() => {});
                }
            }
        }
    };

    try {
        // Generate all three formats in parallel
        await Promise.all([
            generateForFormat('webp', UPLOAD_DIR_WEBP, filenameWebp),
            generateForFormat('avif', UPLOAD_DIR_AVIF, filenameAvif),
            generateForFormat('jpeg', UPLOAD_DIR_JPEG, filenameJpeg),
        ]);

        // Verify all three output format base files are not empty
        const [webpStats, avifStats, jpegStats] = await Promise.all([
            fs.stat(path.join(UPLOAD_DIR_WEBP, filenameWebp)),
            fs.stat(path.join(UPLOAD_DIR_AVIF, filenameAvif)),
            fs.stat(path.join(UPLOAD_DIR_JPEG, filenameJpeg)),
        ]);
        if (webpStats.size === 0) throw new Error('Generated WebP file is empty');
        if (avifStats.size === 0) throw new Error('Generated AVIF file is empty');
        if (jpegStats.size === 0) throw new Error('Generated JPEG file is empty');
    } finally {
        // WI-15: clean up downscaled intermediate if one was created.
        if (processingInputPath !== inputPath) {
            await fs.unlink(processingInputPath).catch(() => {});
        }
    }
}

function cleanString(val: unknown): string | null {
    return cleanMetadataString(val);
}

/**
 * Normalize ExposureTime to a consistent rational form (e.g., "1/125").
 * Different cameras return ExposureTime as different types:
 * - Rational string: "1/125" (Nikon, Canon)
 * - Decimal number: 0.008 (some Sony, smartphone)
 * - exif-reader may return either depending on the EXIF IFD type
 *
 * This normalizes to the rational string form at storage time for
 * consistent display across camera brands.
 */
function normalizeExposureTime(val: unknown): string | null {
    if (val === undefined || val === null) return null;

    // If already a rational string like "1/125", clean and return as-is
    if (typeof val === 'string') {
        const cleaned = cleanMetadataString(val);
        if (!cleaned) return null;
        // Already in rational form
        if (/^\d+\/\d+$/.test(cleaned)) return cleaned;
        // Try parsing as decimal
        const num = Number(cleaned);
        if (Number.isFinite(num) && num > 0) {
            return decimalToRational(num);
        }
        return cleaned;
    }

    // Numeric value from EXIF
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
        return decimalToRational(val);
    }

    // Array form [numerator, denominator] from some EXIF readers
    if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'number' && typeof val[1] === 'number' && val[1] !== 0) {
        return `${val[0]}/${val[1]}`;
    }

    return cleanString(val);
}

function decimalToRational(val: number): string {
    if (val >= 1) return String(Math.round(val * 100) / 100);
    const denominator = Math.round(1 / val);
    if (denominator > 0 && Math.abs(1 / denominator - val) < 0.001) {
        return `1/${denominator}`;
    }
    return String(Math.round(val * 10000) / 10000);
}

function cleanNumber(val: unknown): number | null {
    if (val === undefined || val === null) return null;
    const v = Array.isArray(val) ? val[0] : val; // Handle arrays like [100]
    const n = Number(v);
    return !Number.isFinite(n) ? null : n;
}

export function extractExifForDb(exifData: ExifDataRaw) {
    // exif-reader returns top-level objects: image, thumbnail, exif, gps, interloper
    const exifParams = exifData.exif || exifData.Photo || {};
    const imageParams = exifData.image || exifData.Image || {};
    const gpsParams = exifData.gps || exifData.GPSInfo || {};

    const fNumber = exifParams.FNumber;
    const iso = exifParams.ISO ?? exifParams.ISOSpeedRatings;
    const exposureTime = exifParams.ExposureTime;

    const dateTimeOriginal = exifParams.DateTimeOriginal;

    let latitude: number | null = null;
    let longitude: number | null = null;

    if (gpsParams) {
        const convertDMSToDD = (dms: number[], ref: string, maxDegrees: number) => {
            if (!dms || dms.length < 3) return null;
            if (dms[0] < 0 || dms[0] > maxDegrees || dms[1] < 0 || dms[1] >= 60 || dms[2] < 0 || dms[2] >= 60) return null;
            let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
            if (ref === 'S' || ref === 'W') {
                dd = dd * -1;
            }
            if (Math.abs(dd) > maxDegrees) return null;
            return dd;
        };

        if (gpsParams.GPSLatitude && gpsParams.GPSLatitudeRef) {
            latitude = convertDMSToDD(gpsParams.GPSLatitude, gpsParams.GPSLatitudeRef, 90);
        }
        if (gpsParams.GPSLongitude && gpsParams.GPSLongitudeRef) {
            longitude = convertDMSToDD(gpsParams.GPSLongitude, gpsParams.GPSLongitudeRef, 180);
        }
    }

    return {
        capture_date: parseExifDateTime(dateTimeOriginal) ?? undefined,
        camera_model: cleanString(imageParams.Model) || undefined,
        lens_model: cleanString(exifParams.LensModel),
        iso: cleanNumber(iso),
        f_number: cleanNumber(fNumber),
        exposure_time: normalizeExposureTime(exposureTime),
        focal_length: cleanNumber(exifParams.FocalLength),
        latitude,
        longitude,
        color_space: (() => {
            // Colorspace tag (0xA001): 1 = sRGB, 65535 = Uncalibrated (often Adobe RGB or P3)
            const cs = exifParams.ColorSpace;
            if (cs === 1) return 'sRGB';

            // 65535 = Uncalibrated; actual profile determined by ICC parsing.
            if (cs === 65535) {
               return 'Uncalibrated';
            }

            return null;
        })(),

        white_balance: (() => {
            const wb = exifParams.WhiteBalance;
            if (wb === 0) return 'Auto';
            if (wb === 1) return 'Manual';
            return null;
        })(),

        metering_mode: (() => {
            const mm = exifParams.MeteringMode;
            const modes: Record<number, string> = {
                0: 'Unknown', 1: 'Average', 2: 'Center-weighted', 3: 'Spot',
                4: 'Multi-spot', 5: 'Multi-segment', 6: 'Partial'
            };
            return (typeof mm === 'number' ? modes[mm] : null) ?? null;
        })(),

        exposure_compensation: (() => {
            const ec = exifParams.ExposureBiasValue ?? exifParams.ExposureCompensation;
            if (ec === undefined || ec === null) return null;
            const val = Number(ec);
            if (!Number.isFinite(val)) return null;
            if (val === 0) return '0 EV';
            return `${val > 0 ? '+' : ''}${val.toFixed(1)} EV`;
        })(),

        exposure_program: (() => {
            const ep = exifParams.ExposureProgram;
            const programs: Record<number, string> = {
                0: 'Not Defined', 1: 'Manual', 2: 'Program AE', 3: 'Aperture Priority',
                4: 'Shutter Priority', 5: 'Creative', 6: 'Action', 7: 'Portrait', 8: 'Landscape'
            };
            return (typeof ep === 'number' ? programs[ep] : null) ?? null;
        })(),

        flash: (() => {
            const f = exifParams.Flash;
            if (f === undefined || f === null) return null;
            const val = typeof f === 'number' ? f : Number(f);
            if (!Number.isFinite(val)) return null;
            // Bit 0: fired, Bits 1-2: return, Bits 3-4: mode
            const fired = (val & 0x01) !== 0;
            const mode = (val >> 3) & 0x03;
            if (mode === 2) return fired ? 'Auto, Fired' : 'Auto, Not Fired';
            if (mode === 1) return 'Forced On';
            if (mode === 3) return 'Forced Off';
            return fired ? 'Fired' : 'Not Fired';
        })(),

        // Set from Sharp metadata in saveOriginalAndGetMetadata
        bit_depth: null as number | null,
    };
}

/**
 * PP-BUG-3: Best-effort strip GPS EXIF from the on-disk original file.
 *
 * The admin `strip_gps_on_upload` toggle previously only nulled the DB
 * latitude/longitude columns, leaving the original at
 * `data/uploads/original/` with intact GPS EXIF. The paid-download
 * endpoint streams that file byte-for-byte, leaking wildlife/conflict
 * photographers' protected locations.
 *
 * This function attempts to re-write the original in-place, using Sharp's
 * `.withMetadata({ orientation })` which keeps only the orientation tag
 * (and ICC if present) while stripping GPS, camera serial, etc. The
 * file is written to a temp path then atomically renamed over the
 * original so concurrent readers never see a partial write.
 *
 * Best-effort only: if Sharp throws (corrupt file, unsupported format,
 * disk full), the function catches the error and returns without modifying
 * the original. The DB columns are already nulled, so the public gallery
 * does not leak GPS; only the download-original path remains at risk.
 */
export async function stripGpsFromOriginal(filePath: string): Promise<void> {
    const tmpPath = filePath + '.gps-strip.' + randomUUID() + '.tmp';
    try {
        // Read orientation from the original so we can preserve it.
        const meta = await sharp(filePath).metadata();
        const orientation = typeof meta.orientation === 'number' && meta.orientation >= 1 && meta.orientation <= 8
            ? meta.orientation : 1;

        await sharp(filePath)
            .withMetadata({ orientation })
            .toFile(tmpPath);

        await fs.rename(tmpPath, filePath);
    } catch (e) {
        // Best-effort cleanup of temp file
        await fs.unlink(tmpPath).catch(() => {});
        // Non-fatal: log and continue. The DB columns are already nulled,
        // and the derivatives (which are what the public gallery serves)
        // already have no GPS. Only the download-original path leaks, and
        // failing the upload entirely would be worse.
        console.error('stripGpsFromOriginal: failed to strip GPS from original', { filePath, err: e });
    }
}
