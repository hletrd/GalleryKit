import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, '..', 'components', 'image-zoom.tsx'), 'utf8');

describe('image-zoom source contracts (R2C10-MED-01)', () => {
    it('does not cast KeyboardEvent to MouseEvent in onKeyDown', () => {
        // The old buggy pattern: handleClick(e as unknown as React.MouseEvent)
        expect(source).not.toContain('handleClick(e as unknown as React.MouseEvent)');
    });

    it('uses a dedicated keyboard toggle handler instead of delegating to handleClick', () => {
        expect(source).toContain('handleKeyboardToggle');
        // The onKeyDown prop should invoke handleKeyboardToggle, not handleClick
        expect(source).toMatch(/onKeyDown=\{[^}]*handleKeyboardToggle/);
    });
});
