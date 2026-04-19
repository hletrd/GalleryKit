/**
 * S3 / MinIO Storage Backend
 *
 * Uses the AWS SDK v3 S3 client. Works with any S3-compatible service
 * including AWS S3, MinIO, Cloudflare R2, etc.
 *
 * Configuration via environment variables:
 * - S3_ENDPOINT: Required for MinIO/R2 (e.g. http://minio:9000)
 * - S3_REGION: AWS region (default: us-east-1)
 * - S3_ACCESS_KEY_ID: Access key
 * - S3_SECRET_ACCESS_KEY: Secret key
 * - S3_BUCKET: Bucket name (default: gallery)
 * - S3_PUBLIC_URL: Optional public URL base for direct access
 *   (e.g. https://cdn.example.com/gallery). When set, getUrl()
 *   returns direct URLs instead of presigned URLs.
 * - S3_FORCE_PATH_STYLE: Set "true" for MinIO (default: auto-detected)
 */

import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
    CopyObjectCommand,
    CreateBucketCommand,
    HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { Readable } from 'stream';
import type { StorageBackend, StorageWriteResult, StorageObjectInfo, PresignedUrlOptions } from './types';

interface S3StorageConfig {
    endpoint?: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicUrl?: string;
    forcePathStyle?: boolean;
}

function getConfigFromEnv(): S3StorageConfig {
    const endpoint = process.env.S3_ENDPOINT?.trim();
    const region = process.env.S3_REGION?.trim() || 'us-east-1';
    const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim() || '';
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim() || '';
    const bucket = process.env.S3_BUCKET?.trim() || 'gallery';
    const publicUrl = process.env.S3_PUBLIC_URL?.trim();
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE?.trim() === 'true'
        || (endpoint ? !endpoint.includes('amazonaws.com') : false);

    return { endpoint, region, accessKeyId, secretAccessKey, bucket, publicUrl, forcePathStyle };
}

export class S3StorageBackend implements StorageBackend {
    readonly name: string;
    private client: S3Client;
    private bucket: string;
    private publicUrl?: string;

    constructor(config?: Partial<S3StorageConfig>, readonly label = 's3') {
        const resolved = { ...getConfigFromEnv(), ...config };
        this.name = label;
        this.bucket = resolved.bucket;
        this.publicUrl = resolved.publicUrl;

        this.client = new S3Client({
            endpoint: resolved.endpoint,
            region: resolved.region,
            credentials: {
                accessKeyId: resolved.accessKeyId,
                secretAccessKey: resolved.secretAccessKey,
            },
            forcePathStyle: resolved.forcePathStyle,
        });
    }

    async init(): Promise<void> {
        // Ensure bucket exists (idempotent)
        try {
            await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        } catch {
            try {
                await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
                console.log(`[Storage:${this.name}] Created bucket: ${this.bucket}`);
            } catch (createErr) {
                console.error(`[Storage:${this.name}] Failed to create bucket ${this.bucket}:`, createErr);
                throw createErr;
            }
        }
    }

    async writeStream(key: string, stream: Readable | import('stream/web').ReadableStream, contentType?: string): Promise<StorageWriteResult> {
        // S3 PutObject requires the full body; collect from stream
        const chunks: Uint8Array[] = [];
        const nodeStream = 'pipe' in stream
            ? stream as Readable
            : await import('stream').then(({ Readable: R }) => R.fromWeb(stream as import('stream/web').ReadableStream));

        for await (const chunk of nodeStream) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const body = Buffer.concat(chunks);

        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
        }));

        return { key, size: body.length };
    }

    async writeBuffer(key: string, data: Buffer, contentType?: string): Promise<StorageWriteResult> {
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: data,
            ContentType: contentType,
        }));

        return { key, size: data.length };
    }

    async readBuffer(key: string): Promise<Buffer> {
        const response = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }));

        if (!response.Body) throw new Error(`Empty response for key: ${key}`);

        // Collect stream into buffer
        const chunks: Uint8Array[] = [];
        for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }

    async createReadStream(key: string): Promise<Readable> {
        const response = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }));

        if (!response.Body) throw new Error(`Empty response for key: ${key}`);

        // AWS SDK returns a web ReadableStream; convert to Node Readable
        const { Readable } = await import('stream');
        return Readable.fromWeb(response.Body as unknown as import('stream/web').ReadableStream);
    }

    async stat(key: string): Promise<StorageObjectInfo> {
        try {
            const result = await this.client.send(new HeadObjectCommand({
                Bucket: this.bucket,
                Key: key,
            }));
            return { exists: true, size: result.ContentLength };
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'NotFound') {
                return { exists: false };
            }
            if (err instanceof Error && '$metadata' in err && (err as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode === 404) {
                return { exists: false };
            }
            throw err;
        }
    }

    async delete(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        })).catch(() => {});
    }

    async deleteMany(keys: string[]): Promise<void> {
        // S3 supports batch delete but individual deletes in parallel are simpler
        // and sufficient for gallery workloads (usually <10 files per image)
        await Promise.all(keys.map(k => this.delete(k)));
    }

    async copy(srcKey: string, destKey: string): Promise<void> {
        await this.client.send(new CopyObjectCommand({
            Bucket: this.bucket,
            Key: destKey,
            CopySource: `${this.bucket}/${srcKey}`,
        }));
    }

    async getUrl(key: string, options?: PresignedUrlOptions): Promise<string> {
        // If a public URL base is configured, use direct access
        if (this.publicUrl) {
            const base = this.publicUrl.replace(/\/+$/, '');
            return `${base}/${key}`;
        }

        // Otherwise generate a presigned URL
        const expiresIn = options?.expiresIn || 3600;
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ...(options?.contentType && { ResponseContentType: options.contentType }),
        });

        return getSignedUrl(this.client, command, { expiresIn });
    }

    async dispose(): Promise<void> {
        this.client.destroy();
    }
}
