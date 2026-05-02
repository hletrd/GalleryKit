// US-P41: Shared types for bulk metadata editor.
// This file has NO 'use server' directive so it can be imported by both
// server actions and client components.

export const LICENSE_TIERS = ['none', 'editorial', 'commercial', 'rm'] as const;
export type LicenseTier = (typeof LICENSE_TIERS)[number];

// Tri-state field descriptor: 'leave' = no change, 'set' = assign value, 'clear' = set NULL.
type FieldLeave = { mode: 'leave' };
type FieldSet<T> = { mode: 'set'; value: T };
type FieldClear = { mode: 'clear' };
export type TriState<T> = FieldLeave | FieldSet<T> | FieldClear;

export interface BulkUpdateImagesInput {
    ids: number[];
    topic: TriState<string>;
    titlePrefix: TriState<string>;
    description: TriState<string>;
    licenseTier: TriState<LicenseTier>;
    addTagNames: string[];
    removeTagNames: string[];
    // US-P52: copy alt_text_suggested → title or description (explicit admin action only)
    applyAltSuggested?: 'title' | 'description' | null;
}
