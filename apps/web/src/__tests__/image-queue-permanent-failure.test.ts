import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Plan 334 / A2-HIGH-01.
 *
 * Locks the source-level invariants of the image processing queue's
 * permanently-failed ID tracking. When a job fails MAX_RETRIES times,
 * its ID is added to a Set that is excluded from bootstrap scans.
 * This prevents infinite re-enqueue loops.
 *
 * Why fixture-style instead of behavioral:
 *   The queue state is module-level, the bootstrap query hits the real DB,
 *   and the failure path requires a full queue worker lifecycle. Mocking
 *   all of that is fragile. The regression risk is a refactor that removes
 *   the `notInArray` condition or the `permanentlyFailedIds.add` call —
 *   exactly what fixture inspection catches.
 */

const queuePath = path.join(__dirname, '..', 'lib', 'image-queue.ts');
const queueSource = fs.readFileSync(queuePath, 'utf8');

describe('image queue permanent failure — A2-HIGH-01 invariants', () => {
    it('declares permanentlyFailedIds as Set<number> in ProcessingQueueState', () => {
        // The type must declare the set so TypeScript enforces usage.
        expect(queueSource).toMatch(/permanentlyFailedIds:\s*Set<number>/);
    });

    it('initializes permanentlyFailedIds as new Set<number>()', () => {
        // The state initializer must create an empty Set.
        expect(queueSource).toMatch(/permanentlyFailedIds:\s*new\s+Set<number>\(\)/);
    });

    it('declares MAX_PERMANENTLY_FAILED_IDS with a cap ≤ 1000', () => {
        // The cap prevents unbounded memory growth.
        const match = queueSource.match(/const\s+MAX_PERMANENTLY_FAILED_IDS\s*=\s*(\d+)/);
        expect(match, 'MAX_PERMANENTLY_FAILED_IDS must be declared').toBeTruthy();
        const cap = parseInt(match![1], 10);
        expect(cap).toBeGreaterThan(0);
        expect(cap).toBeLessThanOrEqual(1000);
    });

    it('bootstrapImageProcessingQueue excludes permanentlyFailedIds via notInArray', () => {
        // bootstrapImageProcessingQueue is an arrow function; search full source.
        expect(queueSource).toMatch(/notInArray\s*\(\s*images\.id\s*,\s*\[\.\.\.state\.permanentlyFailedIds\]\s*\)/);
    });

    it('enqueueImageProcessing adds job.id to permanentlyFailedIds after MAX_RETRIES failures', () => {
        // The permanently-failed tracking lives inside enqueueImageProcessing
        // (an arrow-function callback inside the queue worker). We search the
        // full source because the callback is nested deep inside the arrow.
        expect(queueSource).toMatch(/state\.permanentlyFailedIds\.add\s*\(\s*job\.id\s*\)/);
    });

    it('permanentlyFailedIds has FIFO eviction when size exceeds MAX_PERMANENTLY_FAILED_IDS', () => {
        // The eviction is inside the same enqueueImageProcessing callback.
        // Check the full source for the required patterns.
        expect(queueSource).toMatch(/state\.permanentlyFailedIds\.size\s*>\s*MAX_PERMANENTLY_FAILED_IDS/);
        // FIFO eviction: use .values().next().value to get the oldest.
        expect(queueSource).toMatch(/const\s+oldest\s*=\s*state\.permanentlyFailedIds\.values\(\)\.next\(\)\.value/);
        expect(queueSource).toMatch(/state\.permanentlyFailedIds\.delete\s*\(\s*oldest\s*\)/);
    });

    it('quiesceImageProcessingQueueForRestore clears permanentlyFailedIds', () => {
        const fnBody = extractFnBody(queueSource, 'function quiesceImageProcessingQueueForRestore');
        expect(fnBody, 'quiesceImageProcessingQueueForRestore body must be findable').toBeTruthy();

        // A DB restore may fix underlying issues, so the permanently-failed
        // set must be cleared to allow re-processing.
        expect(fnBody!).toMatch(/state\.permanentlyFailedIds\.clear\s*\(\)/);
    });

    it('permanentlyFailedIds is cleared in deleteImage and deleteImages actions', () => {
        // When an image is deleted, its ID must be removed from the set
        // so the ID can be reused without being silently excluded.
        // We verify this by checking the actions file (which imports queueState).
        const imagesPath = path.join(__dirname, '..', 'app', 'actions', 'images.ts');
        const imagesSource = fs.readFileSync(imagesPath, 'utf8');
        expect(imagesSource).toMatch(/permanentlyFailedIds\.delete\s*\(\s*id\s*\)/);
    });
});

/**
 * Brace-depth walker that returns the body of `function name(...)` (or
 * `async function name(...)`). Returns null if the function isn't found.
 * Tolerates type annotations and arbitrary whitespace.
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
                i++;
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
