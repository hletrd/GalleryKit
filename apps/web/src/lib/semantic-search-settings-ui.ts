import type { SemanticSearchMode } from './gallery-config-shared';

export const STORED_SEMANTIC_PRODUCTION_INACTIVE = 'stored-production-inactive';

export type SemanticSearchSelectValue =
    | 'disabled'
    | 'stub'
    | 'production'
    | typeof STORED_SEMANTIC_PRODUCTION_INACTIVE;

export function getSemanticSearchSelectValue(
    storedMode: string | undefined,
    resolvedMode: SemanticSearchMode,
): SemanticSearchSelectValue {
    if (storedMode === 'production' && resolvedMode === 'production') return 'production';
    if (storedMode === 'production') return STORED_SEMANTIC_PRODUCTION_INACTIVE;
    if (storedMode === 'stub') return 'stub';
    return 'disabled';
}

export function getWritableSemanticSearchModeFromSelect(value: string): 'disabled' | 'stub' | null {
    return value === 'disabled' || value === 'stub' ? value : null;
}
