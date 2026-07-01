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
        expect(SOURCE).toContain('SETTINGS_BACKFILL_WARNING_KEY_SET');
        expect(SOURCE).toContain('hasBackfillRelevantDifference');
        expect(SOURCE).toContain('const showBackfillRequired = hasExistingImages && (hasDirtyBackfillField || hasSavedBackfillPending)');
        expect(SOURCE).toContain('const hasDirtyBackfillField = hasBackfillRelevantDifference(settings, baseline, defaults)');
        expect(SOURCE).toContain('const savedBackfillRelevantChange = Object.keys(changed).some((key) => SETTINGS_BACKFILL_WARNING_KEY_SET.has(key))');
        expect(SOURCE).toContain('backfillNoPipelineCandidatesSettingsOnly');
        expect(SOURCE).toContain('resolveSavedBackfillPendingTransition');
        expect(SOURCE).toMatch(/toast\.info\(hasSavedBackfillPending\s*\?\s*t\('settings\.backfillNoPipelineCandidatesSettingsOnly'\)\s*:\s*t\('settings\.backfillNothingToDo'\)\)/);
        expect(SOURCE).toContain('const previousBaseline = initialRef.current');
        expect(SOURCE.indexOf('const previousBaseline = initialRef.current')).toBeLessThan(
            SOURCE.indexOf('initialRef.current = nextSettings'),
        );
        expect(SOURCE).toContain('pendingBaseline: backfillPendingBaselineRef.current');
        expect(SOURCE).toContain('backfillPendingBaselineRef.current = backfillPending.pendingBaseline');
        expect(SOURCE).toContain('setHasSavedBackfillPending(backfillPending.hasSavedBackfillPending)');
        expect(SOURCE).toContain('{showBackfillRequired && (');
    });
});
