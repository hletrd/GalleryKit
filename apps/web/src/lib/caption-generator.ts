/**
 * Caption generator for US-P52 (Auto alt-text via local Florence-2).
 *
 * STUB IMPLEMENTATION: The full ONNX Florence-2 inference is deferred because:
 *   1. The Florence-2-base ONNX model is multi-GB and requires an HF token download.
 *   2. onnxruntime-node adds ~150 MB of native binaries — deferred until real inference ships.
 *
 * When `auto_alt_text_enabled` is true, this stub generates a deterministic
 * EXIF-derived hint string (e.g. "Photo taken with Canon EOS R5") rather than
 * running actual vision inference. This satisfies the schema, hook integration,
 * fallback resolver, and admin bulk-editor surfaces while keeping the binary
 * footprint zero.
 *
 * DEFERRED-FIX: Swap `generateCaptionStub` for real ONNX inference once:
 *   - `onnxruntime-node` is added as a dependency
 *   - Florence-2-base ONNX weights are downloaded to data/models/florence2/
 *   - The download script (scripts/download-florence2.ts) is run by the operator
 */

export interface CaptionInput {
    imageId: number;
    camera_model: string | null | undefined;
    capture_date: string | null | undefined;
}

const ALT_TEXT_MAX_CHARS = 140;
const ALT_TEXT_STUB_PREFIX = '[AUTO] ';

/**
 * STUB: Produce an EXIF-derived caption placeholder.
 * Real ONNX Florence-2 inference replaces this in a future cycle.
 */
function generateCaptionStub(input: CaptionInput): string {
    if (input.camera_model) {
        const raw = `${ALT_TEXT_STUB_PREFIX}Photo taken with ${input.camera_model}`;
        return raw.length <= ALT_TEXT_MAX_CHARS ? raw : raw.slice(0, ALT_TEXT_MAX_CHARS);
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
