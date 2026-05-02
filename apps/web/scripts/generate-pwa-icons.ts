/**
 * generate-pwa-icons.ts — Generates PWA icons using Sharp.
 *
 * Produces:
 *   public/icons/icon-192.png        (192x192, transparent bg)
 *   public/icons/icon-512.png        (512x512, transparent bg)
 *   public/icons/icon-maskable-512.png (512x512, with safe-zone padding, dark bg)
 *
 * Since there is no raster source image, we construct a minimal SVG buffer
 * matching the GalleryKit logo (image frame + sun + mountain) and rasterise
 * via Sharp's SVG input support.
 *
 * Run via the prebuild hook in package.json.
 *
 * US-P24 PWA story.
 */

import sharp from 'sharp';
import { mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '..');
const iconsDir = resolve(root, 'public', 'icons');

if (!existsSync(iconsDir)) {
  mkdirSync(iconsDir, { recursive: true });
}

/**
 * Build an SVG string for the GalleryKit logo at the requested canvas size.
 * iconSize is the pixel dimensions of the SVG/icon canvas.
 * For maskable icons, padding shrinks the drawable area to the 80% safe zone.
 */
function buildSvg(canvasSize: number, maskable: boolean): Buffer {
  const bg = '#09090b';
  const strokeColor = '#a1a1aa';
  const detailColor = '#e4e4e7';
  const radius = maskable ? Math.round(canvasSize * 0.12) : Math.round(canvasSize * 0.18);

  // Scale factor from the 120×120 reference viewBox
  const scale = canvasSize / 120;
  const strokeWidth = Math.max(1, 4 * scale);

  // Proportional inset for maskable safe zone (10% each side = 80% safe area)
  const inset = maskable ? canvasSize * 0.1 : 0;
  const drawSize = canvasSize - inset * 2;

  // Logo coordinates in reference 120×120 space, scaled
  const s = (n: number) => (n * drawSize) / 120 + inset;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}">
  <rect width="${canvasSize}" height="${canvasSize}" rx="${radius}" fill="${bg}"/>
  <rect x="${s(16)}" y="${s(26)}" width="${s(88) - s(16)}" height="${s(94) - s(26)}" rx="${4 * scale}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none"/>
  <circle cx="${s(42)}" cy="${s(48)}" r="${9 * scale}" stroke="${detailColor}" stroke-width="${strokeWidth}" fill="none"/>
  <path d="M${s(16)} ${s(78)} L${s(46)} ${s(54)} L${s(68)} ${s(72)} L${s(82)} ${s(60)} L${s(104)} ${s(82)}" stroke="${detailColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

  return Buffer.from(svg);
}

async function generate() {
  const sizes: Array<{ name: string; size: number; maskable: boolean }> = [
    { name: 'icon-192.png', size: 192, maskable: false },
    { name: 'icon-512.png', size: 512, maskable: false },
    { name: 'icon-maskable-512.png', size: 512, maskable: true },
  ];

  for (const { name, size, maskable } of sizes) {
    const svg = buildSvg(size, maskable);
    const outPath = resolve(iconsDir, name);
    await sharp(svg)
      .png()
      .toFile(outPath);
    console.log(`[generate-pwa-icons] wrote ${name} (${size}x${size}${maskable ? ', maskable' : ''})`);
  }
}

generate().catch((err: unknown) => {
  console.error('[generate-pwa-icons] ERROR:', err);
  process.exit(1);
});
