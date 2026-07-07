import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
describe('backfill re-embed contract', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/backfill-clip-embeddings.ts'), 'utf8');
  it('re-embeds rows whose model_version != the target (filters notExists on modelVersion)', () => {
    expect(src).toContain('modelVersion');
    expect(src).toMatch(/eq\(\s*imageEmbeddings\.modelVersion/);
  });
  it('uses the real encoder under --production', () => {
    expect(src).toContain('embedImageReal');
    expect(src).toContain('--production');
    expect(src).toContain('SEMANTIC_SEARCH_ALLOW_PRODUCTION=true CLIP_MODELS_ROOT=/app/data/models/clip');
  });
  it('does not gate on the obsolete semantic_search_enabled key', () => {
    expect(src).not.toContain("'semantic_search_enabled'");
  });
  it('serializes the sidecar against restore with the semantic backfill advisory lock', () => {
    expect(src).toContain('LOCK_SEMANTIC_EMBEDDING_BACKFILL');
    expect(src).toContain('SELECT GET_LOCK(?, 0) AS acquired');
    expect(src).toContain('SELECT RELEASE_LOCK(?)');
  });
});

// AGG-C8-05 (run-6 cycle-8): the unwired backfillClipEmbeddings server action must
// select candidates by the ACTIVE model_version too — matching the canonical sidecar.
// Without the modelVersion filter in its notExists subquery, an image carrying a
// stub-version row was excluded even in production mode, so the action could never
// upgrade stub→production rows (it would report processed:0). Pin the fix.
describe('backfillClipEmbeddings action — model_version-aware selection', () => {
  const actionSrc = readFileSync(join(process.cwd(), 'src/app/actions/embeddings.ts'), 'utf8');
  it('filters the notExists candidate subquery on modelVersion (like the sidecar)', () => {
    expect(actionSrc).toMatch(/eq\(\s*imageEmbeddings\.modelVersion\s*,\s*modelVersion\s*\)/);
  });
  it('hoists modelVersion above the candidate query so the subquery can reference it', () => {
    const declIdx = actionSrc.indexOf('const modelVersion =');
    const notExistsIdx = actionSrc.indexOf('notExists(');
    expect(declIdx).toBeGreaterThan(-1);
    expect(notExistsIdx).toBeGreaterThan(-1);
    expect(declIdx).toBeLessThan(notExistsIdx);
  });
  it('uses keyset pagination so skipped rows do not trap later candidates', () => {
    expect(actionSrc).toContain('let cursor = 0');
    expect(actionSrc).toMatch(/gt\(\s*images\.id\s*,\s*cursor\s*\)/);
    expect(actionSrc).toContain('orderBy(asc(images.id))');
    expect(actionSrc).toContain('SEMANTIC_SCAN_LIMIT - attemptedEmbeddings');
  });
  it('serializes the server action against restore with the semantic backfill advisory lock', () => {
    expect(actionSrc).toContain('LOCK_SEMANTIC_EMBEDDING_BACKFILL');
    expect(actionSrc).toContain('SELECT GET_LOCK(?, 0) AS acquired');
    expect(actionSrc).toContain("releasePooledAdvisoryLocks(lockConn, [LOCK_SEMANTIC_EMBEDDING_BACKFILL], 'semantic embedding backfill action')");
  });
});
