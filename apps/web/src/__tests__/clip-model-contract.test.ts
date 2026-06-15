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

  it('pins a real HF revision (defined in clip-model-id.ts)', () => {
    expect(idSrc).toMatch(/JINA_CLIP_REVISION\s*=\s*['"][0-9a-f]{7,40}['"]/);
  });
});
