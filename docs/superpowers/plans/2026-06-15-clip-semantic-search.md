# Real CLIP Semantic Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GalleryKit's stub CLIP encoder with a real multilingual (jina-clip-v2-class) encoder so natural-language search (Korean + English) and "similar photos" genuinely work, fully self-hosted on CPU.

**Architecture:** Reuse the entire existing pipeline (table, route, UI, backfill, cosine/ser-de, upload hook, config). Add a lazy-singleton in-process encoder (Transformers.js v3, onnxruntime-node fallback) that loads int8 ONNX weights from the `./data/models/` bind-mount volume, emits Matryoshka-truncated 512-dim L2-normalized vectors (so `EMBEDDING_DIM=512` and the schema are unchanged), tag rows with a real `model_version`, open the `production` config gate, and filter the query scan to the active model version.

**Tech Stack:** Next.js 16 / React 19 / TypeScript 6, Drizzle ORM (MySQL), `@huggingface/transformers` v3 (or `onnxruntime-node`), Sharp, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`

**Repo rules (every commit):** GPG-sign (`git commit -S`), conventional-commit + gitmoji, NO `Co-Authored-By`, `git pull --rebase` before push, fine-grained commits. Run `npm run typecheck --workspace=apps/web` before committing test/TS changes.

---

## File Structure

| File | Disposition | Responsibility |
|---|---|---|
| `apps/web/src/lib/clip-embeddings.ts` | Modify | Add `normalizeEmbedding`, `truncateAndNormalize`, `PRODUCTION_MODEL_VERSION`, `PRODUCTION_COSINE_THRESHOLD` (pure, no-db, client-safe) |
| `apps/web/src/lib/clip-model.ts` | Create | Lazy-singleton real encoder: `embedTextReal`, `embedImageReal`, model load from volume (the one runtime-specific module) |
| `apps/web/scripts/download-clip-models.ts` | Replace stub | Download int8 ONNX + tokenizer to `data/models/clip/`, verify SHA-256 manifest |
| `apps/web/src/lib/gallery-config-shared.ts` | Modify | `semantic_search_mode` validator accepts `'production'` |
| `apps/web/src/lib/gallery-config.ts` | Modify | Widen resolved `semanticSearchMode` type to `'disabled' \| 'stub' \| 'production'` |
| `apps/web/src/app/api/search/semantic/route.ts` | Modify | `production` branch (real text embed), `model_version` filter, accept `production` gate |
| `apps/web/src/lib/image-queue.ts` | Modify | Upload hook `production` branch (real image embed from original), write real `model_version` |
| `apps/web/scripts/backfill-clip-embeddings.ts` | Modify | Re-embed rows whose `model_version` ≠ target; real embed; fix stale key; `--production` |
| `apps/web/src/app/api/search/similar/[id]/route.ts` | Create | Image→image cosine over the active model's rows |
| `apps/web/src/components/similar-photos.tsx` | Create | Client component fetching the similar endpoint |
| `apps/web/src/components/photo-viewer.tsx` | Modify | Mount `<SimilarPhotos>` |
| `apps/web/src/components/search.tsx` | Modify | Hide "experimental" disclaimer in `production` |
| `apps/web/messages/en.json`, `ko.json` | Modify | Add `search.similarPhotos`, `search.similarEmpty` |
| `apps/web/Dockerfile` | Modify | `onnxruntime-node` platform optional-dep + `mkdir data/models/clip` |
| `apps/web/src/__tests__/*` | Create | Unit + contract + anti-vacuity integration tests per task |

---

## Phase 0 — Spike & model assets

### Task 1: Runtime spike — pick Transformers.js v3 vs onnxruntime-node

Decide the encoder runtime BEFORE writing `clip-model.ts`. This is an investigation task; its deliverable is a recorded decision (model id + package + exact API) appended to the spec, plus a throwaway proof script that is then deleted.

**Files:**
- Temp: `apps/web/scripts/_spike-clip.ts` (deleted at end of task)
- Modify (decision record): `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md` §12

- [ ] **Step 1: Install the primary candidate**

Run: `npm install --workspace=apps/web @huggingface/transformers@^3.8.1`
Expected: added to `apps/web/package.json` dependencies, install succeeds (it pulls `onnxruntime-node`).

- [ ] **Step 2: Write a throwaway proof script** at `apps/web/scripts/_spike-clip.ts`:

```typescript
// THROWAWAY — deleted at end of Task 1. Proves the chosen runtime can run a
// multilingual CLIP on CPU and that real similarity beats random.
import { pipeline, RawImage } from '@huggingface/transformers';

const MODEL = 'jinaai/jina-clip-v2'; // confirm exact ONNX-exported repo id during this step
async function main() {
  // Image + text feature extractors (CPU, int8 quantized if available)
  const imageExtractor = await pipeline('image-feature-extraction', MODEL, { dtype: 'q8' });
  const textExtractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });

  const img = await RawImage.fromURL('https://raw.githubusercontent.com/huggingface/transformers.js/main/tests/assets/tiger.jpg');
  const imgVec = (await imageExtractor(img, { normalize: true, pooling: 'mean' })).data as Float32Array;
  const good = (await textExtractor('a photo of a tiger', { normalize: true, pooling: 'mean' })).data as Float32Array;
  const bad  = (await textExtractor('a city street at night', { normalize: true, pooling: 'mean' })).data as Float32Array;

  const cos = (a: Float32Array, b: Float32Array) => {
    let d = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) d += a[i] * b[i]; return d;
  };
  console.log('dim:', imgVec.length, 'good:', cos(imgVec, good).toFixed(3), 'bad:', cos(imgVec, bad).toFixed(3));
}
main();
```

- [ ] **Step 3: Run it and record reality**

Run: `cd apps/web && npx tsx scripts/_spike-clip.ts`
Expected: prints a dim (1024 native; note it — Matryoshka truncation to 512 happens in Task 3) and **`good` cosine clearly higher than `bad`** (e.g. good > 0.25, bad < 0.15). This proves a real model, not random.

- [ ] **Step 4: Decide & record.** If Step 3 works in Transformers.js → runtime = Transformers.js, record the exact model id, `dtype`, `pooling`/`normalize` flags, native dim, and per-encode CPU latency in spec §12. If the model is NOT loadable in Transformers.js (custom arch error), fall back: `npm install --workspace=apps/web onnxruntime-node` + use jina's published ONNX (`image_encoder.onnx`/`text_encoder.onnx`) with manual Sharp preprocessing + the tokenizer; record that decision and the exact ONNX URLs instead. Either way, **the `clip-model.ts` interface in Task 4 is identical.**

- [ ] **Step 5: Clean up & commit the decision**

```bash
rm apps/web/scripts/_spike-clip.ts
git add apps/web/package.json apps/web/package-lock.json docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md
git commit -S -m "build(search): 🔧 add CLIP encoder runtime dep + record spike decision"
git pull --rebase && git push
```

### Task 2: Implement `download-clip-models.ts`

**Files:**
- Replace: `apps/web/scripts/download-clip-models.ts`
- Test: `apps/web/src/__tests__/download-clip-models.test.ts`

- [ ] **Step 1: Write the failing test** (`download-clip-models.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Contract: the script must declare the model artifacts + their SHA-256 manifest
// and target the data/models/clip volume path — not be a console.log stub.
describe('download-clip-models', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/download-clip-models.ts'), 'utf8');
  it('targets the data/models/clip volume dir', () => {
    expect(src).toContain('data/models/clip');
  });
  it('verifies a SHA-256 checksum manifest (not a console.log stub)', () => {
    expect(src).toMatch(/createHash\(['"]sha256['"]\)/);
    expect(src).not.toMatch(/Running in stub mode/);
  });
  it('is idempotent: skips files already present with a matching checksum', () => {
    expect(src).toMatch(/existsSync|stat/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/download-clip-models.test.ts`
Expected: FAIL (current file contains "Running in stub mode", no `createHash`).

- [ ] **Step 3: Implement the downloader.** Replace the file with a real implementation: resolve target dir from `CLIP_MODELS_ROOT` env (default `data/models/clip`), download each artifact recorded in Task 1 (image encoder, text encoder, tokenizer files) via `fetch`, stream to disk, compute `createHash('sha256')` and compare to a hard-coded manifest, skip files already present whose checksum matches (idempotent), exit non-zero on mismatch. (If Task 1 chose Transformers.js, this script instead pre-warms the HF cache dir on the volume by setting `env.cacheDir = CLIP_MODELS_ROOT` and calling the pipelines once; keep the same checksum-verified-manifest shape for any manually downloaded file.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/download-clip-models.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the downloader once locally to seed the volume**

Run: `cd apps/web && CLIP_MODELS_ROOT=data/models/clip npx tsx scripts/download-clip-models.ts`
Expected: files written under `apps/web/data/models/clip/`, checksums OK. (`data/` is gitignored — do NOT commit weights.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts/download-clip-models.ts apps/web/src/__tests__/download-clip-models.test.ts
git commit -S -m "feat(search): ✨ implement CLIP model downloader with SHA-256 manifest"
git pull --rebase && git push
```

---

## Phase 1 — Encoder module

### Task 3: Add normalize + truncate + production constants to `clip-embeddings.ts`

**Files:**
- Modify: `apps/web/src/lib/clip-embeddings.ts`
- Test: `apps/web/src/__tests__/clip-embeddings-normalize.test.ts`

- [ ] **Step 1: Write the failing test**:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeEmbedding, truncateAndNormalize, EMBEDDING_DIM, PRODUCTION_MODEL_VERSION } from '@/lib/clip-embeddings';

describe('normalizeEmbedding', () => {
  it('returns a unit-length vector', () => {
    const v = normalizeEmbedding(Float32Array.from([3, 4]));
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    expect(v[0]).toBeCloseTo(0.6, 6);
  });
  it('leaves a zero vector as zeros (no NaN)', () => {
    const v = normalizeEmbedding(new Float32Array(4));
    expect(v.every(x => x === 0)).toBe(true);
  });
});

describe('truncateAndNormalize (Matryoshka 1024 -> 512)', () => {
  it('truncates to EMBEDDING_DIM then re-normalizes to unit length', () => {
    const src = Float32Array.from({ length: 1024 }, (_, i) => i + 1);
    const out = truncateAndNormalize(src);
    expect(out.length).toBe(EMBEDDING_DIM);
    expect(Math.hypot(...out)).toBeCloseTo(1, 5);
  });
});

describe('PRODUCTION_MODEL_VERSION', () => {
  it('is a real id, not the stub', () => {
    expect(PRODUCTION_MODEL_VERSION).not.toBe('stub-sha256-v1');
    expect(PRODUCTION_MODEL_VERSION.length).toBeLessThanOrEqual(32); // model_version varchar(32)
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/clip-embeddings-normalize.test.ts`
Expected: FAIL ("normalizeEmbedding is not a function").

- [ ] **Step 3: Add to `clip-embeddings.ts`** (after the existing constants):

```typescript
// Real production encoder identity (set in this cycle). Stays <= 32 chars for the
// model_version varchar(32). Bump this string whenever the model OR dim changes.
export const PRODUCTION_MODEL_VERSION = 'jina-clip-v2-d512-q8';

// Production relevance threshold — calibrated empirically in the threshold task.
// Placeholder-free: this is the starting value; Task 14 replaces it with the
// calibrated number and the calibration test pins it.
export const PRODUCTION_COSINE_THRESHOLD = 0.25;

/** L2-normalize a vector to unit length. A zero vector is returned unchanged (no NaN). */
export function normalizeEmbedding(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** Matryoshka: take the first EMBEDDING_DIM components, then re-normalize. */
export function truncateAndNormalize(v: Float32Array): Float32Array {
  const head = v.length > EMBEDDING_DIM ? v.subarray(0, EMBEDDING_DIM) : v;
  return normalizeEmbedding(Float32Array.from(head));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/clip-embeddings-normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/clip-embeddings.ts apps/web/src/__tests__/clip-embeddings-normalize.test.ts
git commit -S -m "feat(search): ✨ add L2-normalize + Matryoshka-512 truncation + production model id"
git pull --rebase && git push
```

### Task 4: Create `lib/clip-model.ts` (lazy-singleton real encoder)

**Files:**
- Create: `apps/web/src/lib/clip-model.ts`
- Test: `apps/web/src/__tests__/clip-model-contract.test.ts` (source-shape contract — no model load, so it stays fast/offline in CI)

- [ ] **Step 1: Write the failing contract test**:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The heavy model is NOT loaded in unit CI (no weights). This contract test pins
// the module's shape; the real embedding behavior is covered by the gated
// anti-vacuity integration smoke (Task 15).
describe('clip-model module contract', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/clip-model.ts'), 'utf8');
  it('exports async embedTextReal and embedImageReal', () => {
    expect(src).toMatch(/export async function embedTextReal\s*\(/);
    expect(src).toMatch(/export async function embedImageReal\s*\(/);
  });
  it('returns Matryoshka-512 normalized vectors (uses truncateAndNormalize)', () => {
    expect(src).toContain('truncateAndNormalize');
  });
  it('loads the model lazily as a singleton (cached promise)', () => {
    expect(src).toMatch(/let\s+\w*[Pp]romise|cached/);
  });
  it('reads weights from the CLIP_MODELS_ROOT volume, never bakes a path', () => {
    expect(src).toContain('CLIP_MODELS_ROOT');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/clip-model-contract.test.ts`
Expected: FAIL (file does not exist).

- [ ] **Step 3: Create `clip-model.ts`** (Transformers.js variant from Task 1; if the spike chose onnxruntime-node, implement the same two exported signatures with InferenceSession + Sharp preprocessing + tokenizer — interface identical):

```typescript
/**
 * Real multilingual CLIP encoder (US-P51 production). Lazy singleton: the model
 * loads on first use and is reused process-wide. Server-only (filesystem + native).
 * Emits Matryoshka-512, L2-normalized Float32Array — matching EMBEDDING_DIM and
 * the existing image_embeddings schema (no migration).
 */
import 'server-only';
import { join } from 'path';
import sharp from 'sharp';
import { truncateAndNormalize, EMBEDDING_DIM } from '@/lib/clip-embeddings';

const CLIP_MODELS_ROOT = process.env.CLIP_MODELS_ROOT ?? join(process.cwd(), 'data/models/clip');
const MODEL_ID = 'jinaai/jina-clip-v2'; // confirmed in Task 1

type Extractors = {
  image: (input: unknown, opts: object) => Promise<{ data: Float32Array }>;
  text: (input: string, opts: object) => Promise<{ data: Float32Array }>;
};

let extractorsPromise: Promise<Extractors> | null = null;

async function getExtractors(): Promise<Extractors> {
  if (!extractorsPromise) {
    extractorsPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = CLIP_MODELS_ROOT;       // weights live on the ./data volume
      env.allowRemoteModels = false;          // offline: only the pre-seeded volume
      const image = await pipeline('image-feature-extraction', MODEL_ID, { dtype: 'q8' });
      const text = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
      return { image: image as unknown as Extractors['image'], text: text as unknown as Extractors['text'] };
    })().catch((err) => { extractorsPromise = null; throw err; }); // allow retry on transient load failure
  }
  return extractorsPromise;
}

/** Embed a text query. Returns a 512-dim unit vector. */
export async function embedTextReal(query: string): Promise<Float32Array> {
  const { text } = await getExtractors();
  const out = await text(query, { pooling: 'mean', normalize: false });
  if (out.data.length < EMBEDDING_DIM) throw new Error(`text embedding dim ${out.data.length} < ${EMBEDDING_DIM}`);
  return truncateAndNormalize(out.data);
}

/** Embed an image given its file path. Returns a 512-dim unit vector. */
export async function embedImageReal(imagePath: string): Promise<Float32Array> {
  const { RawImage } = await import('@huggingface/transformers');
  // Decode + downscale via Sharp (robust for any source format); feed RGB to the model.
  const { data, info } = await sharp(imagePath).resize(512, 512, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3);
  const { image } = await getExtractors();
  const out = await image(raw, { pooling: 'mean', normalize: false });
  if (out.data.length < EMBEDDING_DIM) throw new Error(`image embedding dim ${out.data.length} < ${EMBEDDING_DIM}`);
  return truncateAndNormalize(out.data);
}
```

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/clip-model-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck** (new deps + dynamic import)

Run: `npm run typecheck --workspace=apps/web`
Expected: clean (add `@huggingface/transformers` types; if missing, the dynamic-import shape above keeps it typed locally).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/clip-model.ts apps/web/src/__tests__/clip-model-contract.test.ts
git commit -S -m "feat(search): ✨ add lazy-singleton real CLIP encoder (text + image)"
git pull --rebase && git push
```

---

## Phase 2 — Config gate

### Task 5: Allow `'production'` in the validator

**Files:**
- Modify: `apps/web/src/lib/gallery-config-shared.ts:171`
- Test: `apps/web/src/__tests__/gallery-config-semantic-production.test.ts`

- [ ] **Step 1: Write the failing test**:

```typescript
import { describe, it, expect } from 'vitest';
import { GALLERY_SETTING_VALIDATORS } from '@/lib/gallery-config-shared';

describe('semantic_search_mode validator', () => {
  const v = GALLERY_SETTING_VALIDATORS.semantic_search_mode;
  it('accepts disabled, stub, AND production', () => {
    expect(v('disabled')).toBe(true);
    expect(v('stub')).toBe(true);
    expect(v('production')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(v('prod')).toBe(false);
    expect(v('')).toBe(false);
  });
});
```

(If the validators are exported under a different symbol, import that — confirm the export name in `gallery-config-shared.ts`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/gallery-config-semantic-production.test.ts`
Expected: FAIL (`v('production')` is `false`).

- [ ] **Step 3: Update the validator** (line 171) and its comment:

```typescript
  // US-P51: real ONNX encoder shipped — 'production' is now storable.
  // The route + hook gate reads/writes on the active model_version so stub rows
  // are never served as production.
  semantic_search_mode: (v) => v === 'disabled' || v === 'stub' || v === 'production',
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/gallery-config-semantic-production.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/gallery-config-shared.ts apps/web/src/__tests__/gallery-config-semantic-production.test.ts
git commit -S -m "feat(search): ✨ allow semantic_search_mode=production in the validator"
git pull --rebase && git push
```

### Task 6: Widen the resolved `semanticSearchMode` type

**Files:**
- Modify: `apps/web/src/lib/gallery-config.ts` (the resolver that returns `semanticSearchMode`)

- [ ] **Step 1: Find the type** — `rg -n "semanticSearchMode" apps/web/src/lib/gallery-config.ts`. It is typed `'disabled' | 'stub'`.

- [ ] **Step 2: Widen it** to `'disabled' | 'stub' | 'production'` at the resolver return type and any local annotation. If the resolver clamps/falls back unknown values to `'disabled'`, keep that — just add `'production'` to the allowed set so a stored `'production'` is preserved.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=apps/web`
Expected: this surfaces every consumer that narrowed to `'disabled' | 'stub'` (route line 223, image-queue line 433) — those are fixed in Tasks 7 & 8. It is OK for typecheck to still flag those two until then; if you prefer green-at-every-commit, do Tasks 6+7+8 before this commit. Otherwise commit the type widening with a note.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/gallery-config.ts
git commit -S -m "refactor(search): ♻️ widen semanticSearchMode type to include production"
git pull --rebase && git push
```

---

## Phase 3 — Query path (text → image)

### Task 7: Production branch + model_version filter in the semantic route

**Files:**
- Modify: `apps/web/src/app/api/search/semantic/route.ts`
- Test: `apps/web/src/__tests__/semantic-route-production.test.ts`

- [ ] **Step 1: Write the failing test** (mocks the encoder + db; asserts gate + filter):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gallery-config', () => ({ getGalleryConfig: vi.fn() }));
vi.mock('@/lib/clip-model', () => ({ embedTextReal: vi.fn(async () => new Float32Array(512).fill(0.04419)) }));
vi.mock('@/lib/request-origin', () => ({ hasTrustedSameOrigin: () => true }));
vi.mock('@/lib/restore-maintenance', () => ({ isRestoreMaintenanceActive: () => false }));

// Capture the model_version used in the scan .where()
const whereSpy = vi.fn();
vi.mock('@/db', () => {
  const chain = { select: () => chain, from: () => chain, leftJoin: () => chain, orderBy: () => chain, limit: () => Promise.resolve([]), where: (...a: unknown[]) => { whereSpy(...a); return chain; } };
  return { db: chain, imageEmbeddings: { imageId: 'image_id', embedding: 'embedding', modelVersion: 'model_version', updatedAt: 'updated_at' }, images: {}, topics: {} };
});

import { getGalleryConfig } from '@/lib/gallery-config';
import { embedTextReal } from '@/lib/clip-model';
import { POST } from '@/app/api/search/semantic/route';

function req(body: object) {
  return new Request('http://localhost/api/search/semantic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;
}

describe('semantic route — production', () => {
  beforeEach(() => { whereSpy.mockClear(); vi.mocked(embedTextReal).mockClear(); });

  it('serves in production mode and embeds via the REAL encoder', async () => {
    vi.mocked(getGalleryConfig).mockResolvedValue({ semanticSearchMode: 'production' } as never);
    const res = await POST(req({ query: 'sunset over the sea' }));
    expect(res.status).toBe(200);
    expect(embedTextReal).toHaveBeenCalledOnce();
  });

  it('returns 503 when mode is disabled', async () => {
    vi.mocked(getGalleryConfig).mockResolvedValue({ semanticSearchMode: 'disabled' } as never);
    const res = await POST(req({ query: 'sunset over the sea' }));
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/semantic-route-production.test.ts`
Expected: FAIL (route still only serves `'stub'` and calls `embedTextStub`).

- [ ] **Step 3: Edit the route.** Make these exact changes:

(a) Import the real encoder + production constants (after line 55):
```typescript
import { embedTextStub } from '@/lib/clip-inference';
import { embedTextReal } from '@/lib/clip-model';
import { CLIP_MODEL_VERSION, PRODUCTION_MODEL_VERSION, PRODUCTION_COSINE_THRESHOLD } from '@/lib/clip-embeddings';
```
(add `CLIP_MODEL_VERSION` to the existing `@/lib/clip-embeddings` import list; keep `COSINE_THRESHOLD`.)

(b) Widen the mode variable (line 223) and accept production (line 230):
```typescript
  let semanticMode: 'disabled' | 'stub' | 'production' = 'disabled';
  try {
    const config = await getGalleryConfig();
    semanticMode = config.semanticSearchMode;
  } catch { /* fail closed */ }
  if (semanticMode !== 'stub' && semanticMode !== 'production') {
    rollbackSemanticAttempt(ip);
    return NextResponse.json({ error: 'Semantic search is not fully configured' }, { status: 503, headers: NO_STORE_HEADERS });
  }
  const isProd = semanticMode === 'production';
  const activeModelVersion = isProd ? PRODUCTION_MODEL_VERSION : CLIP_MODEL_VERSION;
  const activeThreshold = isProd ? PRODUCTION_COSINE_THRESHOLD : COSINE_THRESHOLD;
```

(c) Embed via the real encoder in production (replace lines 239–245):
```typescript
  let queryEmbedding: Float32Array;
  try {
    queryEmbedding = isProd ? await embedTextReal(query) : embedTextStub(query);
  } catch {
    rollbackSemanticAttempt(ip);
    return NextResponse.json({ error: 'Server error' }, { status: 503, headers: NO_STORE_HEADERS });
  }
```

(d) Filter the scan to the active model version (replace the `.from(imageEmbeddings)` chain at lines 250–254):
```typescript
    rows = await db
      .select({ imageId: imageEmbeddings.imageId, embedding: imageEmbeddings.embedding })
      .from(imageEmbeddings)
      .where(eq(imageEmbeddings.modelVersion, activeModelVersion))
      .orderBy(desc(imageEmbeddings.updatedAt))
      .limit(SEMANTIC_SCAN_LIMIT);
```

(e) Use the active threshold (line 276):
```typescript
  const results = topK(scored, topKParam, activeThreshold);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/semantic-route-production.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing route tests (no regression)**

Run: `cd apps/web && npx vitest run src/__tests__/semantic-search-route.test.ts`
Expected: PASS (stub path still 503s when disabled, serves when stub).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/search/semantic/route.ts apps/web/src/__tests__/semantic-route-production.test.ts
git commit -S -m "feat(search): ✨ serve real CLIP results in production mode + model_version filter"
git pull --rebase && git push
```

---

## Phase 4 — Image embedding (upload + backfill)

### Task 8: Production branch in the upload hook

**Files:**
- Modify: `apps/web/src/lib/image-queue.ts` (lines 21–22 imports, 432–461 hook)
- Test: `apps/web/src/__tests__/image-queue-embed-wiring.test.ts` (source-shape: hook calls the real encoder + writes the production version in production mode)

- [ ] **Step 1: Write the failing wiring test**:

```typescript
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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/image-queue-embed-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Edit the hook.** Imports (lines 21–22):
```typescript
import { embedImageStub } from '@/lib/clip-inference';
import { embedImageReal } from '@/lib/clip-model';
import { embeddingToBuffer, CLIP_MODEL_VERSION, PRODUCTION_MODEL_VERSION } from '@/lib/clip-embeddings';
```
Hook body (replace lines 440–456) — `job` carries the original path; use `UPLOAD_ORIGINAL_ROOT` + the stored original filename (confirm the field on `job`, e.g. `job.filename_original`):
```typescript
      if (semanticMode === 'disabled') return;
      const isProd = semanticMode === 'production';
      try {
        let embedding: Float32Array;
        let modelVersion: string;
        if (isProd) {
          const originalPath = join(process.env.UPLOAD_ORIGINAL_ROOT ?? 'data/uploads/original', job.filename_original);
          embedding = await embedImageReal(originalPath);
          modelVersion = PRODUCTION_MODEL_VERSION;
        } else {
          embedding = embedImageStub(job.id);
          modelVersion = CLIP_MODEL_VERSION;
        }
        const base64 = embeddingToBuffer(embedding).toString('base64');
        await db.insert(imageEmbeddings)
          .values({ imageId: job.id, embedding: base64, modelVersion })
          .onDuplicateKeyUpdate({ set: { embedding: base64, modelVersion } });
        console.debug(`[Queue] Embedding stored for image ${job.id} (${modelVersion})`);
      } catch (embedErr) {
        console.warn(`[Queue] Failed to store embedding for image ${job.id}:`, embedErr);
      }
```
(Confirm the original-filename field name on the queue job via `rg -n "filename_original|originalName|filename" apps/web/src/lib/image-queue.ts`; use the real field. Add `import { join } from 'path'` if not already imported.)

- [ ] **Step 4: Run the wiring test + typecheck**

Run: `cd apps/web && npx vitest run src/__tests__/image-queue-embed-wiring.test.ts && npm run typecheck --workspace=apps/web`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/image-queue.ts apps/web/src/__tests__/image-queue-embed-wiring.test.ts
git commit -S -m "feat(search): ✨ embed uploads with the real CLIP encoder in production mode"
git pull --rebase && git push
```

### Task 9: Backfill re-embeds off stub rows + real encoder

**Files:**
- Modify: `apps/web/scripts/backfill-clip-embeddings.ts`
- Test: `apps/web/src/__tests__/backfill-clip-embeddings-reembed.test.ts` (source-shape contract)

- [ ] **Step 1: Write the failing test**:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
describe('backfill re-embed contract', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/backfill-clip-embeddings.ts'), 'utf8');
  it('re-embeds rows whose model_version != the target (not just missing rows)', () => {
    expect(src).toContain('modelVersion'); // selection considers model_version
    expect(src).toMatch(/ne\(|!=|notEq|<>/);
  });
  it('uses the real encoder under --production', () => {
    expect(src).toContain('embedImageReal');
    expect(src).toContain('--production');
  });
  it('does not gate on the obsolete semantic_search_enabled key', () => {
    expect(src).not.toContain("'semantic_search_enabled'");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/backfill-clip-embeddings-reembed.test.ts`
Expected: FAIL.

- [ ] **Step 3: Edit the backfill.** Add `--production` flag → use `embedImageReal(originalPath)` + `PRODUCTION_MODEL_VERSION`; otherwise keep stub. Change the selection so a row already embedded with a DIFFERENT model_version is re-embedded: replace the `notExists(...)` clause with a LEFT JOIN / `notExists` that also matches on the target `modelVersion` — i.e. select images where there is no embedding row with `model_version = <target>`. Delete `checkSemanticEnabled()` (it reads the obsolete `semantic_search_enabled` key); gate instead on `semantic_search_mode !== 'disabled'` via `getGalleryConfig()` (or keep `--force` to bypass). Resolve the original path the same way as the upload hook. Keep keyset pagination, BATCH_SIZE/CONCURRENCY, the `--rm` sidecar usage note.

- [ ] **Step 4: Run the test + typecheck**

Run: `cd apps/web && npx vitest run src/__tests__/backfill-clip-embeddings-reembed.test.ts && npm run typecheck --workspace=apps/web`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/backfill-clip-embeddings.ts apps/web/src/__tests__/backfill-clip-embeddings-reembed.test.ts
git commit -S -m "feat(search): ✨ backfill re-embeds stub rows with real CLIP under --production"
git pull --rebase && git push
```

---

## Phase 5 — Similar photos (image → image)

### Task 10: `/api/search/similar/[id]` endpoint

**Files:**
- Create: `apps/web/src/app/api/search/similar/[id]/route.ts`
- Test: `apps/web/src/__tests__/similar-route.test.ts`

- [ ] **Step 1: Write the failing test** — asserts: 403 without same-origin; 503 unless mode is `production`; excludes self; filters to `PRODUCTION_MODEL_VERSION`; returns `{ results: [...] }`. (Mock `@/db`, `@/lib/gallery-config`, `@/lib/request-origin` like Task 7; seed two rows, assert the queried row is excluded and the other returned.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/similar-route.test.ts`
Expected: FAIL (route does not exist).

- [ ] **Step 3: Implement the route.** GET handler keyed by `params.id`: same-origin + maintenance + rate-limit (reuse `preIncrementSemanticAttempt`); 503 unless `getGalleryConfig().semanticSearchMode === 'production'`; load the target row's embedding (filtered to `PRODUCTION_MODEL_VERSION`) → 404 if absent; scan the other `PRODUCTION_MODEL_VERSION` rows (limit `SEMANTIC_SCAN_LIMIT`), cosine, exclude self, `topK` above `PRODUCTION_COSINE_THRESHOLD`; enrich with the same image metadata SELECT/JOIN as the semantic route; return `{ results }` with `NO_STORE_HEADERS`. Reuse `cosineSimilarity`, `bufferToEmbedding`, `topK`, `EMBEDDING_BYTES`.

- [ ] **Step 4: Run the test + the public-route rate-limit lint** (new public POST/GET must satisfy the gate)

Run: `cd apps/web && npx vitest run src/__tests__/similar-route.test.ts && npm run lint:public-route-rate-limit --workspace=apps/web`
Expected: PASS. (Similar route is a public GET — rate-limit lint scans mutating handlers; if it flags, add the documented `@public-no-rate-limit-required` exemption with a reason OR keep the pre-increment. Follow whichever the existing semantic route uses.)

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/search/similar/[id]/route.ts" apps/web/src/__tests__/similar-route.test.ts
git commit -S -m "feat(search): ✨ add image-to-image 'similar photos' endpoint"
git pull --rebase && git push
```

### Task 11: `<SimilarPhotos>` component + photo-viewer mount + i18n

**Files:**
- Create: `apps/web/src/components/similar-photos.tsx`
- Modify: `apps/web/src/components/photo-viewer.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/ko.json`
- Test: `apps/web/src/__tests__/i18n-key-parity.test.ts` (already exists — must stay green after adding keys)

- [ ] **Step 1: Add i18n keys** to the `search` object in BOTH files (en first):

`en.json`:
```json
    "similarPhotos": "Similar photos",
    "similarEmpty": "No similar photos found."
```
`ko.json`:
```json
    "similarPhotos": "비슷한 사진",
    "similarEmpty": "비슷한 사진을 찾지 못했습니다."
```

- [ ] **Step 2: Run the parity test to verify keys match**

Run: `cd apps/web && npx vitest run src/__tests__/i18n-key-parity.test.ts`
Expected: PASS (same key set both files).

- [ ] **Step 3: Create `similar-photos.tsx`** — a client component `('use client')` taking `imageId: number`; on mount (or on a "Similar photos" button click to avoid eager fetch) `fetch('/api/search/similar/' + imageId)`; render a small grid of result thumbnails linking to `/p/{id}`; render `t('search.similarEmpty')` when empty; section heading `t('search.similarPhotos')`. Any interactive control ≥ 44px (touch-target audit). Use `next-intl` `useTranslations` like sibling components.

- [ ] **Step 4: Mount in `photo-viewer.tsx`** — render `<SimilarPhotos imageId={image.id} />` below the existing content (e.g. near `<ColorDetailsSection>`). Confirm the prop name for the image id via `rg -n "ColorDetailsSection|image\.id" apps/web/src/components/photo-viewer.tsx`.

- [ ] **Step 5: Run touch-target audit + typecheck + build smoke**

Run: `cd apps/web && npx vitest run src/__tests__/touch-target-audit.test.ts && npm run typecheck --workspace=apps/web`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/similar-photos.tsx apps/web/src/components/photo-viewer.tsx apps/web/messages/en.json apps/web/messages/ko.json
git commit -S -m "feat(search): ✨ add 'similar photos' panel to the photo viewer"
git pull --rebase && git push
```

---

## Phase 6 — Honesty UI

### Task 12: Hide the experimental disclaimer in production

**Files:**
- Modify: `apps/web/src/components/search.tsx` (lines 438–444)
- Test: `apps/web/src/__tests__/search-disclaimer.test.ts` (source-shape contract)

- [ ] **Step 1: Write the failing test**:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
describe('search disclaimer', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/search.tsx'), 'utf8');
  it('shows semanticExperimentalHint only in stub mode, not production', () => {
    // the hint render must be guarded by a stub-only condition
    expect(src).toMatch(/semanticSearchMode === 'stub'[^]*semanticExperimentalHint/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/search-disclaimer.test.ts`
Expected: FAIL (hint currently renders for any non-disabled mode).

- [ ] **Step 3: Guard the disclaimer** (lines 442–444): wrap the `<p id="semantic-search-hint">…</p>` in `{semanticSearchMode === 'stub' && ( … )}`. Keep the toggle visible for both `stub` and `production` (the outer `!== 'disabled'` guard stays). If `aria-describedby="semantic-search-hint"` on the `<Switch>` now points to a sometimes-absent node, make the `aria-describedby` conditional on stub mode too.

- [ ] **Step 4: Run the test + touch-target audit**

Run: `cd apps/web && npx vitest run src/__tests__/search-disclaimer.test.ts src/__tests__/touch-target-audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/search.tsx apps/web/src/__tests__/search-disclaimer.test.ts
git commit -S -m "fix(search): 🔒 drop the experimental disclaimer in production mode"
git pull --rebase && git push
```

---

## Phase 7 — Docker / ops

### Task 13: Dockerfile — native dep + model dir

**Files:**
- Modify: `apps/web/Dockerfile` (deps stage ~44–51, prod-deps stage ~53–57, runner mkdir ~97)

- [ ] **Step 1: Add `onnxruntime-node` platform binary to the `deps` stage** install list (mirroring the Sharp `TARGETARCH` pattern at lines 44–51), and ensure it is a production dependency in `apps/web/package.json` so the `prod-deps` stage (`npm ci --omit=dev`) includes it. (If Task 1 chose Transformers.js, `onnxruntime-node` is its transitive dep — still verify the linux binary is installed in both `deps` and `prod-deps`.)

- [ ] **Step 2: Create the model dir** in the runner `mkdir -p` (line ~97):
```dockerfile
RUN mkdir -p apps/web/public/uploads /app/data/uploads/original /app/data/models/clip apps/web/.next/cache && chown -R node:node apps/web/public/uploads /app/data apps/web/.next
```
Add `ENV CLIP_MODELS_ROOT="/app/data/models/clip"` near the other ENVs (line ~84). Weights are NOT copied into the image — they live on the `./data` bind mount (persisted, downloaded once via Task 2's script run on the host, or pre-seeded).

- [ ] **Step 3: Local build smoke**

Run: `docker build -f apps/web/Dockerfile -t gk-clip-test ..` (from `apps/web`, context repo root)
Expected: build succeeds; `onnxruntime-node` native binary present. (If build is too heavy locally, defer to the deploy build but inspect logs.)

- [ ] **Step 4: Document the offline pre-seed** in CLAUDE.md (Color/HDR backfill section style): how to run `download-clip-models.ts` on the host into `apps/web/data/models/clip` before flipping to production, and that `./data/models` is bind-mounted (survives the deploy.sh auto-prune — bind mounts are never pruned).

- [ ] **Step 5: Commit**

```bash
git add apps/web/Dockerfile apps/web/package.json apps/web/package-lock.json CLAUDE.md
git commit -S -m "build(search): 🔧 ship onnxruntime-node + data/models/clip volume dir"
git pull --rebase && git push
```

---

## Phase 8 — Calibration, anti-vacuity, rollout

### Task 14: Calibrate the production threshold

**Files:**
- Create: `apps/web/src/__tests__/fixtures/clip/` (3–4 small public-domain JPEGs: e.g. `beach-sunset.jpg`, `snowy-mountain.jpg`, `city-night.jpg`)
- Modify: `apps/web/src/lib/clip-embeddings.ts` (`PRODUCTION_COSINE_THRESHOLD`)
- Create: `apps/web/scripts/_calibrate-threshold.ts` (throwaway) OR a gated test

- [ ] **Step 1: Add fixtures.** Commit 3–4 tiny (<50 KB) Creative-Commons/CC0 JPEGs with obvious content.

- [ ] **Step 2: Measure.** Write a throwaway script that embeds each fixture image + a matching ko phrase + a matching en phrase + 2 unrelated phrases, prints the cosine matrix.

Run: `cd apps/web && npx tsx scripts/_calibrate-threshold.ts`
Expected: matching pairs cluster above a clear gap from non-matching pairs.

- [ ] **Step 3: Set the threshold** to the midpoint of that gap (e.g. if matches ≥ 0.28 and non-matches ≤ 0.20, set `PRODUCTION_COSINE_THRESHOLD = 0.24`). Update the constant. Delete the throwaway script.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/clip-embeddings.ts apps/web/src/__tests__/fixtures/clip/
git commit -S -m "feat(search): 🎚️ calibrate production cosine threshold from ko+en probe"
git pull --rebase && git push
```

### Task 15: Anti-vacuity integration smoke (the proof it's real)

**Files:**
- Create: `apps/web/src/__tests__/clip-semantic-integration.test.ts`

- [ ] **Step 1: Write the test** — gated behind an env flag so default CI (no weights) skips, but it runs where weights exist:

```typescript
import { describe, it, expect } from 'vitest';
import { join } from 'path';
const RUN = process.env.CLIP_INTEGRATION === '1';
const d = RUN ? describe : describe.skip;

d('CLIP integration — real semantic ranking (ko + en)', () => {
  it('ranks the matching fixture first for an English query', async () => {
    const { embedImageReal, embedTextReal } = await import('@/lib/clip-model');
    const { cosineSimilarity } = await import('@/lib/clip-embeddings');
    const dir = join(process.cwd(), 'src/__tests__/fixtures/clip');
    const beach = await embedImageReal(join(dir, 'beach-sunset.jpg'));
    const mountain = await embedImageReal(join(dir, 'snowy-mountain.jpg'));
    const q = await embedTextReal('a sunset over the ocean');
    expect(cosineSimilarity(q, beach)).toBeGreaterThan(cosineSimilarity(q, mountain));
  });
  it('ranks the matching fixture first for a KOREAN query', async () => {
    const { embedImageReal, embedTextReal } = await import('@/lib/clip-model');
    const { cosineSimilarity } = await import('@/lib/clip-embeddings');
    const dir = join(process.cwd(), 'src/__tests__/fixtures/clip');
    const beach = await embedImageReal(join(dir, 'beach-sunset.jpg'));
    const mountain = await embedImageReal(join(dir, 'snowy-mountain.jpg'));
    const q = await embedTextReal('노을 진 바다');
    expect(cosineSimilarity(q, beach)).toBeGreaterThan(cosineSimilarity(q, mountain));
  });
});
```

- [ ] **Step 2: Run it WITH weights to verify it passes**

Run: `cd apps/web && CLIP_INTEGRATION=1 CLIP_MODELS_ROOT=data/models/clip npx vitest run src/__tests__/clip-semantic-integration.test.ts`
Expected: PASS (both ko + en). This is the anti-vacuity proof — it FAILS against the stub encoder (random vectors).

- [ ] **Step 3: Verify it FAILS against the stub** (sanity): temporarily point the test imports at `embedImageStub`/`embedTextStub`, confirm RED, revert. (Documents the test is non-vacuous; do not commit the temporary edit.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/__tests__/clip-semantic-integration.test.ts
git commit -S -m "test(search): ✅ anti-vacuity ko+en CLIP ranking smoke (gated on weights)"
git pull --rebase && git push
```

### Task 16: Full gate sweep, backfill, flip to production, deploy

- [ ] **Step 1: Run every gate green**

Run:
```bash
npm run typecheck --workspace=apps/web
npm run lint --workspace=apps/web
npm run lint:api-auth --workspace=apps/web
npm run lint:action-origin --workspace=apps/web
npm run lint:public-route-rate-limit --workspace=apps/web
npm run test --workspace=apps/web
```
Expected: all green. Fix any failure at root cause (no suppressions) and commit.

- [ ] **Step 2: Deploy** (deploy.sh now auto-prunes Docker safely): `npm run deploy`. Expected: "Deployment Complete!", site 200.

- [ ] **Step 3: Seed weights on the host** (one-time): run `download-clip-models.ts` into `apps/web/data/models/clip` on the deploy host (via the `--rm` sidecar pattern in CLAUDE.md, or directly since `data/` is a bind mount).

- [ ] **Step 4: Backfill real embeddings** via the `--rm` sidecar:
```bash
# on the host, off the just-built image, read-only source mounts (see CLAUDE.md Backfill)
... npx tsx scripts/backfill-clip-embeddings.ts --production
```
Expected: every processed image gets a `PRODUCTION_MODEL_VERSION` embedding row; stub rows superseded.

- [ ] **Step 5: Flip the admin setting** `semantic_search_mode` → `production` in Admin → Settings. Verify: the search box no longer shows the experimental disclaimer; a Korean and an English query return relevant photos; "similar photos" works on a photo page.

- [ ] **Step 6: Final commit if any gate fixes were needed**, then confirm `master` is in sync and deployed.

---

## Self-Review

**Spec coverage:** §2 model/dim/runtime → Tasks 1,3,4,13. §3 change surface → all tasks. §4 embedding generation → Tasks 8,9. §5 query path + model_version filter + threshold → Tasks 7,14. §6 similar photos → Tasks 10,11. §7 config gate + honesty → Tasks 5,6,7,12. §8 Docker → Task 13. §9 error handling → Tasks 4 (retry-on-load-fail), 7 (503), 8 (fire-and-forget). §10 testing → Tasks 2,3,4,5,7,8,9,10,12,15. §11 out-of-scope respected (no ANN/GPU/1024/Florence-2/HDR). §12 open items → Task 1 spike. **No gaps.**

**Placeholder scan:** `PRODUCTION_COSINE_THRESHOLD` starts at 0.25 and is explicitly calibrated in Task 14 (not a TODO). The spike (Task 1) is an investigation with concrete commands + a decision record, not "implement later." Field-name confirmations (job original filename, photo-viewer prop) are explicit `rg` steps with the real lookup, not vague hand-waves.

**Type consistency:** `embedTextReal`/`embedImageReal` (Task 4) are the exact names used in Tasks 7,8,9,15. `PRODUCTION_MODEL_VERSION` / `PRODUCTION_COSINE_THRESHOLD` / `normalizeEmbedding` / `truncateAndNormalize` (Task 3) match every consumer. `semanticSearchMode: 'disabled'|'stub'|'production'` widened in Task 6, consumed in Tasks 7,8,12. `model_version` filter uses `imageEmbeddings.modelVersion` (the schema field from §5 ground truth). Consistent.
