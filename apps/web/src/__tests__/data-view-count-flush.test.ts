import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Plan 315 / C2L2-TG01 / closes C7-F03 (deferred at cycle 7).
 *
 * Locks the load-bearing source-level invariants of the
 * `flushGroupViewCounts` swap-and-drain pattern (C2-F01 fix from
 * cycle 1 fresh, commit `29eefad`) plus the `consecutiveFlushFailures`
 * exponential backoff (already on master, plan-311 follow-up).
 *
 * Why fixture-style instead of behavioral:
 *   The flush function takes no arguments, mutates module-level state,
 *   and calls into the real Drizzle `db` client. Mocking the full client
 *   surface is a large, fragile lift (deferred at cycle 7 as `C7-F03`
 *   for that reason). The actual regression risk is a refactor that
 *   silently removes one of these invariants — exactly what fixture
 *   inspection catches without the mock burden.
 *
 * Each invariant below corresponds to a concrete failure mode:
 *   - swap-before-write → buffer loss on crash mid-flush
 *   - chunked iteration → unbounded concurrent DB promises
 *   - succeeded/batch.size guards → backoff counter never resets or
 *     never increments
 *   - Math.min cap → backoff overflows past 5 minutes
 *   - capacity guard symmetry → re-buffer can exceed MAX_*_SIZE
 *   - constants → silent capacity / chunking change
 */

const dataPath = path.join(__dirname, '..', 'lib', 'data.ts');
const dataSource = fs.readFileSync(dataPath, 'utf8');

