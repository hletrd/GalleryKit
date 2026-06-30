import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSrc = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('cycle 52 source contracts', () => {
    it('shows operator-enabled production semantic search as active in admin settings', () => {
        const page = readSrc('app/[locale]/admin/(protected)/settings/page.tsx');
        const client = readSrc('app/[locale]/admin/(protected)/settings/settings-client.tsx');
        const settingsAction = readSrc('app/actions/settings.ts');
        const uiState = readSrc('lib/semantic-search-settings-ui.ts');

        expect(page).toContain("import { resolveSemanticSearchMode } from '@/lib/gallery-config-shared'");
        expect(page).toContain('resolvedSemanticSearchMode={resolveSemanticSearchMode(');
        expect(page).toContain("process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] === 'true'");

        expect(client).toContain('resolvedSemanticSearchMode: SemanticSearchMode');
        expect(client).toContain("const hasStoredSemanticProduction = settings.semantic_search_mode === 'production'");
        expect(client).toContain("const isSemanticProductionActive = hasStoredSemanticProduction && resolvedSemanticSearchMode === 'production'");
        expect(client).toContain('getSemanticSearchSelectValue(settings.semantic_search_mode, resolvedSemanticSearchMode)');
        expect(client).toContain('getWritableSemanticSearchModeFromSelect(value)');
        expect(client).toContain('<SelectItem value="production" disabled>');
        expect(client).toContain('<SelectItem value={STORED_SEMANTIC_PRODUCTION_INACTIVE} disabled>');
        expect(client).toContain("t('settings.semanticSearchModeProductionActive')");
        expect(client).toContain("t('settings.semanticSearchModeProductionInactive')");
        expect(client).toContain("id=\"semantic-search-production-active\"");
        expect(client).toContain("t('settings.semanticSearchProductionActive')");
        expect(client).toContain("id=\"semantic-search-production-warning\"");
        expect(client).toContain("t('settings.semanticSearchProductionWarning')");

        expect(settingsAction).toContain("key === 'semantic_search_mode' && value === 'production'");
        expect(settingsAction).toContain("t('semanticSearchProductionUiUnsupported')");

        expect(uiState).toContain('export const STORED_SEMANTIC_PRODUCTION_INACTIVE');
        expect(uiState).toContain('return STORED_SEMANTIC_PRODUCTION_INACTIVE');
        expect(uiState).toContain("value === 'disabled' || value === 'stub'");
    });
});
