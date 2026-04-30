# Plan 113 — MinIO/S3 Storage Backend Option (USER TODO #3)

**Created:** 2026-04-19
**Status:** PENDING
**Review findings:** ARCH-5-01 (finding #8)
**Priority:** HIGH

---

## Problem

All file I/O operations directly reference filesystem paths. There is no abstraction layer for storage operations. This makes it impossible to switch to MinIO/S3 without modifying every file that touches the storage layer.

## Architecture

### Storage Provider Interface

```typescript
interface StorageProvider {
  // Save data to storage
  save(key: string, data: Buffer | Readable): Promise<void>;

  // Read data from storage as a stream
  read(key: string): Promise<ReadableStream<Uint8Array>>;

  // Delete a file from storage
  delete(key: string): Promise<void>;

  // Check if a file exists
  exists(key: string): Promise<boolean>;

  // Get file metadata (size, lastModified)
  stat(key: string): Promise<{ size: number; lastModified: Date } | null>;

  // Get a public URL for a file (for S3/MinIO presigned URLs or local paths)
  getUrl(key: string): string;
}
```

### New Files

1. `apps/web/src/lib/storage/types.ts` — StorageProvider interface and types
2. `apps/web/src/lib/storage/local.ts` — LocalStorageProvider (current filesystem behavior)
3. `apps/web/src/lib/storage/minio.ts` — MinIOStorageProvider (MinIO backend)
4. `apps/web/src/lib/storage/s3.ts` — S3StorageProvider (S3-compatible backend)
5. `apps/web/src/lib/storage/index.ts` — Factory function to get active provider

### Modified Files

1. `apps/web/src/lib/process-image.ts` — Use StorageProvider for file I/O
2. `apps/web/src/lib/serve-upload.ts` — Use StorageProvider for serving files
3. `apps/web/src/lib/image-queue.ts` — Use StorageProvider for queue operations
4. `apps/web/src/app/actions/images.ts` — Use StorageProvider for upload/delete
5. `apps/web/docker-compose.yml` — Add MinIO service
6. `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` — Storage backend config UI
7. `apps/web/messages/en.json` — Storage settings translations
8. `apps/web/messages/ko.json` — Storage settings translations

## Implementation Steps

### Phase 1: Storage Abstraction (this cycle)

1. Create `StorageProvider` interface and `LocalStorageProvider`
2. Refactor `process-image.ts`, `serve-upload.ts`, `image-queue.ts`, and `actions/images.ts` to use `LocalStorageProvider`
3. Verify no behavior change (all tests pass, manual testing)

### Phase 2: MinIO Backend (this cycle)

4. Add MinIO service to `docker-compose.yml`
5. Create `MinIOStorageProvider` using the MinIO JS SDK
6. Add storage backend selection to admin settings
7. Add migration tool to move existing files to MinIO

### Phase 3: S3 Backend (future)

8. Create `S3StorageProvider` using AWS SDK
9. Add S3 option to admin settings

## Docker Compose MinIO Service

```yaml
minio:
  image: minio/minio:latest
  container_name: gallerykit-minio
  restart: always
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: ${MINIO_ROOT_USER:-gallerykit}
    MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-gallerykit123}
  ports:
    - "9000:9000"
    - "9001:9001"
  volumes:
    - ./data/minio:/data
```

## Storage Settings (added to Plan 112)

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `storage_backend` | string | "local" | Storage backend: "local", "minio", "s3" |
| `storage_minio_endpoint` | string | "" | MinIO endpoint URL |
| `storage_minio_bucket` | string | "gallerykit" | MinIO bucket name |
| `storage_minio_access_key` | string | "" | MinIO access key |
| `storage_minio_secret_key` | string | "" | MinIO secret key |
| `storage_s3_endpoint` | string | "" | S3 endpoint (for S3-compatible) |
| `storage_s3_bucket` | string | "" | S3 bucket name |
| `storage_s3_region` | string | "" | S3 region |
| `storage_s3_access_key` | string | "" | S3 access key ID |
| `storage_s3_secret_key` | string | "" | S3 secret access key |

## Verification

- Local storage provider works identically to current behavior
- MinIO provider can upload, read, delete, and stat files
- Admin settings allow switching between backends
- Docker compose starts MinIO alongside the web service
- Existing images are still served correctly after switching
