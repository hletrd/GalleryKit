import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
    resolve(__dirname, '../app/[locale]/admin/(protected)/settings/settings-client.tsx'),
    'utf8',
);

describe('settings backfill warning persistence', () => {
    it('keeps a re-encode obligation visible after saving byte-impacting settings', () => {
        expect(SOURCE).toContain('const [hasSavedBackfillPending, setHasSavedBackfillPending] = useState(false)');
        expect(SOURCE).toContain('const backfillPendingBaselineRef = useRef<Record<string, string> | null>(null)');
        expect(SOURCE).toContain('function getEffectiveBackfillSettingValue(');
        expect(SOURCE).toContain("const defaultValue = defaults[key as GallerySettingKey] ?? ''");
        expect(SOURCE).toContain('const value = rawValue?.trim() ? rawValue : defaultValue');
        expect(SOURCE).toContain('const showBackfillRequired = hasExistingImages && (hasDirtyBackfillField || hasSavedBackfillPending)');
        expect(SOURCE).toContain('getEffectiveBackfillSettingValue(settings, defaults, key) !== getEffectiveBackfillSettingValue(baseline, defaults, key)');
        expect(SOURCE).toContain('const savedBackfillRelevantChange = Object.keys(changed).some((key) => COLOR_HDR_BACKFILL_KEYS.has(key))');
        expect(SOURCE).toContain('const previousBaseline = initialRef.current');
        expect(SOURCE.indexOf('const previousBaseline = initialRef.current')).toBeLessThan(
            SOURCE.indexOf('initialRef.current = nextSettings'),
        );
        expect(SOURCE).toContain('if (hasExistingImages && savedBackfillRelevantChange && !backfillPendingBaselineRef.current) {');
        expect(SOURCE).toContain('backfillPendingBaselineRef.current = previousBaseline');
        expect(SOURCE).toContain('const stillNeedsReencode = Array.from(COLOR_HDR_BACKFILL_KEYS).some(');
        expect(SOURCE).toContain('getEffectiveBackfillSettingValue(nextSettings, defaults, key) !== getEffectiveBackfillSettingValue(pendingBaseline, defaults, key)');
        expect(SOURCE).toContain('setHasSavedBackfillPending(stillNeedsReencode)');
        expect(SOURCE).toContain('backfillPendingBaselineRef.current = null');
        expect(SOURCE).toContain('{showBackfillRequired && (');
    });
});
