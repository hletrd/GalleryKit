import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(resolve(__dirname, '../../scripts/generate-pwa-icons.ts'), 'utf8');

describe('generate-pwa-icons output contract', () => {
  it('writes icons through a sibling temp file before replacing tracked outputs', () => {
    expect(SOURCE).toContain('const tmpPath = resolve(iconsDir');
    expect(SOURCE).toContain('.toFile(tmpPath)');
    expect(SOURCE).toContain('renameSync(tmpPath, outPath)');
    expect(SOURCE).not.toContain('.toFile(outPath)');
  });
});
