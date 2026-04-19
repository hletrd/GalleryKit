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

const cpuCount = os.cpus()?.length ?? 1;
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
            // Validate ranges
            const y = Number(year), m = Number(month), d = Number(day);
            const h = Number(hour), mi = Number(minute), s = Number(second);
            if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31
                && h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59) {
                return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
            }
        }
    }

    // Handle Date objects and numeric timestamps explicitly
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    }
    if (typeof value === 'number' && !Number.isNaN(value)) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
            return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
        }
    }

    // Return null instead of current date so images with unparsable EXIF dates
    // don't appear as "taken right now" in a chronologically-sorted gallery.
    return null;
}

// Default output sizes — used when no admin-configured sizes are provided.
const DEFAULT_OUTPUT_SIZES = [640, 1536, 2048, 4096];

/**
 * Delete all sized variants for a given base filename deterministically.
 * Avoids expensive readdir on directories with thousands of files.
 * @param sizes Optional array of configured sizes. Defaults to DEFAULT_OUTPUT_SIZES.
 */
export async function deleteImageVariants(dir: string, baseFilename: string, sizes: number[] = DEFAULT_OUTPUT_SIZES) {
    const ext = path.extname(baseFilename);
    const name = path.basename(baseFilename, ext);
    const filesToDelete = [
        baseFilename,
        ...sizes.map(size => `${name}_${size}${ext}`),
    ];
    await Promise.all(
        filesToDelete.map(f => fs.unlink(path.join(dir, f)).catch(() => {})),
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

    const image = sharp(originalPath, { limitInputPixels: maxInputPixels });

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

    const width = (metadata.width && metadata.width > 0) ? metadata.width : 2048;
    const height = (metadata.height && metadata.height > 0) ? metadata.height : width;

    let blurDataUrl: string | null = null;
    try {
        const blurBuffer = await image.clone()
            .resize(16, undefined, { fit: 'inside' })
            .blur(2)
            .jpeg({ quality: 40 })
            .toBuffer();
        if (blurBuffer.length > 0) {
            blurDataUrl = `data:image/jpeg;base64,${blurBuffer.toString('base64')}`;
        }
    } catch {
        // Non-critical
    }

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
        originalWidth: (metadata.width && metadata.width > 0) ? metadata.width : width,
        originalHeight: (metadata.height && metadata.height > 0) ? metadata.height : height,
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
) {
    // Use file path so Sharp can mmap/stream instead of buffering on the heap.
    const image = sharp(inputPath, { limitInputPixels: maxInputPixels });
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
                    await sharpInstance.webp({ quality: qualityWebp }).toFile(outputPath);
                } else if (format === 'avif') {
                    await sharpInstance.avif({ quality: qualityAvif }).toFile(outputPath);
                } else {
                    await sharpInstance.jpeg({ quality: qualityJpeg }).toFile(outputPath);
                }

                lastRendered = { resizeWidth, filePath: outputPath };
            }

            // The largest configured size serves as the "base" filename to satisfy existing schema.
            // Prefer hard link (zero-copy); fall back to copyFile if the FS doesn't support links.
            if (size === sizes[sizes.length - 1]) {
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
    if (val === undefined || val === null) return null;
    const s = String(val).trim();
    if (s.length === 0 || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') return null;
    return s;
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
