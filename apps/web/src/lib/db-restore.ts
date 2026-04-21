export const MAX_RESTORE_SIZE_BYTES = 250 * 1024 * 1024; // 250 MB

export function formatBinarySize(bytes: number): string {
    const gib = 1024 * 1024 * 1024;
    if (bytes % gib === 0) {
        return `${bytes / gib} GB`;
    }

    const mib = 1024 * 1024;
    if (bytes % mib === 0) {
        return `${bytes / mib} MB`;
    }

    return `${bytes} bytes`;
}

export const MAX_RESTORE_SIZE_LABEL = formatBinarySize(MAX_RESTORE_SIZE_BYTES);

export function isIgnorableRestoreStdinError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error)) {
        return false;
    }

    const code = String((error as { code?: unknown }).code ?? '');
    return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}
