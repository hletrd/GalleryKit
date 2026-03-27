import sharp from 'sharp';
import exifReader from 'exif-reader';

import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

const cpuCount = os.cpus()?.length ?? 1;
const maxConcurrency = Math.max(1, cpuCount - 2);
const envConcurrency = Number.parseInt(process.env.SHARP_CONCURRENCY ?? '', 10);
const sharpConcurrency = Number.isFinite(envConcurrency) && envConcurrency > 0
    ? Math.min(envConcurrency, maxConcurrency)
    : maxConcurrency;
// Limit libvips worker threads to keep the server responsive during conversions.
sharp.concurrency(sharpConcurrency);
// Cap total pixels to reduce decompression-bomb risk (override via env if needed).
const envMaxInputPixels = Number.parseInt(process.env.IMAGE_MAX_INPUT_PIXELS ?? '', 10);
const maxInputPixels = Number.isFinite(envMaxInputPixels) && envMaxInputPixels > 0
    ? envMaxInputPixels
    : 256 * 1024 * 1024;
// limitInputPixels is passed per-constructor call (Sharp 0.33+ API)

const UPLOAD_ROOT = (() => {
    // In Docker (prod), we might be in /app, so we need apps/web/public
    // In Dev, we might be in apps/web, so we need public
    const monorepoPath = path.join(process.cwd(), 'apps/web/public/uploads');
    const simplePath = path.join(process.cwd(), 'public/uploads');

    // We can't easily check 'existsSync' at top level easily without potentially slowing start
    // But for Docker specifically, we know the CWD is /app and structure is copied
    // Let's safe bet: if CWD ends in apps/web, use simplePath. Else try monorepoPath.

    // Better yet, let's just export a function or lazily evaluate if we want to be 100% sure,
    // but constants are easier.

    // Quick heuristic:
    if (process.cwd().endsWith('apps/web')) {
        return simplePath;
    }
    return monorepoPath;
})();

export const UPLOAD_DIR_ORIGINAL = path.join(UPLOAD_ROOT, 'original');
export const UPLOAD_DIR_WEBP = path.join(UPLOAD_ROOT, 'webp');
export const UPLOAD_DIR_AVIF = path.join(UPLOAD_ROOT, 'avif');
export const UPLOAD_DIR_JPEG = path.join(UPLOAD_ROOT, 'jpeg');

// Allowed image extensions (lowercase)
const ALLOWED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.avif', '.arw', '.heic', '.heif', '.tiff', '.tif', '.gif', '.bmp'
]);

// Maximum file size (200MB for RAW files)
const MAX_FILE_SIZE = 200 * 1024 * 1024;

// Ensure directories exist — only runs once (promise-based singleton to avoid races)
// Clears on failure so a transient error doesn't permanently break uploads.
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

// Sanitize and validate file extension.
// NOTE: ALLOWED_EXTENSIONS entries must only contain [a-z0-9.] characters
// since the sanitizer strips everything else.
function getSafeExtension(filename: string): string {
    let ext = path.extname(filename).toLowerCase();

    // Strip any non-alphanumeric characters except dot
    ext = ext.replace(/[^a-z0-9.]/g, '');

    // Validate against allowed extensions
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
        // Common EXIF format: "YYYY:MM:DD HH:MM:SS" (no timezone)
        const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
        if (match) {
            const [, year, month, day, hour, minute, second] = match;
            const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
            if (!Number.isNaN(date.getTime())) {
                return date.toISOString();
            }
        }
    }

    // Handle Date objects and numeric timestamps explicitly
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString();
    }
    if (typeof value === 'number' && !Number.isNaN(value)) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
            return date.toISOString();
        }
    }

    // Return null instead of current date so images with unparsable EXIF dates
    // don't appear as "taken right now" in a chronologically-sorted gallery.
    return null;
}

// Known output sizes — used by both processImageFormats and deleteImageVariants.
const OUTPUT_SIZES = [640, 1536, 2048, 4096];

/**
 * Delete all sized variants for a given base filename deterministically.
 * Avoids expensive readdir on directories with thousands of files.
 */
export async function deleteImageVariants(dir: string, baseFilename: string) {
    const ext = path.extname(baseFilename);
    const name = path.basename(baseFilename, ext);
    const filesToDelete = [
        baseFilename,
        ...OUTPUT_SIZES.map(size => `${name}_${size}${ext}`),
    ];
    await Promise.all(
        filesToDelete.map(f => fs.unlink(path.join(dir, f)).catch(() => {})),
    );
}

