import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const settingsSource = readFileSync(
    resolve(__dirname, '..', 'app', 'actions', 'settings.ts'),
    'utf-8',
);

describe('settings image_sizes locking', () => {
    it('tracks image-size changes explicitly before the existing-image guard', () => {
        const changeMarkIndex = settingsSource.indexOf("changedUploadProcessingKeys.add('image_sizes')");
        const guardIndex = settingsSource.indexOf("changedUploadProcessingKeys.has('image_sizes')");

        expect(changeMarkIndex).toBeGreaterThan(-1);
        expect(guardIndex).toBeGreaterThan(changeMarkIndex);
    });

    it('does not scope the lock check to processed images only', () => {
        const guardIndex = settingsSource.indexOf("changedUploadProcessingKeys.has('image_sizes')");
        const stripGpsGuardIndex = settingsSource.indexOf("changedUploadProcessingKeys.has('strip_gps_on_upload')");
        const imageSizesGuardBlock = settingsSource.slice(guardIndex, stripGpsGuardIndex);

        expect(guardIndex).toBeGreaterThan(-1);
        expect(stripGpsGuardIndex).toBeGreaterThan(guardIndex);
        expect(imageSizesGuardBlock).toMatch(/from\(images\)[\s\S]*\.limit\(1\)/);
        expect(imageSizesGuardBlock).not.toMatch(/images\.processed/);
    });
});
