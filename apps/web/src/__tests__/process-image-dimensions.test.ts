import { describe, expect, it, vi } from 'vitest';

/**
 * Test that saveOriginalAndGetMetadata rejects images with undetermined
 * dimensions rather than falling back to synthetic 2048x2048 values.
 *
 * C1-F01 / C1-TE-01: the previous 2048x2048 fallback stored misleading
 * dimensions that produced incorrect aspect ratios in the masonry grid
 * and photo viewer. The fix throws an error instead.
 */

// Mock sharp before importing the module under test
vi.mock('sharp', () => {
  const sharp = vi.fn();
  sharp.concurrency = vi.fn();
  sharp.limitInputPixels = vi.fn();
  return { default: sharp };
});

// Mock exif-reader
vi.mock('exif-reader', () => ({
  default: vi.fn(() => ({})),
}));

// Mock upload-paths
vi.mock('@/lib/upload-paths', () => ({
  UPLOAD_DIR_ORIGINAL: '/tmp/test/original',
  UPLOAD_DIR_WEBP: '/tmp/test/webp',
  UPLOAD_DIR_AVIF: '/tmp/test/avif',
  UPLOAD_DIR_JPEG: '/tmp/test/jpeg',
}));

// Mock gallery-config-shared
vi.mock('@/lib/gallery-config-shared', () => ({
  DEFAULT_IMAGE_SIZES: [640, 1536, 2048, 4096],
}));

// Mock exif-datetime
vi.mock('@/lib/exif-datetime', () => ({
  isValidExifDateTimeParts: () => true,
}));

// Mock blur-data-url
vi.mock('@/lib/blur-data-url', () => ({
  assertBlurDataUrl: (v: unknown) => v,
}));

// Mock stream/promises pipeline to bypass actual file streaming
vi.mock('stream/promises', () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

// Mock stream Readable.fromWeb to return a dummy node stream
vi.mock('stream', () => ({
  Readable: {
    fromWeb: vi.fn().mockReturnValue({}),
  },
}));

// Mock fs (sync) to provide createWriteStream without touching the filesystem
vi.mock('fs', () => ({
  createWriteStream: vi.fn().mockReturnValue({ on: vi.fn() }),
}));

import sharp from 'sharp';
import { saveOriginalAndGetMetadata } from '@/lib/process-image';
import fs from 'fs/promises';

function makeFile(name: string, size: number): File {
  return new File([new ArrayBuffer(size)], name, { type: 'image/jpeg' });
}

describe('saveOriginalAndGetMetadata dimension validation', () => {
  it('rejects images with zero width from Sharp metadata', async () => {
    const mockSharp = vi.mocked(sharp);
    const instance = {
      metadata: vi.fn().mockResolvedValue({ width: 0, height: 600, format: 'jpeg' }),
      clone: vi.fn().mockReturnThis(),
      resize: vi.fn().mockReturnThis(),
      blur: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('')),
    };
    mockSharp.mockReturnValue(instance as unknown as ReturnType<typeof sharp>);

    // Mock fs/promises functions
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined as unknown as string);
    vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);

    const file = makeFile('test.jpg', 1000);
    await expect(saveOriginalAndGetMetadata(file)).rejects.toThrow(
      'Image dimensions could not be determined',
    );
  });

  it('rejects images with undefined dimensions from Sharp metadata', async () => {
    const mockSharp = vi.mocked(sharp);
    const instance = {
      metadata: vi.fn().mockResolvedValue({ format: 'jpeg' }),
      clone: vi.fn().mockReturnThis(),
      resize: vi.fn().mockReturnThis(),
      blur: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('')),
    };
    mockSharp.mockReturnValue(instance as unknown as ReturnType<typeof sharp>);

    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined as unknown as string);
    vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);

    const file = makeFile('test.jpg', 1000);
    await expect(saveOriginalAndGetMetadata(file)).rejects.toThrow(
      'Image dimensions could not be determined',
    );
  });

  it('accepts images with valid positive dimensions', async () => {
    const mockSharp = vi.mocked(sharp);
    const instance = {
      metadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080, format: 'jpeg' }),
      clone: vi.fn().mockReturnThis(),
      resize: vi.fn().mockReturnThis(),
      blur: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('')),
    };
    mockSharp.mockReturnValue(instance as unknown as ReturnType<typeof sharp>);

    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined as unknown as string);

    const file = makeFile('test.jpg', 1000);
    const result = await saveOriginalAndGetMetadata(file);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });
});
