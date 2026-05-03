#!/usr/bin/env tsx
/**
 * scripts/download-clip-models.ts
 *
 * Placeholder script for US-P51 CLIP model download.
 *
 * STUB MODE: onnxruntime-node + CLIP ViT-B/32 ONNX models are deferred to a
 * future cycle. The combined download is ~750 MB (CLIP image encoder + text
 * encoder + tokenizer) and requires a Hugging Face access token.
 *
 * When real ONNX inference ships, this script will:
 *   1. Download CLIP ViT-B/32 image encoder ONNX to data/models/clip/image_encoder.onnx
 *   2. Download CLIP ViT-B/32 text encoder ONNX to data/models/clip/text_encoder.onnx
 *   3. Download the BPE tokenizer vocab to data/models/clip/tokenizer/
 *   4. Verify SHA-256 checksums against a manifest
 *
 * TODO(US-P51): Implement download when replacing the stub encoder with real ONNX inference.
 */

console.log('[download-clip-models] Running in stub mode.');
console.log('[download-clip-models] ONNX models not needed for stub mode; deferred to real-ONNX cycle.');
console.log('[download-clip-models] When real ONNX inference ships:');
console.log('  - Add onnxruntime-node as a dependency');
console.log('  - Download CLIP ViT-B/32 ONNX weights to data/models/clip/');
console.log('  - Update clip-inference.ts to load the models via InferenceSession');
