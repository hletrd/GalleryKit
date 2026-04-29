const DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
const DEFAULT_MAX_FILES_PER_WINDOW = 100;
export const MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024; // 200 MiB
export const MAX_RESTORE_FILE_BYTES = 250 * 1024 * 1024; // 250 MiB
export const SERVER_ACTION_BODY_OVERHEAD_BYTES = 16 * 1024 * 1024; // multipart overhead
const DEFAULT_SERVER_ACTION_UPLOAD_BODY_BYTES = Math.max(MAX_UPLOAD_FILE_BYTES, MAX_RESTORE_FILE_BYTES) + SERVER_ACTION_BODY_OVERHEAD_BYTES;

function parsePositiveIntEnv(name: string, fallback: number): number {
    const rawValue = process.env[name]?.trim();
    if (!rawValue) return fallback;
    const parsed = Number.parseInt(rawValue, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const MAX_TOTAL_UPLOAD_BYTES = parsePositiveIntEnv('UPLOAD_MAX_TOTAL_BYTES', DEFAULT_MAX_TOTAL_UPLOAD_BYTES);
export const UPLOAD_MAX_FILES_PER_WINDOW = parsePositiveIntEnv('UPLOAD_MAX_FILES_PER_WINDOW', DEFAULT_MAX_FILES_PER_WINDOW);
export const SERVER_ACTION_UPLOAD_BODY_BYTES = parsePositiveIntEnv('NEXT_UPLOAD_BODY_MAX_BYTES', DEFAULT_SERVER_ACTION_UPLOAD_BODY_BYTES);

export function formatUploadLimit(bytes: number): string {
    const gib = 1024 * 1024 * 1024;
    if (bytes % gib === 0) return `${bytes / gib}GB`;

    const mib = 1024 * 1024;
    if (bytes % mib === 0) return `${bytes / mib}MB`;

    return `${bytes} bytes`;
}

export const NEXT_SERVER_ACTION_BODY_SIZE_LIMIT = `${Math.ceil(SERVER_ACTION_UPLOAD_BODY_BYTES / (1024 * 1024))}mb` as `${number}mb`;
// Backwards-compatible alias for tests/imports that still refer to the framework transport cap.
export const NEXT_UPLOAD_BODY_SIZE_LIMIT = NEXT_SERVER_ACTION_BODY_SIZE_LIMIT;
