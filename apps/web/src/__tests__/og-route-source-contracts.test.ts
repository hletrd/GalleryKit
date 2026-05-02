import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, '..', 'app', 'api', 'og', 'route.tsx'), 'utf8');

describe('/api/og source contracts', () => {
    it('does not roll back the limiter after a DB-backed nonexistent-topic lookup', () => {
        expect(source).not.toContain('rollbackOgAttempt');
        expect(source).toContain("return new Response('Topic not found'");
    });
});
