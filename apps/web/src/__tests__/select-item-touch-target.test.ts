import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(resolve(__dirname, '../components/ui/select.tsx'), 'utf8');

describe('Radix SelectItem touch target contract', () => {
    it('keeps custom select option rows at least 44 px tall', () => {
        const functionStart = SOURCE.indexOf('function SelectItem');
        expect(functionStart).toBeGreaterThanOrEqual(0);
        const functionEnd = SOURCE.indexOf('function SelectSeparator', functionStart);
        expect(functionEnd).toBeGreaterThan(functionStart);
        const selectItemSource = SOURCE.slice(functionStart, functionEnd);

        expect(selectItemSource).toContain('data-slot="select-item"');
        expect(selectItemSource).toContain('min-h-11');
    });

    it('keeps custom select scroll buttons at least 44 px tall', () => {
        for (const [name, nextName] of [
            ['SelectScrollUpButton', 'SelectScrollDownButton'],
            ['SelectScrollDownButton', 'export {'],
        ] as const) {
            const functionStart = SOURCE.indexOf(`function ${name}`);
            expect(functionStart, `${name} should exist`).toBeGreaterThanOrEqual(0);
            const functionEnd = SOURCE.indexOf(nextName === 'export {' ? nextName : `function ${nextName}`, functionStart + 1);
            expect(functionEnd, `${name} source should be bounded`).toBeGreaterThan(functionStart);
            const scrollButtonSource = SOURCE.slice(functionStart, functionEnd);

            expect(scrollButtonSource).toContain('min-h-11');
        }
    });
});
