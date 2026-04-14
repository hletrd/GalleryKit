const DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

function parsePositiveIntEnv(name: string, fallback: number): number {
    const rawValue = process.env[name]?.trim();
    if (!rawValue) return fallback;
    const parsed = Number.parseInt(rawValue, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const MAX_TOTAL_UPLOAD_BYTES = parsePositiveIntEnv('UPLOAD_MAX_TOTAL_BYTES', DEFAULT_MAX_TOTAL_UPLOAD_BYTES);

export function formatUploadLimit(bytes: number): string {
    const gib = 1024 * 1024 * 1024;
    if (bytes % gib === 0) return `${bytes / gib}GB`;

    const mib = 1024 * 1024;
    if (bytes % mib === 0) return `${bytes / mib}MB`;

    return `${bytes} bytes`;
}

export const NEXT_UPLOAD_BODY_SIZE_LIMIT = `${Math.ceil(MAX_TOTAL_UPLOAD_BYTES / (1024 * 1024))}mb` as `${number}mb`;