async function deleteByPrefix(dir: string, prefix: string) {
    // Deterministic deletion — try all allowed original extensions.
    // This is only called for the original/ directory when replacing an image.
    try {
        const allExts = Array.from(ALLOWED_EXTENSIONS);
        await Promise.all(
            allExts.map(ext => fs.unlink(path.join(dir, `${prefix}${ext}`)).catch(() => {})),
        );
    } catch {
        // Best-effort cleanup.
    }
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

export async function saveOriginalAndGetMetadata(
    file: File,
    options?: { id?: string }
): Promise<ImageProcessingResult> {
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    // Validate file size is not zero
    if (file.size === 0) {
        throw new Error('File is empty');
    }

    await ensureDirs();

    const buffer = Buffer.from(await file.arrayBuffer());

    // Use a single Sharp instance for validation, metadata, and blur generation
    const image = sharp(buffer, { limitInputPixels: maxInputPixels });

    // Validate the file is a valid image and get metadata in one shot
    let metadata: sharp.Metadata;
    try {
        metadata = await image.metadata();
    } catch (e) {
        console.error('Sharp metadata validation failed:', e);
        throw new Error('Invalid image file. Could not process the file as an image.');
    }

    const originalExt = getSafeExtension(file.name);
    const id = options?.id || randomUUID();
    const filenameOriginal = `${id}${originalExt}`;
    const filenameWebp = `${id}.webp`;
    const filenameAvif = `${id}.avif`;
    const filenameJpeg = `${id}.jpg`;

    if (options?.id) {
        await deleteByPrefix(UPLOAD_DIR_ORIGINAL, id);
    }

    // Save original
    await fs.writeFile(path.join(UPLOAD_DIR_ORIGINAL, filenameOriginal), buffer);

    // Parse EXIF
    let exifData: ExifDataRaw = {};
    if (metadata.exif) {
        try {
            exifData = exifReader(metadata.exif);
        } catch (e) {
            console.error('Error reading EXIF', e);
        }
    }

    // Default to 2048 if width is missing or 0 to avoid crash
    const width = (metadata.width && metadata.width > 0) ? metadata.width : 2048;
    // Ensure height is always a positive number so Next/Image does not throw
    const height = (metadata.height && metadata.height > 0) ? metadata.height : width;

    // Generate tiny blur placeholder using a clone of the single Sharp instance
    let blurDataUrl: string | null = null;
    try {
        const blurBuffer = await image.clone()
            .resize(16, undefined, { fit: 'inside' })
            .blur(2)
            .jpeg({ quality: 40 })
            .toBuffer();
        blurDataUrl = `data:image/jpeg;base64,${blurBuffer.toString('base64')}`;
    } catch {
        // Non-critical, skip blur placeholder
    }

    // Parse ICC profile name if available
    let iccProfileName: string | null = null;
    if (metadata.icc && metadata.icc.length > 132) {
        try {
            const icc = metadata.icc;
            const iccLen = icc.length;
            // ICC profile structure: 128-byte header, then tag table
            // Tag count at offset 128 (4 bytes, big-endian)
            const tagCount = Math.min(icc.readUInt32BE(128), 100);
            for (let i = 0; i < tagCount; i++) {
                const tagOffset = 132 + i * 12;
                if (tagOffset + 12 > iccLen) break;
                const tagSig = icc.subarray(tagOffset, tagOffset + 4).toString('ascii');
                if (tagSig === 'desc') {
                    const dataOffset = icc.readUInt32BE(tagOffset + 4);
                    if (dataOffset + 12 > iccLen) break;
                    // 'desc' type: 4 bytes type sig, 4 bytes reserved, 4 bytes count, then ASCII string
                    const descType = icc.subarray(dataOffset, dataOffset + 4).toString('ascii');
                    if (descType === 'desc') {
                        const strLen = Math.min(icc.readUInt32BE(dataOffset + 8), 1024);
                        const strStart = dataOffset + 12;
                        const strEnd = strStart + strLen - 1;
                        if (strEnd > iccLen || strStart >= strEnd) break;
                        const str = icc.subarray(strStart, strEnd).toString('ascii');
                        iccProfileName = str.trim();
                    } else if (descType === 'mluc') {
                        // Multi-localized Unicode: 4 bytes type, 4 bytes reserved, 4 bytes number of records
                        const numRecords = icc.readUInt32BE(dataOffset + 8);
                        if (numRecords > 0) {
                            if (dataOffset + 24 > iccLen) break;
                            const recOffset = icc.readUInt32BE(dataOffset + 16 + 4);
                            const recLen = Math.min(icc.readUInt32BE(dataOffset + 16), 1024);
                            const strStart = dataOffset + recOffset;
                            const strEnd = strStart + recLen;
                            if (strEnd > iccLen || strStart >= strEnd) break;
                            const str = icc.subarray(strStart, strEnd).toString('utf16le');
                            iccProfileName = str.replace(/\0/g, '').trim();
                        }
                    }
                    break;
                }
            }
        } catch {
            // ICC parsing is best-effort
        }
    }

    // Extract bit depth from Sharp metadata
    const bitDepth = metadata.depth ? (typeof metadata.depth === 'string' ? parseInt(metadata.depth, 10) : metadata.depth) : null;

    return {
        id,
        filenameOriginal,
        filenameWebp,
        filenameAvif,
        filenameJpeg,
        width,
        // Height defaults to width when missing to keep aspect ratio sane and avoid zero-dimension errors
        height,
        originalWidth: (metadata.width && metadata.width > 0) ? metadata.width : width,
        originalHeight: (metadata.height && metadata.height > 0) ? metadata.height : height,
        exifData,
        blurDataUrl,
        iccProfileName,
        bitDepth,
    };
}

export async function processImageFormats(
    inputPath: string,
    filenameWebp: string,
    filenameAvif: string,
    filenameJpeg: string,
    baseWidth: number // The width from metadata
) {
    // Use file path instead of buffer to let Sharp use native mmap/streaming,
    // avoiding a full copy of the image (up to 200MB) on the Node.js heap.
    const image = sharp(inputPath, { limitInputPixels: maxInputPixels });

    const sizes = OUTPUT_SIZES;

    const generateForFormat = async (
        format: 'webp' | 'avif' | 'jpeg',
        dir: string,
        baseFilename: string,
    ) => {
        const ext = path.extname(baseFilename);
        const name = path.basename(baseFilename, ext);
        let lastRendered: { resizeWidth: number; filePath: string } | null = null;

        for (const size of sizes) {
            // Don't upscale if original is smaller.
            const resizeWidth = baseWidth < size ? baseWidth : size;

            // Suffix based filename: id_2048.webp
            const sizedFilename = `${name}_${size}${ext}`;
            const outputPath = path.join(dir, sizedFilename);

            if (lastRendered && lastRendered.resizeWidth === resizeWidth) {
                await fs.copyFile(lastRendered.filePath, outputPath);
            } else {
                const sharpInstance = image.clone().resize({ width: resizeWidth }).keepIccProfile();

                if (format === 'webp') {
                    await sharpInstance.webp({ quality: 90 }).toFile(outputPath);
                } else if (format === 'avif') {
                    await sharpInstance.avif({ quality: 85 }).toFile(outputPath);
                } else {
                    await sharpInstance.jpeg({ quality: 90 }).toFile(outputPath);
                }

                lastRendered = { resizeWidth, filePath: outputPath };
            }

            // If this size is 2048, also save as the "base" filename to satisfy existing schema.
            // Prefer hard link (zero-copy); fall back to copyFile if the FS doesn't support links.
            if (size === 2048) {
                const basePath = path.join(dir, baseFilename);
                await fs.unlink(basePath).catch(() => {});
                try {
                    await fs.link(outputPath, basePath);
                } catch {
                    await fs.copyFile(outputPath, basePath);
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

    // Verify files exist and are not empty
    try {
        const stats = await fs.stat(path.join(UPLOAD_DIR_WEBP, filenameWebp));
        if (stats.size === 0) throw new Error('Generated WebP file is empty');
    } catch (e) {
        console.error('File verification failed:', e);
        throw new Error('Image processing failed: generated file could not be verified');
    }
}

// Helper to clean strings
function cleanString(val: unknown): string | null {
    if (val === undefined || val === null) return null;
    const s = String(val).trim();
    if (s.length === 0 || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') return null;
    return s;
}

// Helper to clean numbers
function cleanNumber(val: unknown): number | null {
    if (val === undefined || val === null) return null;
    const v = Array.isArray(val) ? val[0] : val; // Handle arrays like [100]
    const n = Number(v);
    return !Number.isFinite(n) ? null : n;
}

// Helper to extract EXIF data for DB insertion
export function extractExifForDb(exifData: ExifDataRaw) {
    // exif-reader returns top-level objects: image, thumbnail, exif, gps, interloper
    // Standard tags are usually in 'exif' (e.g. FNumber, ISO, ExposureTime)
    // Model is often in 'image'

    // Fallbacks just in case
    const exifParams = exifData.exif || exifData.Photo || {};
    const imageParams = exifData.image || exifData.Image || {};
    const gpsParams = exifData.gps || exifData.GPSInfo || {};

    const fNumber = exifParams.FNumber;
    const iso = exifParams.ISO || exifParams.ISOSpeedRatings;
    const exposureTime = exifParams.ExposureTime;

    // DateTimeOriginal is usually in 'exif'
    const dateTimeOriginal = exifParams.DateTimeOriginal;

    let latitude: number | null = null;
    let longitude: number | null = null;

    if (gpsParams) {
        const convertDMSToDD = (dms: number[], ref: string) => {
            if (!dms || dms.length < 3) return null;
            let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
            if (ref === 'S' || ref === 'W') {
                dd = dd * -1;
            }
            return dd;
        };

        if (gpsParams.GPSLatitude && gpsParams.GPSLatitudeRef) {
            latitude = convertDMSToDD(gpsParams.GPSLatitude, gpsParams.GPSLatitudeRef);
        }
        if (gpsParams.GPSLongitude && gpsParams.GPSLongitudeRef) {
            longitude = convertDMSToDD(gpsParams.GPSLongitude, gpsParams.GPSLongitudeRef);
        }
    }

    return {
        capture_date: parseExifDateTime(dateTimeOriginal) ?? undefined,
        camera_model: cleanString(imageParams.Model) || undefined, // undefined to allow DB default if any, or null
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

            // If strictly 65535 or undefined, often indicates wide gamut or other profile.
            // We can try to look at Interop or other markers, but often 'Uncalibrated' with a profile is what we get for P3.
            // Some cameras write '65535' for P3.
            if (cs === 65535) {
               // Checking for P3 specifically is hard without parsing ICC profile fully,
               // but we can assume "Uncalibrated" usually implies something wider than sRGB in modern contexts (or AdobeRGB).
               // If we want to be more specific, we'd need to parse the ICC profile buffer from sharp metadata,
               // but exif-reader doesn't give us that easily here.
               // However, Apple devices often set "Uncalibrated" for Display P3.
               return 'Uncalibrated'; // 65535 = Uncalibrated; actual profile determined by ICC parsing below
            }

            return null;
        })(),

        // White Balance
        white_balance: (() => {
            const wb = exifParams.WhiteBalance;
            if (wb === 0) return 'Auto';
            if (wb === 1) return 'Manual';
            return null;
        })(),

        // Metering Mode
        metering_mode: (() => {
            const mm = exifParams.MeteringMode;
            const modes: Record<number, string> = {
                0: 'Unknown', 1: 'Average', 2: 'Center-weighted', 3: 'Spot',
                4: 'Multi-spot', 5: 'Multi-segment', 6: 'Partial'
            };
            return (typeof mm === 'number' ? modes[mm] : null) ?? null;
        })(),

        // Exposure Compensation
        exposure_compensation: (() => {
            const ec = exifParams.ExposureBiasValue ?? exifParams.ExposureCompensation;
            if (ec === undefined || ec === null) return null;
            const val = Number(ec);
            if (!Number.isFinite(val)) return null;
            if (val === 0) return '0 EV';
            return `${val > 0 ? '+' : ''}${val.toFixed(1)} EV`;
        })(),

        // Exposure Program
        exposure_program: (() => {
            const ep = exifParams.ExposureProgram;
            const programs: Record<number, string> = {
                0: 'Not Defined', 1: 'Manual', 2: 'Program AE', 3: 'Aperture Priority',
                4: 'Shutter Priority', 5: 'Creative', 6: 'Action', 7: 'Portrait', 8: 'Landscape'
            };
            return (typeof ep === 'number' ? programs[ep] : null) ?? null;
        })(),

        // Flash
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

        // Bit Depth — set from Sharp metadata in saveOriginalAndGetMetadata
        bit_depth: null as number | null,
    };
}
