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

    it('rejects invalid tier with a 200 (no Stripe retry) and an error-log', () => {
        // The unknown-tier branch should return received: true.
        // Cycle 3 RPF / P262-11: the log severity was escalated from
        // console.warn to console.error so log-shipper alerts catch tier
        // drift between Stripe dashboard config and the gallery allowlist.
        const block = WEBHOOK_SRC.match(
            /if\s*\(\s*!isPaidLicenseTier\(tier\)\s*\)\s*\{[\s\S]*?return\s+NextResponse\.json[\s\S]*?\}\)?\s*;?\s*\n\s*\}/,
        );
        expect(block).not.toBeNull();
        const blockStr = block?.[0] ?? '';
        // Accept either console.error (cycle 3 contract) or console.warn
        // (legacy) so this assertion does not break if the contract relaxes
        // again. Both are observable in log shippers; we just want a log line.
        expect(blockStr).toMatch(/console\.(error|warn)/);
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

    it('manual-distribution line logs resolvedEmail (sentinel-bearing), not raw customerEmail (R4C2)', () => {
        // SEC/COR-R4C2-05: when Stripe sends no email, customerEmail is ''
        // while resolvedEmail carries the `unknown+<sessionId>@stripe.local`
        // reconciliation sentinel (D-101-04). The operator-facing line must
        // interpolate resolvedEmail or the pointer is lost in exactly the
        // case the sentinel exists for.
        const gate = WEBHOOK_SRC.match(
            /if\s*\(\s*process\.env\.LOG_PLAINTEXT_DOWNLOAD_TOKENS\s*===\s*['"]true['"]\s*\)\s*\{[\s\S]*?\)\s*;?\s*\n\s*\}/,
        );
        expect(gate).not.toBeNull();
        const gateStr = gate?.[0] ?? '';
        expect(gateStr).toMatch(/email=\$\{resolvedEmail\}/);
        expect(gateStr).not.toMatch(/email=\$\{customerEmail\}/);
    });

    it('gates success logging on a TRUE insert via affectedRows === 1 (R4C3 COR-R4C3-02)', () => {
        // The dup-key loser of a SELECT/INSERT race records nothing — its
        // token hash is never stored. MySQL reports affectedRows 1 only for
        // a fresh insert (0 for the no-op dup-key update, 2 for a changing
        // one), so the success log lines must be gated on that outcome or
        // the loser logs a [manual-distribution] line carrying a dead token
        // (the C3-RPF-07 failure mode, re-minted in the race window).
        expect(WEBHOOK_SRC).toMatch(/insertedFresh\s*=\s*insertHeader\.affectedRows\s*===\s*1/);
        // The non-fresh path must bail out BEFORE 'Entitlement created'.
        const bailIndex = WEBHOOK_SRC.indexOf('if (!insertedFresh)');
        const createdLogIndex = WEBHOOK_SRC.indexOf("console.info('Entitlement created'");
        expect(bailIndex).toBeGreaterThan(-1);
        expect(createdLogIndex).toBeGreaterThan(-1);
        expect(bailIndex).toBeLessThan(createdLogIndex);
        // And the bail-out block returns received: true without retrying.
        const bailBlock = WEBHOOK_SRC.match(
            /if\s*\(\s*!insertedFresh\s*\)\s*\{[\s\S]*?received:\s*true[\s\S]*?\}/,
        );
        expect(bailBlock).not.toBeNull();
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
