/**
 * Cycle 2 RPF / P260-13 / C2-RPF-11b: source-text contract test for the
 * Stripe webhook route. Asserts the cycle 1 RPF tier-allowlist guard and
 * the cycle 2 RPF customer-email shape guard remain in place. These
 * tests prevent silent regressions where a future refactor drops one of
 * the validation layers without surfacing a behavioral failure (the
 * webhook is hard to exercise end-to-end without a real Stripe signing
 * secret; source-contract tests are the practical guardrail).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const WEBHOOK_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'api', 'stripe', 'webhook', 'route.ts'),
    'utf8',
);

describe('stripe webhook source-contract', () => {
    it('imports isPaidLicenseTier from license-tiers', () => {
        expect(WEBHOOK_SRC).toMatch(/import.*isPaidLicenseTier.*from.*['"]@\/lib\/license-tiers['"]/);
    });

    it('calls isPaidLicenseTier(tier) before INSERT', () => {
        // The check must appear before the db.insert call on the path
        const tierCheckIndex = WEBHOOK_SRC.indexOf('isPaidLicenseTier(tier)');
        const insertIndex = WEBHOOK_SRC.indexOf('db.insert(entitlements)');
        expect(tierCheckIndex).toBeGreaterThan(-1);
        expect(insertIndex).toBeGreaterThan(-1);
        expect(tierCheckIndex).toBeLessThan(insertIndex);
    });

    it('rejects invalid tier with a 200 (no Stripe retry) and warn-log', () => {
        // The unknown-tier branch should return received: true and warn.
        // Use a regex that walks until the matching `})` of NextResponse.json
        // since the block contains nested braces (object literals).
        const block = WEBHOOK_SRC.match(
            /if\s*\(\s*!isPaidLicenseTier\(tier\)\s*\)\s*\{[\s\S]*?return\s+NextResponse\.json[\s\S]*?\}\)?\s*;?\s*\n\s*\}/,
        );
        expect(block).not.toBeNull();
        const blockStr = block?.[0] ?? '';
        expect(blockStr).toMatch(/console\.warn/);
        expect(blockStr).toMatch(/received:\s*true/);
    });

    it('validates customer email shape before INSERT (P260-03)', () => {
        const emailCheckIndex = WEBHOOK_SRC.indexOf('EMAIL_SHAPE');
        const insertIndex = WEBHOOK_SRC.indexOf('db.insert(entitlements)');
        expect(emailCheckIndex).toBeGreaterThan(-1);
        expect(insertIndex).toBeGreaterThan(-1);
        expect(emailCheckIndex).toBeLessThan(insertIndex);
    });

    it('email shape regex rejects whitespace and quoting characters', () => {
        // Source-level assertion that the shape regex disallows the targeted
        // PII-spoofing characters identified in C2RPF-SEC-MED-01.
        const regexLine = WEBHOOK_SRC.match(/EMAIL_SHAPE\s*=\s*\/[^/]+\//);
        expect(regexLine).not.toBeNull();
        const src = regexLine?.[0] ?? '';
        // Disallow whitespace
        expect(src).toContain('\\s');
        // Disallow angle brackets and quotes
        expect(src).toMatch(/<>/);
        expect(src).toMatch(/"/);
    });

    it('plaintext token logging is gated by LOG_PLAINTEXT_DOWNLOAD_TOKENS env', () => {
        // P260-01: the plaintext token path must be opt-in. Walk until the
        // matching close brace by anchoring on the trailing `);` of console.info
        // since the block contains a nested template literal.
        expect(WEBHOOK_SRC).toMatch(/LOG_PLAINTEXT_DOWNLOAD_TOKENS/);
        const gate = WEBHOOK_SRC.match(
            /if\s*\(\s*process\.env\.LOG_PLAINTEXT_DOWNLOAD_TOKENS\s*===\s*['"]true['"]\s*\)\s*\{[\s\S]*?\)\s*;?\s*\n\s*\}/,
        );
        expect(gate).not.toBeNull();
        const gateStr = gate?.[0] ?? '';
        expect(gateStr).toMatch(/token=/);
        expect(gateStr).toMatch(/email=/);
    });

    it('default-deployment log line does NOT include the plaintext token', () => {
        // Outside the env-gated block, the structured log line must not
        // contain `${downloadToken}` interpolation.
        const lines = WEBHOOK_SRC.split('\n');
        const tokenInterpRe = /\$\{downloadToken\}/;
        const gateLineIndex = lines.findIndex((l) => l.includes('LOG_PLAINTEXT_DOWNLOAD_TOKENS'));
        expect(gateLineIndex).toBeGreaterThan(-1);
        // Lines BEFORE the env-gate must not interpolate the plaintext token.
        for (let i = 0; i < gateLineIndex; i++) {
            expect(lines[i]).not.toMatch(tokenInterpRe);
        }
    });
});
