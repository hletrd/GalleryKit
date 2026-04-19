/**
 * Storage Backend Interface
 *
 * Abstract interface for file storage operations. All gallery storage
 * goes through this interface so the backend (local, MinIO, S3) can
 * be swapped via admin settings without changing business logic.
 *
 * Key conventions:
 * - `key` is a relative path like `original/abc.jpg` or `webp/abc.webp`
 * - Backends handle their own prefix/bucket mapping internally
 * - Local backend keys map to `UPLOAD_ROOT/<key>`
 * - S3/MinIO backend keys map to `<bucket>/<key>`
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

/** Parameters for creating a presigned URL (S3/MinIO only). */
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
     * Get a public or presigned URL for a file.
     * For local backend this returns a relative path like `/uploads/jpeg/foo.jpg`.
     * For S3/MinIO this returns a presigned URL or public URL.
     */
    getUrl(key: string, options?: PresignedUrlOptions): Promise<string>;

    /**
     * Clean up resources (connections, etc.).
     */
    dispose?(): Promise<void>;
}
