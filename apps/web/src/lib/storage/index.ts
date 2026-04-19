/**
 * Storage Backend Singleton
 *
 * Provides a singleton StorageBackend instance based on the
 * `storage_backend` admin setting. Re-initializes when the
 * setting changes.
 *
 * Usage:
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
 * Switch the storage backend type. Called when admin changes the setting.
 * Disposes the old backend and creates a new one.
 */
export async function switchStorageBackend(type: StorageBackendType): Promise<void> {
    const state = getGlobalState();

    if (state.type === type && state.initialized) {
        return; // No change needed
    }

    // Dispose old backend
    if (state.backend.dispose) {
        await state.backend.dispose().catch(err => {
            console.warn('[Storage] Failed to dispose old backend:', err);
        });
    }

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

    // Initialize the new backend
    await getStorage();

    console.log(`[Storage] Switched to ${type} backend`);
}

/**
 * Get the current backend type.
 */
export function getStorageBackendType(): StorageBackendType {
    return getGlobalState().type;
}

// Re-export types for convenience
export type { StorageBackend, StorageWriteResult, StorageObjectInfo, PresignedUrlOptions } from './types';
