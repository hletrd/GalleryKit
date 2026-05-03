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

const cpuCount = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus()?.length ?? 1;
const maxConcurrency = Math.max(1, cpuCount - 1);
const envConcurrency = Number.parseInt(process.env.SHARP_CONCURRENCY ?? '', 10);
const sharpConcurrency = Number.isFinite(envConcurrency) && envConcurrency > 0
    ? Math.min(envConcurrency, maxConcurrency)
    : maxConcurrency;
// Limit libvips worker threads to keep the server responsive during conversions.
sharp.concurrency(sharpConcurrency);
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

const ALLOWED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.avif', '.arw', '.heic', '.heif', '.tiff', '.tif', '.gif', '.bmp'
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
    // Run isValidExifDateTimeParts calendar validation (same as the string branch)
    // to reject out-of-range dates like year 2101+ that would pass the NaN check
    // but fail the 1900-2100 year range guard.
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const y = value.getUTCFullYear(), m = value.getUTCMonth() + 1, d = value.getUTCDate();
        const h = value.getUTCHours(), mi = value.getUTCMinutes(), s = value.getUTCSeconds();
        if (isValidExifDateTimeParts(y, m, d, h, mi, s)) {
            return value.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
        }
    }
    if (typeof value === 'number' && !Number.isNaN(value)) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
            const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, d = date.getUTCDate();
            const h = date.getUTCHours(), mi = date.getUTCMinutes(), s = date.getUTCSeconds();
            if (isValidExifDateTimeParts(y, m, d, h, mi, s)) {
                return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
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

// C3-AGG-02: Use TextDecoder for correct UTF-16BE decoding including
// surrogate pairs. The prior String.fromCharCode approach produced
// unpaired surrogates for supplementary Unicode characters (emoji,
// rare CJK) in ICC profile names.
function decodeUtf16BE(buffer: Buffer): string {
    return new TextDecoder('utf-16be').decode(buffer);
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
 * ICC profile name (from extractIccProfileName) and the EXIF ColorSpace tag.
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
 * 'Adobe RGB (1998)' / 'AdobeRGB' │ p3              │ wider than sRGB; P3
 *                                 │                 │ is the closest Sharp
 *                                 │                 │ named target that
 *                                 │                 │ covers the gamut
 * 'ProPhoto RGB' / 'ProPhoto'     │ p3              │ same reasoning
 * 'ITU-R BT.2020' / 'Rec.2020'   │ p3              │ same reasoning
 * null / unknown                  │ srgb            │ safe default
 * ───────────────────────────────────────────────────────────────────────────
 *
 * WebP and JPEG derivatives are always left at sRGB for universal
 * compatibility. Only AVIF is tagged with P3 because AVIF decoders in modern
 * browsers correctly honour embedded P3 ICC and tone-map accordingly.
 *
 * Sharp's withMetadata({ icc: 'p3' }) embeds Apple's Display P3 ICC profile,
 * which is the standard Display-P3 D65 target used by modern browsers.
 *
 * @returns 'p3' | 'srgb'
 */
export function resolveAvifIccProfile(iccProfileName: string | null | undefined): 'p3' | 'srgb' {
    if (!iccProfileName) return 'srgb';

    const name = iccProfileName.toLowerCase();

    // Explicit P3 families
    if (
        name.includes('display p3') ||
        name.includes('p3-d65') ||
        name === 'dci-p3' ||
        name.startsWith('dci-p3')
    ) {
        return 'p3';
    }

    // Wider-than-sRGB gamuts: AdobeRGB, ProPhoto, Rec.2020 — map to P3 as
    // the closest Sharp-supported named target that encompasses sRGB.
    if (
        name.includes('adobe rgb') ||
        name.includes('adobergb') ||
        name.includes('prophoto') ||
        name.includes('rec. 2020') ||
        name.includes('rec.2020') ||
        name.includes('bt.2020') ||
        name.includes('bt2020')
    ) {
        return 'p3';
    }

    return 'srgb';
}

export function extractIccProfileName(icc?: Buffer | null): string | null {
    if (!icc || icc.length <= 132) return null;

    try {
        const iccLen = icc.length;
        // ICC profile structure: 128-byte header, then tag table. Bound the
        // tag count so malformed profiles cannot force large loops.
        const tagCount = Math.min(icc.readUInt32BE(128), 100);
        for (let i = 0; i < tagCount; i++) {
            const tagOffset = 132 + i * 12;
            if (tagOffset + 12 > iccLen) break;
            const tagSig = icc.subarray(tagOffset, tagOffset + 4).toString('ascii');
            if (tagSig !== 'desc') continue;

            const dataOffset = icc.readUInt32BE(tagOffset + 4);
            const dataSize = icc.readUInt32BE(tagOffset + 8);
            if (dataOffset + 12 > iccLen || dataSize < 12 || dataOffset + dataSize > iccLen) break;

            const descType = icc.subarray(dataOffset, dataOffset + 4).toString('ascii');
            if (descType === 'desc') {
                const declaredLength = icc.readUInt32BE(dataOffset + 8);
                if (declaredLength === 0) break;
                const strLen = Math.min(declaredLength, dataSize - 12, 1024);
                const strStart = dataOffset + 12;
                const strEnd = strStart + Math.max(0, strLen - 1);
                if (strEnd > iccLen || strStart >= strEnd) break;
                return cleanMetadataString(icc.subarray(strStart, strEnd).toString('ascii'));
            }

            if (descType === 'mluc') {
                // Multi-localized Unicode: type/reserved, record count, record
                // size, then records. Text is UTF-16BE per ICC, not UTF-16LE.
                const numRecords = Math.min(icc.readUInt32BE(dataOffset + 8), 100);
                const recordSize = icc.readUInt32BE(dataOffset + 12);
                if (recordSize < 12) break;
                const recordsStart = dataOffset + 16;
                for (let recordIndex = 0; recordIndex < numRecords; recordIndex++) {
                    const recOffset = recordsStart + recordIndex * recordSize;
                    if (recOffset + 12 > iccLen || recOffset + 12 > dataOffset + dataSize) break;
                    const recLen = Math.min(icc.readUInt32BE(recOffset + 4), 1024);
                    const recTextOffset = icc.readUInt32BE(recOffset + 8);
                    const strStart = dataOffset + recTextOffset;
                    const strEnd = strStart + recLen;
                    if (strEnd > iccLen || strEnd > dataOffset + dataSize || strStart >= strEnd) continue;
                    const decoded = decodeUtf16BE(icc.subarray(strStart, strEnd));
                    const cleaned = cleanMetadataString(decoded);
                    if (cleaned) return cleaned;
                }
            }

            break;
        }
    } catch {
        // ICC parsing is best-effort.
    }

    return null;
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
    const image = sharp(originalPath, { limitInputPixels: maxInputPixels, failOn: 'error', sequentialRead: true });

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

    const rawBitDepth = metadata.depth ? (typeof metadata.depth === 'string' ? parseInt(metadata.depth, 10) : metadata.depth) : null;
    const bitDepth = (rawBitDepth !== null && Number.isFinite(rawBitDepth)) ? rawBitDepth : null;

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
) {
    // Ensure sizes are sorted ascending so the last element is always the largest,
    // which is used as the "base" filename for backward compatibility.
    const sortedSizes = [...sizes].sort((a, b) => a - b);

    // Use file path so Sharp can mmap/stream instead of buffering on the heap.
    // CM-HIGH-3: failOn:'error' rejects truncated/corrupt input; sequentialRead:true
    // streams large files instead of random-access reading them.
    const image = sharp(inputPath, { limitInputPixels: maxInputPixels, failOn: 'error', sequentialRead: true });
    const qualityWebp = quality?.webp ?? 90;
    const qualityAvif = quality?.avif ?? 85;
    const qualityJpeg = quality?.jpeg ?? 90;

    // Resolve the ICC profile to embed in AVIF derivatives. withMetadata({icc})
    // is a zero-cost flag — Sharp sets it at encode time with no extra decode pass.
    const avifIcc = resolveAvifIccProfile(iccProfileName);

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
            const resizeWidth = baseWidth < size ? baseWidth : size;

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
                const sharpInstance = image.clone().resize({ width: resizeWidth }).keepIccProfile();

                if (format === 'webp') {
                    await sharpInstance.webp({ quality: qualityWebp }).toFile(outputPath);
                } else if (format === 'avif') {
                    await sharpInstance
                        .withMetadata({ icc: avifIcc })
                        .avif({ quality: qualityAvif })
                        .toFile(outputPath);
                } else {
                    await sharpInstance.jpeg({ quality: qualityJpeg }).toFile(outputPath);
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

    // Generate all three formats in parallel
    await Promise.all([
        generateForFormat('webp', UPLOAD_DIR_WEBP, filenameWebp),
        generateForFormat('avif', UPLOAD_DIR_AVIF, filenameAvif),
        generateForFormat('jpeg', UPLOAD_DIR_JPEG, filenameJpeg),
    ]);

    // Verify all three output format base files are not empty
    try {
        const [webpStats, avifStats, jpegStats] = await Promise.all([
            fs.stat(path.join(UPLOAD_DIR_WEBP, filenameWebp)),
            fs.stat(path.join(UPLOAD_DIR_AVIF, filenameAvif)),
            fs.stat(path.join(UPLOAD_DIR_JPEG, filenameJpeg)),
        ]);
        if (webpStats.size === 0) throw new Error('Generated WebP file is empty');
        if (avifStats.size === 0) throw new Error('Generated AVIF file is empty');
        if (jpegStats.size === 0) throw new Error('Generated JPEG file is empty');
    } catch (e) {
        console.error('File verification failed:', e);
        throw new Error('Image processing failed: generated file could not be verified');
    }
}

function cleanString(val: unknown): string | null {
    return cleanMetadataString(val);
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
        exposure_time: cleanString(exposureTime),
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
