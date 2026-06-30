import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, '..', 'app', 'api', 'og', 'route.tsx'), 'utf8');

describe('/api/og source contracts', () => {
    it('does not roll back the limiter after a DB-backed nonexistent-topic lookup', () => {
        expect(source).not.toContain('rollbackOgAttempt');
        expect(source).toContain("return new Response('Topic not found'");
    });

    it('bounds topic tag query parsing before allocating tag arrays', () => {
        expect(source).toContain('MAX_OG_TAGS = 20');
        expect(source).toContain('MAX_OG_TAG_SOURCE_LENGTH = 2000');
        expect(source).toContain('parseOgTags(tags)');
        expect(source).not.toContain("tags.split(',').filter(Boolean).slice(0, 20)");
    });
});
