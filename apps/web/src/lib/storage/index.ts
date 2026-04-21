/**
 * Storage Backend Singleton
 *
 * Provides a singleton StorageBackend instance for the experimental
 * storage abstraction. The singleton can be switched in-process, but
 * the production upload / processing / serving paths still use direct
 * filesystem code and do not read from this module yet.
 *
 * NOTE: This storage backend is not yet wired into the live image pipeline.
 * Direct fs operations are still used for uploads, processing, and public
 * serving. Switching backends here only changes the singleton state for
 * code paths that explicitly call `getStorage()`; it does not migrate or
 * redirect the active gallery data path on its own.
 *
 * Usage (once integrated):
 *   import { getStorage } from '@/lib/storage';
 *   const storage = getStorage();
 *   await storage.writeBuffer('webp/foo.webp', buffer, 'image/webp');
 */

import type { StorageBackend } from './types';
import { LocalStorageBackend } from './local';

const storageKey = Symbol.for('gallerykit.storageBackend');

type StorageBackendType = 'local' | 'minio' | 's3';

interface StorageState {
    backend: StorageBackend;
    type: StorageBackendType;
    initialized: boolean;
    initPromise: Promise<void> | null;
}

function getGlobalState(): StorageState {
    const g = globalThis as typeof globalThis & { [storageKey]?: StorageState };
    if (!g[storageKey]) {
        const type: StorageBackendType = 'local';
        g[storageKey] = {
            backend: new LocalStorageBackend(),
            type,
            initialized: false,
            initPromise: null,
        };
    }
    return g[storageKey]!;
}

/**
 * Get the current storage backend instance.
 * Lazy-initializes on first call.
 */
export async function getStorage(): Promise<StorageBackend> {
    const state = getGlobalState();

    if (!state.initialized && !state.initPromise) {
        state.initPromise = state.backend.init().then(() => {
            state.initialized = true;
            state.initPromise = null;
        }).catch((err) => {
            state.initPromise = null;
            throw err;
        });
    }

    if (state.initPromise) {
        await state.initPromise;
    }

    return state.backend;
}

/**
 * Get the storage backend synchronously (without initialization).
 * Useful when you know init has already been called (e.g., after app startup).
 */
export function getStorageSync(): StorageBackend {
    return getGlobalState().backend;
}

/**
 * Validate that required environment variables are set for the given backend type.
 * Throws an error with a descriptive message if credentials are missing.
 */
function validateStorageCredentials(type: StorageBackendType): void {
    if (type === 's3') {
        const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
        const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
        if (!accessKeyId || !secretAccessKey) {
            throw new Error(
                'S3 credentials not configured. Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY environment variables.',
            );
        }
    } else if (type === 'minio') {
        const endpoint = process.env.MINIO_ENDPOINT?.trim() || process.env.S3_ENDPOINT?.trim();
        const accessKeyId = process.env.MINIO_ACCESS_KEY_ID?.trim() || process.env.S3_ACCESS_KEY_ID?.trim();
        const secretAccessKey = process.env.MINIO_SECRET_ACCESS_KEY?.trim() || process.env.S3_SECRET_ACCESS_KEY?.trim();
        if (!endpoint) {
            throw new Error(
                'MinIO endpoint not configured. Set MINIO_ENDPOINT (or S3_ENDPOINT) environment variable.',
            );
        }
        if (!accessKeyId || !secretAccessKey) {
            throw new Error(
                'MinIO credentials not configured. Set MINIO_ACCESS_KEY_ID and MINIO_SECRET_ACCESS_KEY (or S3_* equivalents) environment variables.',
            );
        }
    }
    // 'local' requires no credentials
}

/**
 * Switch the experimental storage backend type for callers that explicitly
 * use this abstraction. Disposes the old backend and creates a new one.
 * Rolls back on failure.
 */
export async function switchStorageBackend(type: StorageBackendType): Promise<void> {
    const state = getGlobalState();

    if (state.type === type && state.initialized) {
        return; // No change needed
    }

    // Validate credentials before attempting the switch
    validateStorageCredentials(type);

    // Save old backend for rollback on failure
    const oldBackend = state.backend;
    const oldType = state.type;
    const wasInitialized = state.initialized;

    // NOTE: Do NOT dispose the old backend until the new one is confirmed working.
    // If we dispose first and the new backend fails to init, the rollback would
    // restore a destroyed backend (e.g., S3Client.destroy() has been called),
    // causing all subsequent storage operations to fail until server restart.

    let newBackend: StorageBackend;
    switch (type) {
        case 'minio': {
            const { MinIOStorageBackend } = await import('./minio');
            newBackend = new MinIOStorageBackend();
            break;
        }
        case 's3': {
            const { S3StorageBackend } = await import('./s3');
            newBackend = new S3StorageBackend(undefined, 's3');
            break;
        }
        case 'local':
        default:
            newBackend = new LocalStorageBackend();
            break;
    }

    state.backend = newBackend;
    state.type = type;
    state.initialized = false;
    state.initPromise = null;

    // Initialize the new backend — roll back on failure
    try {
        await getStorage();
        console.log(`[Storage] Switched to ${type} backend`);
        // New backend is confirmed working — now safe to dispose the old one
        if (oldBackend.dispose) {
            await oldBackend.dispose().catch(err => {
                console.warn('[Storage] Failed to dispose old backend:', err);
            });
        }
    } catch (err) {
        // Roll back to the old backend so the app remains functional
        console.error(`[Storage] Failed to initialize ${type} backend, rolling back to ${oldType}:`, err);
        state.backend = oldBackend;
        state.type = oldType;
        state.initialized = wasInitialized;
        state.initPromise = null;
        throw err;
    }
}

/**
 * Get the current experimental-backend status (type and initialization state).
 */
export function getStorageBackendStatus(): { type: StorageBackendType; initialized: boolean } {
    const state = getGlobalState();
    return { type: state.type, initialized: state.initialized };
}

/**
 * Get the current backend type.
 */
export function getStorageBackendType(): StorageBackendType {
    return getGlobalState().type;
}

// Re-export types for convenience
export type { StorageBackend, StorageWriteResult, StorageObjectInfo, PresignedUrlOptions } from './types';
