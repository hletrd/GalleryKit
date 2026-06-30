import { describe, expect, it } from 'vitest';

import {
    STORED_SEMANTIC_PRODUCTION_INACTIVE,
    getSemanticSearchSelectValue,
    getWritableSemanticSearchModeFromSelect,
} from '@/lib/semantic-search-settings-ui';

describe('semantic search Settings UI state', () => {
    it('shows operator-active production as a read-only production value', () => {
        expect(getSemanticSearchSelectValue('production', 'production')).toBe('production');
    });

    it('shows healed stored production as a distinct inactive sentinel', () => {
        expect(getSemanticSearchSelectValue('production', 'disabled')).toBe(STORED_SEMANTIC_PRODUCTION_INACTIVE);
        expect(getSemanticSearchSelectValue('production', 'stub')).toBe(STORED_SEMANTIC_PRODUCTION_INACTIVE);
    });

    it('keeps UI-supported stored values writable', () => {
        expect(getSemanticSearchSelectValue('stub', 'disabled')).toBe('stub');
        expect(getSemanticSearchSelectValue('disabled', 'disabled')).toBe('disabled');
        expect(getSemanticSearchSelectValue('', 'disabled')).toBe('disabled');
    });

    it('only allows supported UI modes to become Settings action payloads', () => {
        expect(getWritableSemanticSearchModeFromSelect('disabled')).toBe('disabled');
        expect(getWritableSemanticSearchModeFromSelect('stub')).toBe('stub');
        expect(getWritableSemanticSearchModeFromSelect('production')).toBeNull();
        expect(getWritableSemanticSearchModeFromSelect(STORED_SEMANTIC_PRODUCTION_INACTIVE)).toBeNull();
    });
});
