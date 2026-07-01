import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
describe('upload embedding hook wiring', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/image-queue.ts'), 'utf8');
  it('branches to embedImageReal in production', () => {
    expect(src).toContain('embedImageReal');
    expect(src).toContain("=== 'production'");
  });
  it('writes PRODUCTION_MODEL_VERSION for real embeddings', () => {
    expect(src).toContain('PRODUCTION_MODEL_VERSION');
  });
  it('keeps the stub path for stub mode', () => {
    expect(src).toContain('embedImageStub');
    expect(src).toContain('STUB_MODEL_VERSION');
  });
  it('stores the raw embedding buffer, not base64 (AGG-C10-01)', () => {
    // The write must NOT base64-encode the buffer (the read path round-trips raw bytes).
    expect(src).not.toMatch(/embedding:\s*base64/);
    expect(src).not.toContain("buf.toString('base64')");
    expect(src).toContain('embeddingToBuffer');
  });
  it('resolves current semanticSearchMode before post-processing embedding writes', () => {
    // Processing byte-affecting settings are accepted-upload snapshots, but
    // semantic embedding mode is a serving/runtime choice. The post-processing
    // side effect must fetch the current mode after processed=true so a mode
    // flip while the job waits cannot write stale stub rows over production.
    expect(src).toContain('applyRuntimeSemanticGate');
    expect(src).toContain('post-processing embedding writes resolve the');
    expect(src).toMatch(/candidate\.imageSizes\.every\(\(size\) => Number\.isInteger\(size\) && size >= MIN_IMAGE_SIZE\)/);
    expect(src).toMatch(
      /const cfg = await getGalleryConfig\(\);[\s\S]*semanticMode = applyRuntimeSemanticGate\(cfg\.semanticSearchMode\);[\s\S]*storeImageEmbeddingForMode\(job\.id, originalPath, semanticMode\)/,
    );
    expect(src).not.toContain('resolvedSemanticMode ?? job.semanticSearchMode');
    expect(src).not.toContain('job.semanticSearchMode ??');
  });

  it('runtime-gates production semantic snapshots behind SEMANTIC_SEARCH_ALLOW_PRODUCTION', () => {
    expect(src).toContain('SEMANTIC_SEARCH_ALLOW_PRODUCTION');
    expect(src).toMatch(/mode === 'production'[\s\S]*SEMANTIC_SEARCH_ALLOW_PRODUCTION/);
    expect(src).toMatch(/return 'disabled'/);
  });

  it('bootstraps a bounded retry for processed rows missing the active model embedding', () => {
    expect(src).toContain('BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE = 50');
    expect(src).toContain('BOOTSTRAP_EMBEDDING_RETRY_CONCURRENCY = 2');
    expect(src).toContain('bootstrapMissingActiveEmbeddings');
    expect(src).toContain('activeModelVersion');
    expect(src).toMatch(/eq\(images\.processed,\s*true\)/);
    expect(src).toMatch(/isNull\(imageEmbeddings\.imageId\)/);
    expect(src).toMatch(/\.limit\(BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE\)/);
    expect(src).toContain('storeImageEmbeddingForMode(row.id, originalPath, semanticMode)');
    expect(src).toContain('await Promise.allSettled(tasks)');
  });
});

describe('upload enqueue snapshots semanticSearchMode (R17C17 PERF-17-04)', () => {
  const actionSrc = readFileSync(join(process.cwd(), 'src/app/actions/images.ts'), 'utf8');
  it('passes the persisted processing snapshot semanticSearchMode on the upload enqueue', () => {
    expect(actionSrc).toContain('semanticSearchMode: processingSettingsSnapshot.semanticSearchMode');
  });
});