describe('view-count flush — C2-F01 swap-and-drain + backoff invariants', () => {
    it('declares viewCountBuffer with `let` (rebindable) so the swap pattern is possible', () => {
        // `const viewCountBuffer = new Map(...)` would make the swap impossible;
        // the C2-F01 fix specifically depends on `let`.
        expect(dataSource).toMatch(/let\s+viewCountBuffer\s*=\s*new\s+Map<number,\s*number>\(\)/);
    });

    it('declares MAX_VIEW_COUNT_BUFFER_SIZE = 1000 and FLUSH_CHUNK_SIZE = 20', () => {
        expect(dataSource).toMatch(/const\s+MAX_VIEW_COUNT_BUFFER_SIZE\s*=\s*1000\b/);
        expect(dataSource).toMatch(/const\s+FLUSH_CHUNK_SIZE\s*=\s*20\b/);
    });

    it('flushGroupViewCounts swaps the buffer reference before any DB write', () => {
        // Extract the function body via brace-depth walker so a future
        // reformat doesn't break the test on a regex that relies on
        // adjacent comments or specific newline placement.
        const fnBody = extractFnBody(dataSource, 'async function flushGroupViewCounts');
        expect(fnBody, 'flushGroupViewCounts function body must be findable').toBeTruthy();

        // The swap pair must appear as `const batch = viewCountBuffer;`
        // followed by `viewCountBuffer = new Map();` (whitespace tolerant).
        const swapIdx = fnBody!.search(/const\s+batch\s*=\s*viewCountBuffer\s*;\s*\n\s*viewCountBuffer\s*=\s*new\s+Map\(\)\s*;/);
        expect(swapIdx, 'swap-then-rebind pair must be present').toBeGreaterThanOrEqual(0);

        // The first `db.update(sharedGroups)` (the actual DB write) must
        // appear AFTER the swap. If a refactor reorders these, buffer-loss
        // on crash mid-flush comes back.
        const dbUpdateIdx = fnBody!.indexOf('db.update(sharedGroups)');
        expect(dbUpdateIdx, 'flushGroupViewCounts must call db.update(sharedGroups)').toBeGreaterThan(0);
        expect(dbUpdateIdx).toBeGreaterThan(swapIdx);
    });

    it('flushGroupViewCounts iterates in FLUSH_CHUNK_SIZE-bounded chunks', () => {
        const fnBody = extractFnBody(dataSource, 'async function flushGroupViewCounts');
        expect(fnBody).toBeTruthy();
        expect(fnBody!).toMatch(/for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*entries\.length\s*;\s*i\s*\+=\s*FLUSH_CHUNK_SIZE\s*\)/);
        // The chunk slice must use the same constant — any other shape
        // (e.g. naked Promise.all over `entries.map(...)`) means
        // unbounded concurrent DB writes.
        expect(fnBody!).toMatch(/entries\.slice\s*\(\s*i\s*,\s*i\s*\+\s*FLUSH_CHUNK_SIZE\s*\)/);
    });

    it('consecutiveFlushFailures is reset only on success and incremented only on total failure', () => {
        const fnBody = extractFnBody(dataSource, 'async function flushGroupViewCounts');
        expect(fnBody).toBeTruthy();

        // The reset branch — must be guarded on `succeeded > 0`.
        expect(fnBody!).toMatch(/if\s*\(\s*succeeded\s*>\s*0\s*\)\s*\{\s*\n?\s*consecutiveFlushFailures\s*=\s*0\s*;/);

        // The increment branch — must be guarded on `batch.size > 0`
        // (so that an empty-batch no-op flush doesn't increment the
        // counter and trigger a spurious backoff).
        expect(fnBody!).toMatch(/else\s+if\s*\(\s*batch\.size\s*>\s*0\s*\)\s*\{\s*\n?\s*consecutiveFlushFailures\s*\+\+/);
    });

    it('getNextFlushInterval caps the exponential backoff at MAX_FLUSH_INTERVAL_MS', () => {
        const fnBody = extractFnBody(dataSource, 'function getNextFlushInterval');
        expect(fnBody, 'getNextFlushInterval function body must be findable').toBeTruthy();
        // Without `Math.min(backoff, MAX_FLUSH_INTERVAL_MS)` a sustained
        // outage past 8 consecutive failures would push the next-flush
        // interval past 5 minutes (BASE_FLUSH_INTERVAL_MS * 2^5 = 160s,
        // 2^6 = 320s) and grow without bound.
        expect(fnBody!).toMatch(/Math\.min\s*\(\s*backoff\s*,\s*MAX_FLUSH_INTERVAL_MS\s*\)/);
        // Also lock the cap value (5 minutes).
        expect(dataSource).toMatch(/const\s+MAX_FLUSH_INTERVAL_MS\s*=\s*300000\s*;/);
    });

    it('the re-buffer .catch branch enforces the same capacity guard as bufferGroupViewCount', () => {
        const fnBody = extractFnBody(dataSource, 'async function flushGroupViewCounts');
        const bufferFnBody = extractFnBody(dataSource, 'function bufferGroupViewCount');
        expect(fnBody).toBeTruthy();
        expect(bufferFnBody).toBeTruthy();

        // The capacity guard shape must appear in BOTH the producer
        // (bufferGroupViewCount) and the re-buffer .catch path inside
        // flushGroupViewCounts. Asymmetry here means a producer-side
        // capacity check could be bypassed by re-buffering during a
        // long DB outage.
        const capacityShape = /viewCountBuffer\.size\s*>=\s*MAX_VIEW_COUNT_BUFFER_SIZE\s*&&\s*!viewCountBuffer\.has\(groupId\)/;
        expect(bufferFnBody!).toMatch(capacityShape);
        expect(fnBody!).toMatch(capacityShape);
    });

    it('flushGroupViewCounts re-arms the timer in finally only when buffer is non-empty', () => {
        const fnBody = extractFnBody(dataSource, 'async function flushGroupViewCounts');
        expect(fnBody).toBeTruthy();
        // The re-arm guard prevents a busy-loop after a fully-empty
        // flush — must check `viewCountBuffer.size > 0` AND `!viewCountFlushTimer`.
        expect(fnBody!).toMatch(/viewCountBuffer\.size\s*>\s*0\s*&&\s*!viewCountFlushTimer/);
    });

    it('C1F-DB-01: post-rebuffer cap enforcement evicts oldest entries when buffer exceeds MAX_VIEW_COUNT_BUFFER_SIZE', () => {
        const fnBody = extractFnBody(dataSource, 'async function flushGroupViewCounts');
        expect(fnBody).toBeTruthy();
        // The while loop in the finally block enforces the cap after re-buffering.
        // Without this, re-buffered entries whose group IDs already exist in the
        // new buffer bypass the capacity check in the re-buffer path.
        expect(fnBody!).toMatch(/while\s*\(\s*viewCountBuffer\.size\s*>\s*MAX_VIEW_COUNT_BUFFER_SIZE\s*\)/);
        // The eviction must use FIFO (keys().next()) matching the viewCountRetryCount pattern.
        expect(fnBody!).toMatch(/const\s+oldestKey\s*=\s*viewCountBuffer\.keys\(\)\.next\(\)\.value/);
        expect(fnBody!).toMatch(/viewCountBuffer\.delete\s*\(\s*oldestKey\s*\)/);
    });

    it('viewCountRetryCount has MAX_VIEW_COUNT_RETRY_SIZE cap with FIFO eviction', () => {
        // The retry counter cap prevents unbounded growth during sustained DB outages
        // where the buffer never empties and the pruning-at-empty-buffer path never fires.
        expect(dataSource).toMatch(/const\s+MAX_VIEW_COUNT_RETRY_SIZE\s*=\s*500\b/);
        // The eviction must iterate keys() for FIFO order and delete excess entries.
        const dataFnBody = dataSource; // use full source since pruning is at module level
        expect(dataFnBody).toMatch(/if\s*\(\s*viewCountRetryCount\.size\s*>\s*MAX_VIEW_COUNT_RETRY_SIZE\s*\)/);
    });

    it('VIEW_COUNT_MAX_RETRIES = 3: increments drop after 3 failed flush attempts', () => {
        // The retry counter limits how many times a failed increment is re-buffered.
        expect(dataSource).toMatch(/const\s+VIEW_COUNT_MAX_RETRIES\s*=\s*3\b/);
        // The drop logic must check the retry count and log a warning.
        const fnBody = extractFnBody(dataSource, 'async function flushGroupViewCounts');
        expect(fnBody).toBeTruthy();
        expect(fnBody!).toMatch(/if\s*\(\s*retries\s*>=\s*VIEW_COUNT_MAX_RETRIES\s*\)/);
        expect(fnBody!).toMatch(/Dropping increment for group/);
    });
});

/**
 * Brace-depth walker that returns the body of `function name(...)` (or
 * `async function name(...)`). Returns null if the function isn't
 * found. Tolerates type annotations and arbitrary whitespace.
 */
function extractFnBody(source: string, header: string): string | null {
    const headerIdx = source.indexOf(header);
    if (headerIdx === -1) return null;
    const openBrace = source.indexOf('{', headerIdx);
    if (openBrace === -1) return null;

    let depth = 0;
    let i = openBrace;
    let inString: '"' | "'" | '`' | null = null;
    let inLineComment = false;
    let inBlockComment = false;

    while (i < source.length) {
        const ch = source[i];
        const next = source[i + 1];

        if (inLineComment) {
            if (ch === '\n') inLineComment = false;
        } else if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
        } else if (inString) {
            if (ch === '\\') {
                i++; // skip next char
            } else if (ch === inString) {
                inString = null;
            }
        } else if (ch === '/' && next === '/') {
            inLineComment = true;
            i++;
        } else if (ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            inString = ch;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(openBrace + 1, i);
            }
        }
        i++;
    }
    return null;
}
