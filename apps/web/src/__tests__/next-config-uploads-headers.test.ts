/**
 * R4C6 ARCH-R4C6-06: one cache policy for image derivatives across every
 * layer that can serve them.
 *
 * Production evidence (run4-cycle6 review): public/ assets take
 * precedence over the app/uploads route handler, so Next's static
 * serving (default `public, max-age=0`) is what actually delivers
 * existing derivatives. The repo nginx config simultaneously declared
 * `immutable 1y` — unsafe against in-place backfill re-encodes — while
 * serve-upload.ts used `max-age=3600, must-revalidate`. These contracts
 * pin the unified policy in all three places.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const NEXT_CONFIG = readFileSync(resolve(__dirname, '../../next.config.ts'), 'utf-8');
const NGINX = readFileSync(resolve(__dirname, '../../nginx/default.conf'), 'utf-8');
const SERVE_UPLOAD = readFileSync(resolve(__dirname, '../lib/serve-upload.ts'), 'utf-8');

const POLICY = 'public, max-age=3600, must-revalidate';

type NginxLocationBlock = { pattern: string; body: string };

/**
 * C2-31 exit-criterion / CRIT3-06 / WP12 (run-10 c3): parse nginx location
 * blocks structurally instead of string offsets. The previous
 * `indexOf('location /')` boundary — and its run-10 c2 replacement
 * `indexOf('\n    }')` — were both string-offset hacks that broke (or nearly
 * broke) every time a new location block or prose comment landed: the word
 * "immutable" in a COMMENT false-positived a directive assertion, and the
 * indented-brace boundary depended on exact 4-space indentation. This parser
 * strips comments line-wise (prose can never match a directive assertion
 * again) and brace-balances each block (quantifier braces like `[a-z]{2}`
 * inside location patterns are self-balancing, so per-line counting holds).
 */
export function parseNginxLocationBlocks(conf: string): NginxLocationBlock[] {
    const lines = conf.split('\n').map((line) => {
        const hash = line.indexOf('#');
        return hash >= 0 ? line.slice(0, hash) : line;
    });
    const blocks: NginxLocationBlock[] = [];
    for (let i = 0; i < lines.length; i++) {
        // The block-opening `{` is the LAST brace on the line, so a
        // non-greedy pattern capture tolerates `{n}` regex quantifiers
        // inside the location pattern itself.
        const opener = /^\s*location\s+(.+?)\s*\{\s*$/.exec(lines[i]);
        if (!opener) continue;
        let depth = 1;
        const bodyLines: string[] = [];
        for (let j = i + 1; j < lines.length && depth > 0; j++) {
            for (const ch of lines[j]) {
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
                if (depth === 0) break;
            }
            if (depth > 0) bodyLines.push(lines[j]);
        }
        blocks.push({ pattern: opener[1], body: bodyLines.join('\n') });
    }
    return blocks;
}

export function findNginxLocation(conf: string, patternSubstring: string): NginxLocationBlock | undefined {
    return parseNginxLocationBlocks(conf).find((b) => b.pattern.includes(patternSubstring));
}

describe('unified derivative cache policy (ARCH-R4C6-06)', () => {
    it('next.config headers() carries the uploads rule with the unified policy', () => {
        expect(NEXT_CONFIG).toMatch(/source: '\/uploads\/:format\(jpeg\|webp\|avif\)\/:file\*'/);
        const ruleIdx = NEXT_CONFIG.indexOf("source: '/uploads/:format(jpeg|webp|avif)/:file*'");
        const policyIdx = NEXT_CONFIG.indexOf(POLICY, ruleIdx);
        expect(policyIdx).toBeGreaterThan(ruleIdx);
    });

    it('nginx uploads location uses the unified policy and never immutable', () => {
        const uploads = findNginxLocation(NGINX, '/uploads/(jpeg|webp|avif)/');
        expect(uploads).toBeDefined();
        expect(uploads!.body).toContain(POLICY);
        // Comment-stripped body: only a real directive can match now.
        expect(uploads!.body).not.toMatch(/immutable/);
        expect(uploads!.body).not.toMatch(/expires 1y/);
    });

    it('serve-upload.ts keeps the same policy on the paths it serves', () => {
        expect(SERVE_UPLOAD).toContain(POLICY);
        // and still rejects immutable by design (in-place re-encode hazard)
        expect(SERVE_UPLOAD).not.toMatch(/Cache-Control':\s*'[^']*immutable/);
    });
});
