/**
 * Local Filesystem Storage Backend
 *
 * Stores public derivatives/resources under UPLOAD_ROOT and private originals
 * under UPLOAD_DIR_ORIGINAL.
 * This is the default backend and preserves backward compatibility.
 */

import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import type { StorageBackend, StorageWriteResult, StorageObjectInfo, PresignedUrlOptions } from './types';
import { UPLOAD_DIR_ORIGINAL, UPLOAD_ROOT, ensurePrivateOriginalUploadDirectory } from '@/lib/upload-paths';

// Singleton promise — clears on failure so transient errors don't permanently break uploads.
let dirsPromise: Promise<void> | null = null;

const REQUIRED_PUBLIC_DIRS = ['webp', 'avif', 'jpeg', 'resources'];

function normalizeStorageKey(key: string): string {
    const normalizedKey = key.trim().replace(/\\/g, '/');
    const segments = normalizedKey.split('/');
    if (
        normalizedKey.length === 0
        || normalizedKey.startsWith('/')
        || normalizedKey === '.'
        || normalizedKey === '..'
        || segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    ) {
        throw new Error(`Invalid storage key: ${key}`);
    }
    return segments.join('/');
}

export class LocalStorageBackend implements StorageBackend {
    readonly name = 'local';

    private resolve(key: string): { path: string; privateOriginal: boolean } {
        const normalizedKey = normalizeStorageKey(key);
        const privateOriginal = normalizedKey === 'original' || normalizedKey.startsWith('original/');
        if (normalizedKey === 'original') {
            throw new Error('Original storage keys must include a filename');
        }
        if (privateOriginal) {
            const relativeOriginalKey = normalizedKey.slice('original/'.length);
            const resolved = path.resolve(UPLOAD_DIR_ORIGINAL, relativeOriginalKey);
            if (!resolved.startsWith(path.resolve(UPLOAD_DIR_ORIGINAL) + path.sep)) {
                throw new Error(`Path traversal blocked: ${key}`);
            }
            return { path: resolved, privateOriginal: true };
        }
        // Prevent path traversal: normalize and ensure result stays within UPLOAD_ROOT
        const resolved = path.resolve(UPLOAD_ROOT, normalizedKey);
        if (!resolved.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
            throw new Error(`Path traversal blocked: ${key}`);
        }
        return { path: resolved, privateOriginal: false };
    }

    async init(): Promise<void> {
        if (!dirsPromise) {
            dirsPromise = Promise.all([
                ensurePrivateOriginalUploadDirectory(),
                ...REQUIRED_PUBLIC_DIRS.map(dir => fs.mkdir(path.join(UPLOAD_ROOT, dir), { recursive: true })),
            ]).then(() => {}).catch((e) => {
                dirsPromise = null;
                throw e;
            });
        }
        return dirsPromise;
    }

    async writeStream(key: string, stream: Readable | import('stream/web').ReadableStream, contentType?: string): Promise<StorageWriteResult> {
        const resolved = this.resolve(key);
        const filePath = resolved.path;
        void contentType;
        // Ensure parent directory exists
        if (resolved.privateOriginal) {
            await ensurePrivateOriginalUploadDirectory();
        } else {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
        }

        const nodeStream = 'pipe' in stream
            ? stream as Readable
            : await import('stream').then(({ Readable: R }) => R.fromWeb(stream as import('stream/web').ReadableStream));

        const writeStream = createWriteStream(filePath, { mode: 0o600 });
        await pipeline(nodeStream, writeStream);

        const stats = await fs.stat(filePath).catch(() => null);
        return { key, size: stats?.size };
    }

    async writeBuffer(key: string, data: Buffer, contentType?: string): Promise<StorageWriteResult> {
        const resolved = this.resolve(key);
        const filePath = resolved.path;
        void contentType;
        if (resolved.privateOriginal) {
            await ensurePrivateOriginalUploadDirectory();
        } else {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
        }
        await fs.writeFile(filePath, data, { mode: 0o600 });
        return { key, size: data.length };
    }

    async readBuffer(key: string): Promise<Buffer> {
        return fs.readFile(this.resolve(key).path);
    }

    async createReadStream(key: string): Promise<Readable> {
        const filePath = this.resolve(key).path;
        // Verify file exists and is not a symlink
        const stats = await fs.lstat(filePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            throw new Error(`Not a regular file: ${key}`);
        }
        return createReadStream(filePath);
    }

    async stat(key: string): Promise<StorageObjectInfo> {
        try {
            const stats = await fs.stat(this.resolve(key).path);
            return { exists: true, size: stats.size };
        } catch {
            return { exists: false };
        }
    }

    async delete(key: string): Promise<void> {
        await fs.unlink(this.resolve(key).path).catch(() => {});
    }

    async deleteMany(keys: string[]): Promise<void> {
        await Promise.all(keys.map(k => this.delete(k)));
    }

    async copy(srcKey: string, destKey: string): Promise<void> {
        const srcPath = this.resolve(srcKey).path;
        const resolvedDest = this.resolve(destKey);
        const destPath = resolvedDest.path;
        if (resolvedDest.privateOriginal) {
            await ensurePrivateOriginalUploadDirectory();
        } else {
            await fs.mkdir(path.dirname(destPath), { recursive: true });
        }
        // Try hard link first (zero-copy), fall back to copy
        try {
            await fs.link(srcPath, destPath);
        } catch {
            await fs.copyFile(srcPath, destPath);
        }
    }

    async getUrl(key: string, options?: PresignedUrlOptions): Promise<string> {
        void options;
        const normalizedKey = normalizeStorageKey(key);
        if (normalizedKey === 'original' || normalizedKey.startsWith('original/')) {
            throw new Error('Private original uploads do not have public URLs');
        }
        // Local public files are served via the /uploads/[...path] route.
        return `/uploads/${normalizedKey.split('/').map(encodeURIComponent).join('/')}`;
    }
}
