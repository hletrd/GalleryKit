import sharp from 'sharp';
import exifReader from 'exif-reader';

import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

const cpuCount = os.cpus()?.length ?? 1;
const maxConcurrency = Math.max(1, cpuCount - 2);
const envConcurrency = Number.parseInt(process.env.IMAGE_SHARP_CONCURRENCY ?? '', 10);
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
// sharp.limitInputPixels(maxInputPixels) - Removed in sharp 0.33+, passed in constructor instead

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

// Ensure directories exist
const ensureDirs = async () => {
    await fs.mkdir(UPLOAD_DIR_ORIGINAL, { recursive: true });
    await fs.mkdir(UPLOAD_DIR_WEBP, { recursive: true });
    await fs.mkdir(UPLOAD_DIR_AVIF, { recursive: true });
    await fs.mkdir(UPLOAD_DIR_JPEG, { recursive: true });
};

// Sanitize and validate file extension
function getSafeExtension(filename: string): string {
    // Get extension and convert to lowercase
    let ext = path.extname(filename).toLowerCase();

    // Remove any path traversal attempts
    ext = ext.replace(/[^a-z0-9.]/g, '');

    // Validate against allowed extensions
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new Error(`File extension not allowed: ${ext}`);
    }

    return ext;
}

function parseExifDateTime(value: unknown): string {
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

    const date = new Date(value as any);
    if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
    }

    return new Date().toISOString();
}

async function deleteByPrefix(dir: string, prefix: string) {
    try {
        const files = await fs.readdir(dir);
        await Promise.all(
            files
                .filter((f) => f.startsWith(prefix))
                .map((f) => fs.unlink(path.join(dir, f)).catch(() => {})),
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
    metadata: sharp.Metadata;
    exifData: any;
    color_space?: string | null;
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

    // Validate the file is a valid image by attempting to get metadata with Sharp
    try {
        await sharp(buffer, { limitInputPixels: maxInputPixels }).metadata();
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

    const image = sharp(buffer, { limitInputPixels: maxInputPixels });
    const metadata = await image.metadata();

    // Parse EXIF
    let exifData: any = {};
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
        metadata,
        exifData,
    };
}

export async function processImageFormats(
    buffer: Buffer,
    filenameWebp: string,
    filenameAvif: string,
    filenameJpeg: string,
    baseWidth: number // The width from metadata
) {
    const image = sharp(buffer, { limitInputPixels: maxInputPixels });

    // Sizes to generate
    const sizes = [640, 1536, 2048, 4096];

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
                const sharpInstance = image.clone().resize({ width: resizeWidth });

                if (format === 'webp') {
                    await sharpInstance.webp({ quality: 90 }).toFile(outputPath);
                } else if (format === 'avif') {
                    await sharpInstance.avif({ quality: 80 }).toFile(outputPath);
                } else {
                    await sharpInstance.jpeg({ quality: 90 }).toFile(outputPath);
                }

                lastRendered = { resizeWidth, filePath: outputPath };
            }

            // If this size is 2048, also save as the "base" filename to satisfy existing schema
            if (size === 2048) {
                await fs.copyFile(outputPath, path.join(dir, baseFilename));
            }
        }
    };

    const errors: unknown[] = [];
    for (const [format, dir, filename] of [
        ['webp', UPLOAD_DIR_WEBP, filenameWebp],
        ['avif', UPLOAD_DIR_AVIF, filenameAvif],
        ['jpeg', UPLOAD_DIR_JPEG, filenameJpeg],
    ] as const) {
        try {
            await generateForFormat(format, dir, filename);
        } catch (err) {
            errors.push(err);
        }
    }

    if (errors.length > 0) {
        throw errors[0];
    }

    // Verify files exist and are not empty
    try {
        const stats = await fs.stat(path.join(UPLOAD_DIR_WEBP, filenameWebp));
        if (stats.size === 0) throw new Error('Generated WebP file is empty');

        // Brief delay to ensure FS flush
        await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (e) {
        throw new Error(`File verification failed: ${e}`);
    }
}

// Helper to clean strings
function cleanString(val: any): string | null {
    if (val === undefined || val === null) return null;
    const s = String(val).trim();
    if (s.length === 0 || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') return null;
    return s;
}

// Helper to clean numbers
function cleanNumber(val: any): number | null {
    if (val === undefined || val === null) return null;
    if (Array.isArray(val)) val = val[0]; // Handle arrays like [100]
    const n = Number(val);
    return !Number.isFinite(n) ? null : n;
}

// Helper to extract EXIF data for DB insertion
export function extractExifForDb(exifData: any) {
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
        capture_date: parseExifDateTime(dateTimeOriginal),
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
               return 'Display P3'; // Heuristic for now, or just 'Uncalibrated' / 'Wide Gamut'
            }

            return null;
        })(),
    };
}
