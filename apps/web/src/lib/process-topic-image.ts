import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

// Cap total pixels to reduce decompression-bomb risk (override via env if needed).
const envMaxInputPixels = Number.parseInt(process.env.IMAGE_MAX_INPUT_PIXELS ?? '', 10);
const maxInputPixels = Number.isFinite(envMaxInputPixels) && envMaxInputPixels > 0
    ? envMaxInputPixels
    : 64 * 1024 * 1024;
// sharp.limitInputPixels(maxInputPixels);

const RESOURCES_ROOT = (() => {
    const monorepoPath = path.join(process.cwd(), 'apps/web/public/resources');
    const simplePath = path.join(process.cwd(), 'public/resources');
    if (process.cwd().endsWith('apps/web')) {
        return simplePath;
    }
    return monorepoPath;
})();

const RESOURCES_DIR = RESOURCES_ROOT;

// Allowed extensions
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

// Maximum file size (200MB for topic images)
const MAX_FILE_SIZE = 200 * 1024 * 1024;

// Ensure directory exists
const ensureDir = async () => {
    await fs.mkdir(RESOURCES_DIR, { recursive: true });
};

// Validate file extension
function isAllowedExtension(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ALLOWED_EXTENSIONS.has(ext);
}

export async function processTopicImage(file: File): Promise<string> {
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    // Validate file is not empty
    if (file.size === 0) {
        throw new Error('File is empty');
    }

    // Validate file extension
    if (!isAllowedExtension(file.name)) {
        throw new Error('File type not allowed');
    }

    await ensureDir();

    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate image by attempting to read metadata
    try {
        await sharp(buffer, { limitInputPixels: maxInputPixels }).metadata();
    } catch {
        throw new Error('Invalid image file');
    }

    const id = randomUUID();
    const filename = `${id}.webp`; // Convert everything to WebP for consistency
    const outputPath = path.join(RESOURCES_DIR, filename);

    // Resize to 512x512 max (cover), strip metadata, convert to WebP
    await sharp(buffer, { limitInputPixels: maxInputPixels })
        .resize({ width: 512, height: 512, fit: 'cover' })
        .webp({ quality: 90 })
        .toFile(outputPath);

    return filename;
}
