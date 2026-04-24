import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(
    resolve(__dirname, '..', 'app', 'actions', 'images.ts'),
    'utf-8',
);

describe('image delete share/group revalidation guards', () => {
    it('selects direct share keys before deleting images', () => {
        expect(source).toMatch(/share_key:\s*images\.share_key/);
    });

    it('collects affected shared group keys through sharedGroupImages', () => {
        expect(source).toMatch(/from\(sharedGroupImages\)/);
        expect(source).toMatch(/innerJoin\(sharedGroups,\s*eq\(sharedGroupImages\.groupId,\s*sharedGroups\.id\)\)/);
    });

    it('revalidates direct share and group share routes', () => {
        expect(source).toMatch(/`\/s\/\$\{shareKey\}`/);
        expect(source).toMatch(/`\/g\/\$\{groupKey\}`/);
        expect(source).toMatch(/\.\.\.shareRevalidationPaths/);
    });
});
