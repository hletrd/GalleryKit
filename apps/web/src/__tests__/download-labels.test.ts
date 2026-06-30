import { describe, expect, it } from 'vitest';
import { getJpegDownloadCopy } from '@/lib/download-labels';

describe('getJpegDownloadCopy', () => {
    it('labels wide-gamut default JPEG delivery as Display P3', () => {
        expect(getJpegDownloadCopy({
            isWideGamutSource: true,
            forceSrgbDerivatives: false,
        })).toEqual({
            labelKey: 'viewer.downloadP3Jpeg',
            descriptionKey: 'viewer.downloadP3JpegDesc',
        });
    });

    it('labels forced-sRGB wide-gamut JPEG delivery as sRGB', () => {
        expect(getJpegDownloadCopy({
            isWideGamutSource: true,
            forceSrgbDerivatives: true,
        })).toEqual({
            labelKey: 'viewer.downloadSrgbJpeg',
            descriptionKey: 'viewer.downloadSrgbJpegDesc',
        });
    });

    it('labels non-wide-gamut JPEG delivery as sRGB-compatible', () => {
        expect(getJpegDownloadCopy({
            isWideGamutSource: false,
            forceSrgbDerivatives: false,
        })).toEqual({
            labelKey: 'viewer.downloadSrgbJpeg',
            descriptionKey: 'viewer.downloadSrgbJpegDesc',
        });
    });
});
