import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { eq, inArray } from 'drizzle-orm';
import { generateBase56 } from '../src/lib/base56';
import { UPLOAD_ORIGINAL_ROOT, UPLOAD_ROOT } from '../src/lib/upload-paths';
import { DEFAULT_IMAGE_SIZES, parseImageSizes } from '../src/lib/gallery-config-shared';

// C1R-05: honor the configured/default image-size contract instead of a
// hard-coded list. The test E2E pipeline expects derivatives at every
// configured size; falling back to a static array causes silent drift when
// the defaults change.
const CANONICAL_SIZE = 2048;
const SEED_IMAGE_SIZES: number[] = (() => {
  const configured = process.env.IMAGE_SIZES?.trim();
  if (configured) {
    const parsed = parseImageSizes(configured);
    if (parsed.length > 0) return parsed;
  }
  return [...DEFAULT_IMAGE_SIZES];
})();

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

type SeedImage = {
  key: string;
  title: string;
  description: string;
  width: number;
  height: number;
  createdAt: string;
  captureDate: string;
  tagNames: string[];
};

const seedTopic = {
  slug: 'e2e-smoke',
  label: 'E2E Smoke',
  order: 999,
};

const seedTopicAliases = ['spotlight-smoke'];

const seedImages: SeedImage[] = [
  {
    key: 'e2e-landscape',
    title: 'E2E Landscape',
    description: 'Seeded landscape image for Playwright validation',
    width: 1600,
    height: 900,
    createdAt: '2025-01-01 09:00:00',
    captureDate: '2025-01-01 08:00:00',
    tagNames: ['e2e', 'landscape'],
  },
  {
    key: 'e2e-portrait',
    title: 'E2E Portrait',
    description: 'Seeded portrait image for Playwright validation',
    width: 900,
    height: 1400,
    createdAt: '2025-01-02 09:00:00',
    captureDate: '2025-01-02 08:00:00',
    tagNames: ['e2e', 'portrait'],
  },
];

const uploadRoot = UPLOAD_ROOT;
const dirs = {
  original: UPLOAD_ORIGINAL_ROOT,
  jpeg: path.join(uploadRoot, 'jpeg'),
  webp: path.join(uploadRoot, 'webp'),
  avif: path.join(uploadRoot, 'avif'),
};

async function ensureDirs() {
  await Promise.all(Object.values(dirs).map((dir) => fs.mkdir(dir, { recursive: true })));
}

