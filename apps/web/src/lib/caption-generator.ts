/**
 * Caption generator for US-P52 (EXIF-derived auto alt-text hints).
 *
 * STUB IMPLEMENTATION: The full vision-captioning path is deferred because the
 * repo currently ships CLIP inference only; no captioning model weights or
 * captioning runner are wired into the runtime image.
 *
 * When `auto_alt_text_enabled` is true, this stub generates a deterministic
 * EXIF-derived hint string (e.g. "Photo taken with Canon EOS R5") rather than
 * running actual vision inference. This satisfies the schema, hook integration,
 * fallback resolver, and admin bulk-editor surfaces while adding no captioning
 * model weights or captioning-runner footprint.
 *
 * DEFERRED-FIX: Swap `generateCaptionStub` for real caption inference only after
 * a model, download script, runtime path, and operator runbook are added.
 */
import 'server-only';

export type { CaptionInput };

import { ALT_TEXT_STUB_PREFIX } from '@/lib/caption-constants';

interface CaptionInput {
    imageId: number;
    camera_model: string | null | undefined;
    capture_date: string | null | undefined;
}

const ALT_TEXT_MAX_CHARS = 140;

function truncateCodePoints(value: string, maxCodePoints: number): string {
    const chars = [...value];
    return chars.length <= maxCodePoints ? value : chars.slice(0, maxCodePoints).join('');
}

/**
 * STUB: Produce an EXIF-derived caption placeholder.
 * Real caption inference replaces this in a future cycle.
 */
function generateCaptionStub(input: CaptionInput): string {
    if (input.camera_model) {
        const raw = `${ALT_TEXT_STUB_PREFIX}Photo taken with ${input.camera_model}`;
        return truncateCodePoints(raw, ALT_TEXT_MAX_CHARS);
    }
    return `${ALT_TEXT_STUB_PREFIX}Photo`;
}

/**
 * Generate an alt-text suggestion for a processed image.
 *
 * Returns null when `autoAltTextEnabled` is false (default) — caption hook
 * is a no-op and alt_text_suggested stays NULL.
 *
 * Fire-and-forget: callers must NOT await this in the upload request path.
 * Always call as `generateCaption(input).catch(...)` after Sharp processing.
 */
export async function generateCaption(
    input: CaptionInput,
    autoAltTextEnabled: boolean,
): Promise<string | null> {
    if (!autoAltTextEnabled) {
        return null;
    }

    // STUB: real ONNX inference goes here in a future cycle.
    const caption = generateCaptionStub(input);
    return caption || null;
}
