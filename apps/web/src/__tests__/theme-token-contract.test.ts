import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('theme token contract', () => {
    const globals = readFileSync(resolve(__dirname, '../app/[locale]/globals.css'), 'utf8');
    const tailwind = readFileSync(resolve(__dirname, '../../tailwind.config.ts'), 'utf8');

    it('keeps Tailwind HSL channel variables compatible with emitted utilities', () => {
        expect(tailwind).toContain("primary: {\n                    DEFAULT: 'hsl(var(--primary))'");
        expect(tailwind).toContain("text: 'hsl(var(--destructive-text))'");
        expect(globals).not.toMatch(/--(?:primary|primary-foreground|accent|ring|destructive|destructive-text):\s*oklch\(/);
    });
});