async function createVariants(baseName: string, width: number, height: number, hue: number) {
  const base = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: (hue * 53) % 255, g: (hue * 97) % 255, b: (hue * 149) % 255 },
    },
  }).jpeg({ quality: 92 });

  await base.toFile(path.join(dirs.original, `${baseName}.jpg`));

  for (const size of SEED_IMAGE_SIZES) {
    const resizeWidth = Math.min(size, width);
    const pipeline = sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: (hue * 53) % 255, g: (hue * 97) % 255, b: (hue * 149) % 255 },
      },
    }).resize({ width: resizeWidth });

    await Promise.all([
      pipeline.clone().jpeg({ quality: 90 }).toFile(path.join(dirs.jpeg, `${baseName}_${size}.jpg`)),
      pipeline.clone().webp({ quality: 90 }).toFile(path.join(dirs.webp, `${baseName}_${size}.webp`)),
      pipeline.clone().avif({ quality: 85 }).toFile(path.join(dirs.avif, `${baseName}_${size}.avif`)),
    ]);
  }

  // Canonical (unsuffixed) derivative: prefer the 2048 variant if configured,
  // otherwise fall back to the largest configured size so the <picture>
  // srcset defaults continue to resolve.
  const canonicalSize = SEED_IMAGE_SIZES.includes(CANONICAL_SIZE)
    ? CANONICAL_SIZE
    : SEED_IMAGE_SIZES[SEED_IMAGE_SIZES.length - 1];
  await Promise.all([
    fs.copyFile(path.join(dirs.jpeg, `${baseName}_${canonicalSize}.jpg`), path.join(dirs.jpeg, `${baseName}.jpg`)),
    fs.copyFile(path.join(dirs.webp, `${baseName}_${canonicalSize}.webp`), path.join(dirs.webp, `${baseName}.webp`)),
    fs.copyFile(path.join(dirs.avif, `${baseName}_${canonicalSize}.avif`), path.join(dirs.avif, `${baseName}.avif`)),
  ]);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
      console.error('Refusing to run seed-e2e in production environment');
      process.exit(1);
  }

  await ensureDirs();

  const { connection, db, images, imageTags, sharedGroupImages, sharedGroups, tags, topicAliases, topics } = await import('../src/db');

  try {
    await db.insert(topics).values(seedTopic).onDuplicateKeyUpdate({
      set: { label: seedTopic.label, order: seedTopic.order },
    });
    await db.delete(topicAliases).where(eq(topicAliases.topicSlug, seedTopic.slug));
    if (seedTopicAliases.length > 0) {
      await db.insert(topicAliases).values(
        seedTopicAliases.map((alias) => ({
          alias,
          topicSlug: seedTopic.slug,
        }))
      );
    }

    const existing = await db.select({ id: images.id, filename_original: images.filename_original, filename_jpeg: images.filename_jpeg, filename_webp: images.filename_webp, filename_avif: images.filename_avif })
      .from(images)
      .where(eq(images.topic, seedTopic.slug));

    const existingIds = existing.map((row) => row.id);
    if (existingIds.length > 0) {
      await db.delete(imageTags).where(inArray(imageTags.imageId, existingIds));
      await db.delete(sharedGroupImages).where(inArray(sharedGroupImages.imageId, existingIds));
      await db.delete(images).where(inArray(images.id, existingIds));

      await Promise.all(existing.flatMap((row) => [
        fs.rm(path.join(dirs.original, row.filename_original), { force: true }),
        fs.rm(path.join(dirs.jpeg, row.filename_jpeg), { force: true }),
        fs.rm(path.join(dirs.webp, row.filename_webp), { force: true }),
        fs.rm(path.join(dirs.avif, row.filename_avif), { force: true }),
        ...SEED_IMAGE_SIZES.flatMap((size) => [
          fs.rm(path.join(dirs.jpeg, row.filename_jpeg.replace('.jpg', `_${size}.jpg`)), { force: true }),
          fs.rm(path.join(dirs.webp, row.filename_webp.replace('.webp', `_${size}.webp`)), { force: true }),
          fs.rm(path.join(dirs.avif, row.filename_avif.replace('.avif', `_${size}.avif`)), { force: true }),
        ]),
      ]));
    }

    const tagIds = new Map<string, number>();
    for (const name of ['e2e', 'landscape', 'portrait']) {
      const slug = name;
      await db.insert(tags).values({ name, slug }).onDuplicateKeyUpdate({ set: { name } });
      const [tag] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).limit(1);
      if (tag) tagIds.set(name, tag.id);
    }

    const insertedIds: number[] = [];
    for (const [index, image] of seedImages.entries()) {
      const baseName = image.key;
      await createVariants(baseName, image.width, image.height, index + 1);

      const [result] = await db.insert(images).values({
        filename_original: `${baseName}.jpg`,
        filename_avif: `${baseName}.avif`,
        filename_webp: `${baseName}.webp`,
        filename_jpeg: `${baseName}.jpg`,
        width: image.width,
        height: image.height,
        original_width: image.width,
        original_height: image.height,
        title: image.title,
        description: image.description,
        user_filename: `${baseName}.jpg`,
        share_key: generateBase56(10),
        topic: seedTopic.slug,
        capture_date: image.captureDate,
        blur_data_url: null,
        processed: true,
        created_at: new Date(`${image.createdAt.replace(' ', 'T')}Z`) as never,
        updated_at: new Date(`${image.createdAt.replace(' ', 'T')}Z`) as never,
      });

      const imageId = result.insertId;
      insertedIds.push(imageId);

      for (const tagName of image.tagNames) {
        const tagId = tagIds.get(tagName);
        if (!tagId) continue;
        await db.insert(imageTags).values({ imageId, tagId }).onDuplicateKeyUpdate({ set: { imageId, tagId } });
      }
    }

    await db.delete(sharedGroupImages).where(inArray(sharedGroupImages.imageId, insertedIds));
    await db.delete(sharedGroups).where(eq(sharedGroups.key, 'Abc234Def5'));
    const [groupResult] = await db.insert(sharedGroups).values({ key: 'Abc234Def5', view_count: 0, expires_at: null });
    const groupId = groupResult.insertId;
    await db.insert(sharedGroupImages).values(insertedIds.map((imageId, position) => ({ groupId, imageId, position })));

    console.log(`Seeded E2E topic ${seedTopic.slug} with ${insertedIds.length} images and aliases ${seedTopicAliases.join(', ') || '(none)'}.`);
  } finally {
    await connection.end();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
