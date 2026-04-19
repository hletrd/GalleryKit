/**
 * MinIO Storage Backend
 *
 * Extends the S3 backend with MinIO-specific defaults.
 * MinIO is fully S3-compatible, so we just configure the endpoint
 * and force path-style access.
 *
 * Configuration via environment variables (same as S3, plus):
 * - MINIO_ENDPOINT: MinIO server URL (e.g. http://minio:9000)
 * - MINIO_ACCESS_KEY_ID: MinIO access key
 * - MINIO_SECRET_ACCESS_KEY: MinIO secret key
 * - MINIO_BUCKET: Bucket name (default: gallery)
 * - MINIO_PUBLIC_URL: Optional public URL (e.g. https://minio.example.com/gallery)
 *
 * Falls back to S3_* env vars if MINIO_* vars are not set.
 */

import { S3StorageBackend } from './s3';
import type { StorageBackend } from './types';

interface MinIOStorageConfig {
    endpoint?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucket?: string;
    publicUrl?: string;
}

function getMinIOConfigFromEnv(): MinIOStorageConfig {
    return {
        endpoint: process.env.MINIO_ENDPOINT?.trim() || process.env.S3_ENDPOINT?.trim(),
        region: process.env.MINIO_REGION?.trim() || process.env.S3_REGION?.trim() || 'us-east-1',
        accessKeyId: process.env.MINIO_ACCESS_KEY_ID?.trim() || process.env.S3_ACCESS_KEY_ID?.trim() || '',
        secretAccessKey: process.env.MINIO_SECRET_ACCESS_KEY?.trim() || process.env.S3_SECRET_ACCESS_KEY?.trim() || '',
        bucket: process.env.MINIO_BUCKET?.trim() || process.env.S3_BUCKET?.trim() || 'gallery',
        publicUrl: process.env.MINIO_PUBLIC_URL?.trim() || process.env.S3_PUBLIC_URL?.trim(),
    };
}

export class MinIOStorageBackend extends S3StorageBackend implements StorageBackend {
    constructor(config?: Partial<MinIOStorageConfig>) {
        const envConfig = getMinIOConfigFromEnv();
        const resolved = { ...envConfig, ...config };
        // MinIO always uses path-style addressing
        super(
            { ...resolved, forcePathStyle: true },
            'minio',
        );
    }
}
