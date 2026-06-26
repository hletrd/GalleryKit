/**
 * R15C15 TE-15-04 / A15-03: lock the graceful-shutdown invariant that spans
 * application code AND the Dockerfile.
 *
 * The cycle-12/13/14 shutdown work depends on TWO things being true together:
 *   1. instrumentation.ts registers process.on('SIGTERM'/'SIGINT', ...) wired
 *      to gracefulShutdown so the view-count flush + queue drain run before exit.
 *   2. The Dockerfile sets NEXT_MANUAL_SIG_HANDLE=true so Next's standalone
 *      server (start-server.js) does NOT install its OWN competing
 *      SIGTERM/SIGINT → process.exit(143) handler that races (and truncates)
 *      the app's flush.
 *
 * Neither half had a test. Removing either silently re-opens the cycle-14
 * C14-01 race (view-count writes truncated, exit code 143 instead of 0/1) with
 * no failing test to warn a maintainer copying the standalone server into a
 * k8s/Helm manifest or a non-Docker `next start`. These source-scan pins make
 * the cross-file invariant explicit. Same fixture style as
 * sw-template-contract.test.ts and the nginx body-size assertions.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INSTRUMENTATION_SRC = readFileSync(resolve(__dirname, '../instrumentation.ts'), 'utf8');
const DOCKERFILE_SRC = readFileSync(resolve(__dirname, '../../Dockerfile'), 'utf8');

describe('graceful-shutdown invariant (R15C15 TE-15-04 / A15-03)', () => {
    it('instrumentation.ts registers a SIGTERM handler wired to gracefulShutdown', () => {
        expect(INSTRUMENTATION_SRC).toMatch(/process\.on\(\s*['"]SIGTERM['"]/);
        expect(INSTRUMENTATION_SRC).toMatch(/gracefulShutdown\(\s*['"]SIGTERM['"]\s*\)/);
    });

    it('instrumentation.ts registers a SIGINT handler wired to gracefulShutdown', () => {
        expect(INSTRUMENTATION_SRC).toMatch(/process\.on\(\s*['"]SIGINT['"]/);
        expect(INSTRUMENTATION_SRC).toMatch(/gracefulShutdown\(\s*['"]SIGINT['"]\s*\)/);
    });

    it('Dockerfile sets NEXT_MANUAL_SIG_HANDLE=true so Next does not install a competing handler', () => {
        // Without this env var Next's start-server.js installs its own
        // SIGTERM/SIGINT → process.exit(143) handler that races the app flush.
        expect(DOCKERFILE_SRC).toMatch(/ENV\s+NEXT_MANUAL_SIG_HANDLE=true/);
    });
});
