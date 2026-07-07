import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP_README = readFileSync(resolve(__dirname, '../../README.md'), 'utf8');
const CLAUDE = readFileSync(resolve(__dirname, '../../../../CLAUDE.md'), 'utf8');
const SCHEMA = readFileSync(resolve(__dirname, '../db/schema.ts'), 'utf8');
const MIGRATION_0012 = readFileSync(resolve(__dirname, '../../drizzle/0012_image_embeddings.sql'), 'utf8');

describe('semantic embedding storage contract', () => {
    it('keeps live docs honest that image_embeddings stores one active row per image', () => {
        expect(APP_README).toContain('one active row per `image_id`');
        expect(CLAUDE).toContain('one active row per `image_id`');
        expect(APP_README).not.toContain('one row per `(image_id, model_version)`');
        expect(CLAUDE).not.toContain('one row per `(image_id, model_version)`');
    });

    it('matches the current physical primary key until a composite-key migration exists', () => {
        expect(SCHEMA).toMatch(/imageId:\s*int\("image_id"\)\.primaryKey\(\)/);
        expect(MIGRATION_0012).toContain('PRIMARY KEY (`image_id`)');
        expect(MIGRATION_0012).not.toContain('PRIMARY KEY (`image_id`, `model_version`)');
    });
});
