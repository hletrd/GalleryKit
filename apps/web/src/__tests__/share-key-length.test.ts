import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

describe('public share key length contract', () => {
    it('rejects legacy short share keys on unauthenticated share lookups', () => {
        const source = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/data.ts'), 'utf8');

        expect(source).not.toContain('isBase56(trimmedKey, [5, 10])');
        expect(source).not.toContain('isBase56(trimmedKey, [6, 10])');
        expect(source.match(/isBase56\(trimmedKey, 10\)/g)?.length).toBeGreaterThanOrEqual(2);
    });
});
