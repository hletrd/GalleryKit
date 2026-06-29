import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('clip-model module contract', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/clip-model.ts'), 'utf8');
  // The model-identity constants are DEFINED in clip-model-id.ts (a server-only-free
  // shim) so the tsx download script can import them too; clip-model.ts re-exports them.
  const idSrc = readFileSync(join(process.cwd(), 'src/lib/clip-model-id.ts'), 'utf8');

  it('exports async embedTextReal and embedImageReal', () => {
    expect(src).toMatch(/export async function embedTextReal\s*\(/);
    expect(src).toMatch(/export async function embedImageReal\s*\(/);
  });

  it('returns Matryoshka-512 normalized vectors (uses truncateAndNormalize)', () => {
    expect(src).toContain('truncateAndNormalize');
  });

  it('loads the model lazily as a singleton (cached promise)', () => {
    expect(src).toMatch(/let\s+\w*[Pp]romise|cached/);
  });

  it('reads weights from the CLIP_MODELS_ROOT volume, never bakes a path', () => {
    expect(src).toContain('CLIP_MODELS_ROOT');
  });

  it('forces 3-channel sRGB image preprocessing (defends the CHW channel invariant)', () => {
    expect(src).toMatch(/toColourspace|info\.channels/);
  });

  it('bounds queued CLIP inference waiters instead of retaining an unbounded array', () => {
    expect(src).toContain('CLIP_INFERENCE_MAX_PENDING');
    expect(src).toContain('CLIP_INFERENCE_QUEUE_TIMEOUT_MS');
    expect(src).toContain('ClipInferenceQueueFullError');
    expect(src).toContain('ClipInferenceQueueTimeoutError');
    expect(src).toMatch(/inferenceWaiters\.length\s*>=\s*CLIP_INFERENCE_MAX_PENDING/);
    expect(src).toMatch(/setTimeout\(\(\)\s*=>\s*\{[\s\S]*removeInferenceWaiter\(waiter\)/);
  });

  it('pins a real HF revision (defined in clip-model-id.ts)', () => {
    expect(idSrc).toMatch(/JINA_CLIP_REVISION\s*=\s*['"][0-9a-f]{7,40}['"]/);
  });

  // AGG-C10-FIX: clip-model.ts must NOT contain `import 'server-only'` because
  // tsx operator scripts (scripts/backfill-clip-embeddings.ts) import this module
  // at runtime under plain Node/tsx — where `server-only` resolves to its default
  // condition (index.js) and throws immediately, crashing the backfill before it
  // embeds anything. @/db/index.ts has the same constraint for the same reason.
  // Client-safety is instead enforced by the native sharp + @huggingface/transformers
  // imports, which the client-server-only-boundary test's hasNativeModuleImport()
  // detector catches if a client component ever incorrectly imports this module.
  it('must NOT contain `import "server-only"` — tsx backfill scripts import this module at runtime (AGG-C10-FIX)', () => {
    // Strip comments before matching so an explanatory comment that mentions the
    // absent import (e.g. "// NOTE: `import 'server-only'` is intentionally ABSENT")
    // does not false-positive. The actual statement form always appears outside comments.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/\/\/[^\n]*/g, '');       // line comments
    expect(stripped).not.toMatch(/\bimport\s+['"`]server-only['"`]/);
  });
});
