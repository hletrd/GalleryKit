/**
 * Storage Backend Interface
 *
 * Abstract interface for the experimental file-storage layer.
 *
 * Not all gallery storage currently goes through this interface: the live
 * upload, processing, and public-serving paths still use direct filesystem
 * helpers. Keep docs/comments aligned with that current reality until the
 * end-to-end pipeline is fully migrated.
 *
 * Key conventions:
 * - `key` is a relative path like `original/abc.jpg` or `webp/abc.webp`
 * - The current local backend maps keys to `UPLOAD_ROOT/<key>`
 * - Do not assume every upload/serve path uses this abstraction yet
 */

import type { Readable } from 'stream';

/** Metadata returned when writing a file. */
export interface StorageWriteResult {
    /** The storage key where the file was written. */
    key: string;
    /** Size in bytes (if known). */
    size?: number;
}

/** Info about a stored object. */
export interface StorageObjectInfo {
    /** Whether the object exists. */
    exists: boolean;
    /** Size in bytes. */
    size?: number;
}

/** Parameters for future signed/public URL implementations; local storage currently ignores these. */
export interface PresignedUrlOptions {
    /** How long the URL is valid, in seconds. Default: 3600 */
    expiresIn?: number;
    /** Response content-type override. */
    contentType?: string;
}

export interface StorageBackend {
    /** Human-readable name for logging. */
    readonly name: string;

    /** Ensure the storage is ready (create buckets, dirs, etc.). Called once on startup. */
    init(): Promise<void>;

    /**
     * Write a file from a Node.js Readable stream.
     * Used for upload pipeline (original files from browser).
     */
    writeStream(key: string, stream: Readable | import('stream/web').ReadableStream, contentType?: string): Promise<StorageWriteResult>;

    /**
     * Write a file from a Buffer.
     * Used by Sharp output pipeline.
     */
    writeBuffer(key: string, data: Buffer, contentType?: string): Promise<StorageWriteResult>;

    /**
     * Read a file as a Buffer.
     * Used for verification and small file access.
     */
    readBuffer(key: string): Promise<Buffer>;

    /**
     * Create a readable stream for a file.
     * Used by serve-upload.ts for streaming responses.
     */
    createReadStream(key: string): Promise<Readable>;

    /**
     * Check if a file exists and get its metadata.
     */
    stat(key: string): Promise<StorageObjectInfo>;

    /**
     * Delete a single file. Silently succeed if not found.
     */
    delete(key: string): Promise<void>;

    /**
     * Delete multiple files in parallel. Silently succeed for missing files.
     */
    deleteMany(keys: string[]): Promise<void>;

    /**
     * Copy a file within the same backend.
     * Used by Sharp pipeline for hardlink-equivalent behavior.
     */
    copy(srcKey: string, destKey: string): Promise<void>;

    /**
     * Get a public URL for a file.
     * For the current local backend this returns a relative path like `/uploads/jpeg/foo.jpg`.
     */
    getUrl(key: string, options?: PresignedUrlOptions): Promise<string>;

    /**
     * Clean up resources (connections, etc.).
     */
    dispose?(): Promise<void>;
}
