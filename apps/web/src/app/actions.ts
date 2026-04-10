'use server';

import * as argon2 from 'argon2';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { isIP } from 'net';

/** Hash a session token for storage — so DB compromise doesn't yield usable cookies. */
function hashSessionToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

import { cookies, headers } from 'next/headers';
import { saveOriginalAndGetMetadata, processImageFormats, extractExifForDb, deleteImageVariants, UPLOAD_DIR_ORIGINAL, UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG } from '@/lib/process-image';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { db, images, topics, topicAliases, adminSettings, sharedGroups, sharedGroupImages, tags, imageTags, adminUsers, sessions } from '@/db';
import { eq, sql, and, desc, or, isNull, inArray } from 'drizzle-orm';
import path from 'path';
import fs from 'fs/promises';
import { generateBase56 } from '@/lib/base56';
import { processTopicImage } from '@/lib/process-topic-image';
import PQueue from 'p-queue';
import { getTranslations } from 'next-intl/server';
import { getImages, searchImages } from '@/lib/data';
import { cache } from 'react';

const processingQueueKey = Symbol.for('gallerykit.imageProcessingQueue');

type ImageProcessingJob = {
    id: number;
    filenameOriginal: string;
    filenameWebp: string;
    filenameAvif: string;
    filenameJpeg: string;
    width: number;
};

type ProcessingQueueState = {
    queue: PQueue;
    enqueued: Set<number>;
    bootstrapped: boolean;
    gcInterval?: ReturnType<typeof setInterval>;
};

const getProcessingQueueState = (): ProcessingQueueState => {
    const globalWithQueue = globalThis as typeof globalThis & {
        [processingQueueKey]?: ProcessingQueueState;
    };

    if (!globalWithQueue[processingQueueKey]) {
        globalWithQueue[processingQueueKey] = {
            queue: new PQueue({ concurrency: 1 }),
            enqueued: new Set<number>(),
            bootstrapped: false,
        };
    }

    return globalWithQueue[processingQueueKey]!;
};

const enqueueImageProcessing = (job: ImageProcessingJob) => {
    const state = getProcessingQueueState();
    if (state.enqueued.has(job.id)) return;

    console.debug(`[Queue] Enqueuing job ${job.id}`);
    state.enqueued.add(job.id);
    state.queue.start();

    // Explicitly add to queue
    state.queue.add(async () => {
        console.debug(`[Queue] Processing job ${job.id} started`);
        try {
            // US-009: Claim check — verify the row still exists and is unprocessed
            const [check] = await db.select({ id: images.id }).from(images)
                .where(and(eq(images.id, job.id), eq(images.processed, false)));
            if (!check) {
                console.debug(`[Queue] Image ${job.id} no longer pending, skipping`);
                return;
            }

            const originalPath = path.join(UPLOAD_DIR_ORIGINAL, job.filenameOriginal);

            // Check if file exists before processing to avoid errors
            try {
                await fs.access(originalPath);
            } catch {
                console.error(`[Queue] File not found for job ${job.id}: ${originalPath}`);
                return;
            }

            // Pass file path (not buffer) so Sharp uses native mmap — avoids
            // pinning the entire image (up to 200MB) on the Node.js heap.
            await processImageFormats(
                originalPath,
                job.filenameWebp,
                job.filenameAvif,
                job.filenameJpeg,
                job.width,
            );

            // US-001: Conditional update — only mark processed if still unprocessed (not deleted)
            const [updateResult] = await db.update(images)
                .set({ processed: true })
                .where(and(eq(images.id, job.id), eq(images.processed, false)));

            if (updateResult.affectedRows === 0) {
                // Image was deleted during processing — clean up generated format files
                console.debug(`[Queue] Image ${job.id} was deleted during processing, cleaning up`);
                await Promise.all([
                    deleteImageVariants(UPLOAD_DIR_WEBP, job.filenameWebp),
                    deleteImageVariants(UPLOAD_DIR_AVIF, job.filenameAvif),
                    deleteImageVariants(UPLOAD_DIR_JPEG, job.filenameJpeg),
                ]);
                return;
            }

            console.debug(`[Queue] Job ${job.id} complete`);
            revalidatePath('/');
            revalidatePath('/admin/dashboard');
        } catch (err) {
            console.error(`Background processing failed for ${job.id}`, err);
        } finally {
            state.enqueued.delete(job.id);
        }
    });
};

const bootstrapImageProcessingQueue = async () => {
    const state = getProcessingQueueState();
    if (state.bootstrapped) return;

    try {
        // Select only the columns needed for enqueue — avoids fetching blob-like fields
        // (blur_data_url, description) for potentially hundreds of unprocessed images.
        const pending = await db.select({
            id: images.id,
            filename_original: images.filename_original,
            filename_webp: images.filename_webp,
            filename_avif: images.filename_avif,
            filename_jpeg: images.filename_jpeg,
            width: images.width,
        }).from(images).where(eq(images.processed, false));
        for (const image of pending) {
            enqueueImageProcessing({
                id: image.id,
                filenameOriginal: image.filename_original,
                filenameWebp: image.filename_webp,
                filenameAvif: image.filename_avif,
                filenameJpeg: image.filename_jpeg,
                width: image.width,
            });

        }
        state.bootstrapped = true;

        // US-004: Purge expired sessions on startup and periodically
        purgeExpiredSessions();
        if (state.gcInterval) clearInterval(state.gcInterval);
        state.gcInterval = setInterval(purgeExpiredSessions, 60 * 60 * 1000); // every hour
    } catch (err: unknown) {
        // Suppress connection refused errors during build/startup to avoid noise
        if (!(err instanceof Error && (('code' in err && (err as { code: string }).code === 'ECONNREFUSED') || (err.cause && typeof err.cause === 'object' && 'code' in err.cause && (err.cause as { code: string }).code === 'ECONNREFUSED')))) {
            console.error('Failed to bootstrap image processing queue', err);
        } else {
             console.warn('Could not connect to database to bootstrap queue (ECONNREFUSED). Skipping.');
        }
    }
};

async function purgeExpiredSessions() {
    try {
        await db.delete(sessions).where(sql`${sessions.expiresAt} < NOW()`);
    } catch (err) {
        console.error('Failed to purge expired sessions', err);
    }
}

void bootstrapImageProcessingQueue();

// Secret for signing session tokens
const COOKIE_NAME = 'admin_session';

const PHOTO_SHARE_KEY_LENGTH = 10;
const GROUP_SHARE_KEY_LENGTH = 10;

const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_RATE_LIMIT_MAX_KEYS = 5000;

/** Type guard for MySQL/Drizzle errors with `.code` property. */
function isMySQLError(e: unknown): e is Error & { code: string; cause?: { code?: string } } {
    return e instanceof Error && 'code' in e && typeof (e as { code: unknown }).code === 'string';
}

type RateLimitEntry = { count: number; lastAttempt: number };

// Rate limiting: client IP -> { count, lastAttempt }
const loginRateLimit = new Map<string, RateLimitEntry>();

type HeaderLike = { get(name: string): string | null };

function normalizeIp(value: string | null): string | null {
    if (!value) return null;
    let candidate = value.trim();
    if (!candidate) return null;

    // Handle bracketed IPv6 like: [2001:db8::1]:1234
    const bracketMatch = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
    if (bracketMatch?.[1]) {
        candidate = bracketMatch[1];
    } else {
        // Handle IPv4 with port like: 203.0.113.1:1234
        const ipv4PortMatch = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(candidate);
        if (ipv4PortMatch?.[1]) {
            candidate = ipv4PortMatch[1];
        }
    }

    return isIP(candidate) ? candidate : null;
}

function getClientIp(headerStore: HeaderLike): string {
    // Prefer X-Real-IP if set by a trusted reverse proxy (e.g., nginx).
    const xRealIp = normalizeIp(headerStore.get('x-real-ip'));
    if (xRealIp) return xRealIp;

    // Fall back to X-Forwarded-For; take the last IP (commonly the one added by the proxy).
    const xForwardedFor = headerStore.get('x-forwarded-for');
    if (xForwardedFor && xForwardedFor.length <= 512) {
        const parts = xForwardedFor.split(',').map(p => p.trim()).filter(Boolean);
        for (let i = parts.length - 1; i >= 0; i--) {
            const normalized = normalizeIp(parts[i] || null);
            if (normalized) return normalized;
        }
    }

    return 'unknown';
}

function pruneLoginRateLimit(now: number) {
    // Prune expired entries (O(n) single pass)
    for (const [key, entry] of loginRateLimit) {
        if (now - entry.lastAttempt > LOGIN_WINDOW_MS) {
            loginRateLimit.delete(key);
        }
    }

    // Hard cap: if still over limit after expiry pruning, evict oldest entries.
    // Use a single pass to find the oldest entries instead of sorting the entire Map.
    if (loginRateLimit.size > LOGIN_RATE_LIMIT_MAX_KEYS) {
        const excess = loginRateLimit.size - LOGIN_RATE_LIMIT_MAX_KEYS;
        // Map iteration order is insertion order; oldest entries are first.
        // Re-inserted entries (updated IPs) move to the end, so this is a reasonable LRU heuristic.
        let evicted = 0;
        for (const key of loginRateLimit.keys()) {
            if (evicted >= excess) break;
            loginRateLimit.delete(key);
            evicted++;
        }
    }
}

// In-memory cache for the session secret (persists as long as the process runs)
let cachedSessionSecret: string | null = null;

// Mutex to prevent race condition in getSessionSecret
let sessionSecretPromise: Promise<string> | null = null;

async function getSessionSecret(): Promise<string> {
    // Return cached value if available
    if (cachedSessionSecret) return cachedSessionSecret;

    // Prefer SESSION_SECRET env var (recommended for production)
    const envSecret = process.env.SESSION_SECRET?.trim();
    if (envSecret && envSecret.length >= 32) {
        cachedSessionSecret = envSecret;
        return envSecret;
    }

    // Use existing promise if another request is already fetching/generating
    if (sessionSecretPromise) return sessionSecretPromise;

    // Fallback: fetch or generate from DB (for backwards compatibility)
    sessionSecretPromise = (async () => {
        try {
            if (cachedSessionSecret) return cachedSessionSecret;

            console.warn('[Security] SESSION_SECRET env var not set or too short (min 32 chars). Falling back to DB-stored secret. Set SESSION_SECRET for production use.');

            const setting = await db.query.adminSettings.findFirst({
                where: eq(adminSettings.key, 'session_secret')
            });

            if (setting?.value) {
                cachedSessionSecret = setting.value;
                return setting.value;
            }

            // Generate new secret and store in DB
            const newSecret = randomBytes(32).toString('hex');

            await db.insert(adminSettings).ignore().values({
                key: 'session_secret',
                value: newSecret
            });

            // Re-fetch to get the actual value (in case another process inserted first)
            const finalSetting = await db.query.adminSettings.findFirst({
                where: eq(adminSettings.key, 'session_secret')
            });

            cachedSessionSecret = finalSetting?.value || newSecret;
            return cachedSessionSecret;
        } finally {
            sessionSecretPromise = null;
        }
    })();

    return sessionSecretPromise;
}



// Generate a secure session token
async function generateSessionToken(secretOverride?: string): Promise<string> {
    const secret = secretOverride || await getSessionSecret();
    const timestamp = Date.now().toString();
    const random = randomBytes(16).toString('hex');
    const data = `${timestamp}:${random}`;
    const signature = createHmac('sha256', secret).update(data).digest('hex');
    return `${data}:${signature}`;
}

// Verify session token and return the session record on success, null on failure
async function verifySessionToken(token: string): Promise<{ id: string; userId: number; expiresAt: Date } | null> {
    if (!token) {
        return null;
    }

    const parts = token.split(':');
    if (parts.length !== 3) {
        return null;
    }

    const [timestamp, random, signature] = parts;
    const data = `${timestamp}:${random}`;

    const secret = await getSessionSecret();
    const expectedSignature = createHmac('sha256', secret).update(data).digest('hex');

    // Constant-time comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature);
    const expectedSignatureBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedSignatureBuffer.length) {
        return null;
    }

    if (!timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
        return null;
    }

    // Check token age (24 hours max)
    const tokenTimestamp = parseInt(timestamp, 10);
    if (!Number.isFinite(tokenTimestamp)) return null;
    const tokenAge = Date.now() - tokenTimestamp;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    if (tokenAge > maxAge || tokenAge < 0) {
        return null;
    }

    const tokenHash = hashSessionToken(token);
    const session = await db.query.sessions.findFirst({
        where: eq(sessions.id, tokenHash)
    });

    if (!session) {
        return null;
    }

    if (session.expiresAt < new Date()) {
        // Cleanup expired session
        await db.delete(sessions).where(eq(sessions.id, tokenHash));
        return null;
    }

    return session;
}

export async function getSession() {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    if (!token) return null;

    const session = await verifySessionToken(token);
    return session;
}

export const getCurrentUser = cache(async function getCurrentUser() {
    const session = await getSession();
    if (!session) return null;

    const [user] = await db.select({
        id: adminUsers.id,
        username: adminUsers.username,
        created_at: adminUsers.created_at,
    }).from(adminUsers).where(eq(adminUsers.id, session.userId));
    return user || null;
});

/** Fetch only id + password_hash — only for internal auth verification (never cache or export to client). */
async function getAdminUserWithHash(userId: number) {
    const [user] = await db.select({
        id: adminUsers.id,
        password_hash: adminUsers.password_hash,
    }).from(adminUsers).where(eq(adminUsers.id, userId));
    return user || null;
}

export async function isAdmin() {
    return !!(await getCurrentUser());
}

export async function login(prevState: { error?: string } | null, formData: FormData) {
    const username = formData.get('username')?.toString() ?? '';
    const password = formData.get('password')?.toString() ?? '';

    // Validate inputs before touching rate-limit state so that missing-field
    // requests don't consume rate-limit attempts.
    if (!username) {
        return { error: 'Username is required' };
    }
    if (!password) {
        return { error: 'Password is required' };
    }

    // Rate Limiting
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const now = Date.now();

    pruneLoginRateLimit(now);

    const limitData = loginRateLimit.get(ip) || { count: 0, lastAttempt: 0 };

    // Reset if window passed
    if (now - limitData.lastAttempt > LOGIN_WINDOW_MS) {
        limitData.count = 0;
    }

    if (limitData.count >= LOGIN_MAX_ATTEMPTS) {
        return { error: 'Too many login attempts. Please try again later.' };
    }

    // Increment count and re-insert to maintain Map insertion order (LRU eviction)
    limitData.count++;
    limitData.lastAttempt = now;
    loginRateLimit.delete(ip);
    loginRateLimit.set(ip, limitData);

    try {
        const [user] = await db.select({
            id: adminUsers.id,
            password_hash: adminUsers.password_hash,
        })
            .from(adminUsers)
            .where(eq(adminUsers.username, username))
            .limit(1);

        if (!user) {
            return { error: 'Invalid credentials' };
        }

        const match = await argon2.verify(user.password_hash, password);

        if (!match) {
            return { error: 'Invalid credentials' };
        }

        // Successful auth: drop any accumulated failures for this IP.
        loginRateLimit.delete(ip);

        try {
            const cookieStore = await cookies();
            const sessionToken = await generateSessionToken();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

            await db.insert(sessions).values({
                id: hashSessionToken(sessionToken),
                userId: user.id,
                expiresAt: expiresAt
            });

            // Require HTTPS for the session cookie whenever the underlying
            // request came in over TLS (via the reverse proxy), and always
            // require it in production regardless of NODE_ENV introspection.
            // This prevents session cookies from being emitted without Secure
            // if someone misconfigures NODE_ENV on a prod box.
            const forwardedProto = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
            const requestIsHttps = forwardedProto === 'https';
            const requireSecureCookie = requestIsHttps || process.env.NODE_ENV === 'production';

            // Set secure cookie with proper attributes
            cookieStore.set(COOKIE_NAME, sessionToken, {
                httpOnly: true,
                secure: requireSecureCookie,
                sameSite: 'lax',
                maxAge: 24 * 60 * 60, // 24 hours
                path: '/',
            });

            redirect('/admin/dashboard');
        } catch (e) {
            if (isRedirectError(e)) throw e;
            console.error("Session creation failed after successful auth", e);
            return { error: 'Login succeeded but session creation failed. Please try again.' };
        }
    } catch (e) {
        if (isRedirectError(e)) throw e;
        console.error("Login verification failed:", e instanceof Error ? e.message : 'Unknown error');
    }

    return { error: 'Invalid credentials' };
}

export async function logout() {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    // Delete session from database if it exists
    if (token) {
        await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token))).catch(() => {});
    }

    cookieStore.delete({ name: COOKIE_NAME, path: '/' });
    redirect('/admin');
}

// Validate slug format (alphanumeric, hyphens, underscores only)
function isValidSlug(slug: string): boolean {
    return /^[a-z0-9_-]+$/i.test(slug) && slug.length > 0 && slug.length <= 100;
}

// Allow CJK characters, emojis, and most symbols for aliases, but disallow:
// - Slashes (path separators)
// - Backslashes (path separators/escapes)
// - Question marks (query parameters)
// - Hash/Pound (fragments)
// - Whitespace (better UX for URLs, though encoded spaces theoretically work)
function isValidTopicAlias(alias: string): boolean {
    return /^[^/\\\s?#]+$/.test(alias);
}

// Validate filename (no path traversal, only safe characters)
function isValidFilename(filename: string): boolean {
    // Check for path traversal attempts
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return false;
    }
    // Only allow safe characters and require the name to start with an alphanumeric
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename) && filename.length <= 255;
}

export async function uploadImages(formData: FormData) {
    if (!(await isAdmin())) {
        return { error: 'Unauthorized' };
    }

    const files = formData.getAll('files').filter((f): f is File => f instanceof File);
    // Topic is now a string slug
    const topic = formData.get('topic')?.toString() ?? '';
    const tagsString = formData.get('tags')?.toString() ?? '';

    if (tagsString && tagsString.length > 1000) {
        return { error: 'Tags string is too long (max 1000 chars)' };
    }

    const tagNames = tagsString
        ? tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0 && t.length <= 100)
        : [];

    if (!files.length) return { error: 'No files provided' };
    if (files.length > 10) return { error: 'Too many files at once (max 10)' };

    // Validate total upload size to prevent excessive memory pressure
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > 250 * 1024 * 1024) {
        return { error: 'Total upload size exceeds 250MB limit' };
    }

    if (!topic) return { error: 'Topic required' };

    // Validate topic slug format
    if (!isValidSlug(topic)) {
        return { error: 'Invalid topic format' };
    }

    let successCount = 0;
    const failedFiles: string[] = [];
    const replacedFiles: string[] = [];

    // Track processed IDs for revalidation
    const processedIds: number[] = [];

    for (const file of files) {
        try {
            const originalFilename = path.basename(file.name).trim();

            const existingImage = originalFilename.length > 0
                ? (await db.select({
                        id: images.id,
                        filename_original: images.filename_original,
                        filename_webp: images.filename_webp,
                        filename_avif: images.filename_avif,
                        filename_jpeg: images.filename_jpeg,
                    })
                    .from(images)
                    .where(or(
                        eq(images.user_filename, originalFilename),
                        and(isNull(images.user_filename), eq(images.title, originalFilename))
                    ))
                    .orderBy(desc(images.id))
                    .limit(1))[0]
                : null;

            const existingId = existingImage
                ? path.basename(existingImage.filename_webp, path.extname(existingImage.filename_webp))
                : null;

            if (existingImage) {
                if (
                    !isValidFilename(existingImage.filename_original)
                    || !isValidFilename(existingImage.filename_webp)
                    || !isValidFilename(existingImage.filename_avif)
                    || !isValidFilename(existingImage.filename_jpeg)
                ) {
                    throw new Error('Invalid filename in database record');
                }
            }

            // Phase 1: Save original and get metadata (fast)
            const data = await saveOriginalAndGetMetadata(
                file,
                existingId ? { id: existingId } : undefined
            );

            // Extract EXIF
            const exifDb = extractExifForDb(data.exifData);

            if (existingImage && existingId) {
                await db.update(images)
                    .set({
                        filename_original: data.filenameOriginal,
                        filename_webp: data.filenameWebp,
                        filename_avif: data.filenameAvif,
                        filename_jpeg: data.filenameJpeg,
                        width: data.width,
                        height: data.height,
                        original_width: data.originalWidth,
                        original_height: data.originalHeight,
                        user_filename: originalFilename, // Ensure user_filename is set on update (migration-like)
                        blur_data_url: data.blurDataUrl,
                        processed: false,
                        updated_at: sql`CURRENT_TIMESTAMP`,
                        ...exifDb,
                        color_space: data.iccProfileName || exifDb.color_space,
                        bit_depth: data.bitDepth,
                        original_format: data.filenameOriginal.split('.').pop()?.toUpperCase() || null,
                        original_file_size: file.size,
                    })
                    .where(eq(images.id, existingImage.id));

                replacedFiles.push(originalFilename || file.name);

                // Phase 4: Queue heavy processing (Fire and Forget)
                enqueueImageProcessing({
                    id: existingImage.id,
                    filenameOriginal: data.filenameOriginal,
                    filenameWebp: data.filenameWebp,
                    filenameAvif: data.filenameAvif,
                    filenameJpeg: data.filenameJpeg,
                    width: data.width,
                });

                successCount++;
                continue;
            }

            // Phase 2: Insert into DB immediately so it shows up in UI
            const insertValues = {
                filename_original: data.filenameOriginal,
                filename_webp: data.filenameWebp,
                filename_avif: data.filenameAvif,
                filename_jpeg: data.filenameJpeg,
                width: data.width,
                height: data.height,
                original_width: data.originalWidth,
                original_height: data.originalHeight,
                topic,
                title: null, // Title is null by default, showing tags or user_filename
                description: '',
                user_filename: originalFilename,
                blur_data_url: data.blurDataUrl,
                processed: false,
                ...exifDb,
                color_space: data.iccProfileName || exifDb.color_space,
                bit_depth: data.bitDepth,
                original_format: data.filenameOriginal.split('.').pop()?.toUpperCase() || null,
                original_file_size: file.size,
            };

            const [result] = await db.insert(images).values(insertValues);
            const insertedImage = { id: result.insertId, ...insertValues };

            if (insertedImage) {
                processedIds.push(insertedImage.id);

                // Phase 3: Process Tags (batched)
                if (tagNames.length > 0) {
                    try {
                        const uniqueTagNames = Array.from(new Set(tagNames))
                            .map(t => t.trim()).filter(Boolean);
                        if (uniqueTagNames.length > 0) {
                            const tagEntries = uniqueTagNames.map(cleanName => ({
                                name: cleanName,
                                slug: cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
                            }));
                            // Single batch insert for all tags
                            await db.insert(tags).ignore().values(tagEntries);
                            const slugs = tagEntries.map(t => t.slug);
                            // Single batch fetch for all tag records
                            const tagRecords = await db.select().from(tags).where(inArray(tags.slug, slugs));
                            // US-002: Warn on tag slug collisions
                            const intendedBySlug = new Map(tagEntries.map(t => [t.slug, t.name]));
                            for (const rec of tagRecords) {
                                const intended = intendedBySlug.get(rec.slug);
                                if (intended && rec.name !== intended) {
                                    console.warn(`Tag slug collision: "${intended}" collides with existing "${rec.name}" on slug "${rec.slug}"`);
                                }
                            }
                            if (tagRecords.length > 0) {
                                // Single batch insert for all imageTags
                                await db.insert(imageTags).ignore().values(
                                    tagRecords.map(tagRecord => ({
                                        imageId: insertedImage.id,
                                        tagId: tagRecord.id,
                                    }))
                                );
                            }
                        }
                    } catch (err) {
                        console.error('Failed to process tags for image', insertedImage.id, err);
                    }
                }

                // Phase 4: Queue heavy processing (Fire and Forget)
                enqueueImageProcessing({
                    id: insertedImage.id,
                    filenameOriginal: data.filenameOriginal,
                    filenameWebp: data.filenameWebp,
                    filenameAvif: data.filenameAvif,
                    filenameJpeg: data.filenameJpeg,
                    width: data.width,
                });

                successCount++;
            }
        } catch (e) {
            // Log full error server-side; only return filename to client (no internal details)
            console.error(`Failed to process file ${file.name}:`, e);
            failedFiles.push(file.name);
        }
    }

    if (failedFiles.length > 0 && successCount === 0) {
        return { error: 'All uploads failed' };
    }

    // Revalidate so newly uploaded (unprocessed) images appear in admin dashboard
    revalidatePath('/');
    revalidatePath('/admin/dashboard');

    return {
        success: true,
        count: successCount,
        failed: failedFiles,
        replaced: replacedFiles
    };
}

export async function deleteImage(id: number) {
    if (!(await isAdmin())) {
        return { error: 'Unauthorized' };
    }

    // Validate ID is a positive integer
    if (!Number.isInteger(id) || id <= 0) {
        return { error: 'Invalid image ID' };
    }

    // Get image to find filenames — select only needed columns
    const [image] = await db.select({
        id: images.id,
        filename_original: images.filename_original,
        filename_webp: images.filename_webp,
        filename_avif: images.filename_avif,
        filename_jpeg: images.filename_jpeg,
    }).from(images).where(eq(images.id, id));
    if (!image) return { error: 'Image not found' };

    // Validate filenames before attempting to delete (security check)
    if (
        !isValidFilename(image.filename_original)
        || !isValidFilename(image.filename_webp)
        || !isValidFilename(image.filename_avif)
        || !isValidFilename(image.filename_jpeg)
    ) {
         return { error: 'Invalid filename in database record' };
    }

    // US-001: Remove from processing queue so the queue detects deletion
    const queueState = getProcessingQueueState();
    queueState.enqueued.delete(id);

    // US-008: Delete DB records in a transaction for consistency
    await db.transaction(async (tx) => {
        await tx.delete(imageTags).where(eq(imageTags.imageId, id));
        await tx.delete(images).where(eq(images.id, id));
    });

    // Delete files deterministically (no readdir) — best effort, all in parallel
    try {
        await Promise.all([
            fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, image.filename_original)).catch(() => {}),
            deleteImageVariants(UPLOAD_DIR_WEBP, image.filename_webp),
            deleteImageVariants(UPLOAD_DIR_AVIF, image.filename_avif),
            deleteImageVariants(UPLOAD_DIR_JPEG, image.filename_jpeg),
        ]);
    } catch {
        console.error("Error deleting files");
    }

    revalidatePath('/');
    revalidatePath('/admin/dashboard');
    return { success: true };
}

export async function deleteImages(ids: number[]) {
    if (!(await isAdmin())) {
        return { error: 'Unauthorized' };
    }

    if (!Array.isArray(ids) || ids.length === 0) {
        return { error: 'No images selected' };
    }

    // Limit batch size to prevent DoS
    if (ids.length > 100) {
        return { error: 'Too many images to delete at once (max 100)' };
    }

    // Validate all IDs upfront
    for (const id of ids) {
        if (!Number.isInteger(id) || id <= 0) {
            return { error: 'Invalid image ID in selection' };
        }
    }

    // Fetch all images in one query — select only needed columns
    const imageRecords = await db.select({
        id: images.id,
        filename_original: images.filename_original,
        filename_webp: images.filename_webp,
        filename_avif: images.filename_avif,
        filename_jpeg: images.filename_jpeg,
    }).from(images).where(inArray(images.id, ids));

    // Validate all filenames before deleting anything
    for (const image of imageRecords) {
        if (
            !isValidFilename(image.filename_original)
            || !isValidFilename(image.filename_webp)
            || !isValidFilename(image.filename_avif)
            || !isValidFilename(image.filename_jpeg)
        ) {
            return { error: 'Invalid filename in database record' };
        }
    }

    const foundIdSet = new Set(imageRecords.map(img => img.id));
    const foundIds = [...foundIdSet];
    const notFoundCount = ids.filter(id => !foundIdSet.has(id)).length;

    // Remove from processing queue so queue detects deletion (matches deleteImage behavior)
    const queueState = getProcessingQueueState();
    for (const id of foundIds) {
        queueState.enqueued.delete(id);
    }

    // Delete DB records in a transaction (imageTags cascade via FK, but explicit for safety)
    if (foundIds.length > 0) {
        await db.transaction(async (tx) => {
            await tx.delete(imageTags).where(inArray(imageTags.imageId, foundIds));
            await tx.delete(images).where(inArray(images.id, foundIds));
        });
    }

    // Clean up files deterministically (no readdir) for all images concurrently
    await Promise.all(imageRecords.map(async (image) => {
        try {
            await Promise.all([
                fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, image.filename_original)).catch(() => {}),
                deleteImageVariants(UPLOAD_DIR_WEBP, image.filename_webp),
                deleteImageVariants(UPLOAD_DIR_AVIF, image.filename_avif),
                deleteImageVariants(UPLOAD_DIR_JPEG, image.filename_jpeg),
            ]);
        } catch {
            console.error(`Error deleting files for image ${image.id}`);
        }
    }));

    const successCount = foundIds.length;
    const errorCount = notFoundCount;

    revalidatePath('/');
    revalidatePath('/admin/dashboard');
    return { success: true, count: successCount, errors: errorCount };
}

export async function createTopic(formData: FormData) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    const label = formData.get('label')?.toString() ?? '';
    const slug = formData.get('slug')?.toString() ?? '';
    const orderStr = formData.get('order')?.toString() ?? '';
    const imageFile = (() => { const v = formData.get('image'); return v instanceof File ? v : null; })();

    if (!label || !slug) return { error: 'Label and Slug are required' };

    // Validate and sanitize order (default to 0, limit range)
    let order = parseInt(orderStr, 10);
    if (Number.isNaN(order)) order = 0;
    order = Math.max(-1000, Math.min(1000, order)); // Limit to reasonable range

    // Validate slug format
    if (!isValidSlug(slug)) {
        return { error: 'Invalid slug format. Use only lowercase letters, numbers, hyphens, and underscores.' };
    }

    // Validate label length
    if (label.length > 100) {
        return { error: 'Label is too long (max 100 characters)' };
    }

    let imageFilename = null;
    if (imageFile && imageFile.size > 0 && imageFile.name !== 'undefined') {
         try {
             imageFilename = await processTopicImage(imageFile);
         } catch (e) {
             console.warn('Topic image processing failed, continuing without image:', e);
             // For now, fail safely without image
         }
    }

    // US-007: Insert directly and catch ER_DUP_ENTRY to avoid TOCTOU race
    try {
        await db.insert(topics).values({
            label,
            slug,
            order,
            image_filename: imageFilename,
        });

        revalidatePath('/admin/categories');
        revalidatePath('/');
        return { success: true };
    } catch (e: unknown) {
        if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY')) {
            return { error: 'Topic slug already exists' };
        }
        console.error('Failed to create topic', e);
        return { error: 'Failed to create topic' };
    }
}

export async function updateTopic(currentSlug: string, formData: FormData) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    // Validate currentSlug
    if (!currentSlug || !isValidSlug(currentSlug)) {
        return { error: t('invalidCurrentSlug') };
    }

    const label = formData.get('label')?.toString() ?? '';
    const slug = formData.get('slug')?.toString() ?? '';
    const orderStr = formData.get('order')?.toString() ?? '';
    const imageFile = (() => { const v = formData.get('image'); return v instanceof File ? v : null; })();

    if (!label || !slug) return { error: t('labelSlugRequired') };

    let order = parseInt(orderStr, 10);
    if (Number.isNaN(order)) order = 0;
    order = Math.max(-1000, Math.min(1000, order));

    if (!isValidSlug(slug)) {
        return { error: t('invalidSlugFormat') };
    }

    let imageFilename = undefined;
    if (imageFile && imageFile.size > 0 && imageFile.name !== 'undefined') {
         try {
             imageFilename = await processTopicImage(imageFile);
         } catch (e) {
             console.error("Failed to process topic image", e);
         }
    }

    try {
        if (slug !== currentSlug) {
            // Cascade slug change in a transaction: update references first (while old FK target exists), then rename the PK
            await db.transaction(async (tx) => {
                await tx.update(images).set({ topic: slug }).where(eq(images.topic, currentSlug));
                await tx.update(topicAliases).set({ topicSlug: slug }).where(eq(topicAliases.topicSlug, currentSlug));
                await tx.update(topics)
                    .set({
                        label,
                        slug,
                        order,
                        ...(imageFilename ? { image_filename: imageFilename } : {})
                    })
                    .where(eq(topics.slug, currentSlug));
            });
        } else {
            await db.update(topics)
                .set({
                    label,
                    order,
                    ...(imageFilename ? { image_filename: imageFilename } : {})
                })
                .where(eq(topics.slug, currentSlug));
        }

        revalidatePath('/admin/categories');
        revalidatePath('/');
        return { success: true };
    } catch (e: unknown) {
         if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.message?.includes('Duplicate entry'))) {
             return { error: 'Topic slug already exists' };
         }
         console.error('Failed to update topic', e);
         return { error: 'Failed to update topic' };
    }
}

export async function deleteTopic(slug: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!slug || !isValidSlug(slug)) {
        return { error: t('invalidSlug') };
    }

    try {
        // Wrap check + delete in a transaction to prevent TOCTOU race
        // (image could be added between the check and delete otherwise)
        await db.transaction(async (tx) => {
            const headerImages = await tx.select({ id: images.id }).from(images).where(eq(images.topic, slug)).limit(1);
            if (headerImages.length > 0) {
                throw new Error('HAS_IMAGES');
            }
            await tx.delete(topics).where(eq(topics.slug, slug));
        });
        revalidatePath('/admin/categories');
        revalidatePath('/');

        return { success: true };
    } catch (e) {
         if (e instanceof Error && e.message === 'HAS_IMAGES') {
             return { error: t('cannotDeleteCategoryWithImages') };
         }
         console.error('Failed to delete topic', e);
         return { error: t('failedToDeleteTopic') };
    }
}

export async function createTopicAlias(topicSlug: string, alias: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!topicSlug || !isValidSlug(topicSlug)) {
        return { error: t('invalidTopicSlug') };
    }

    if (!isValidTopicAlias(alias)) {
        return { error: t('invalidAliasFormat') };
    }

    // US-007: Insert directly and catch ER_DUP_ENTRY to avoid TOCTOU race
    try {
        await db.insert(topicAliases).values({
            alias,
            topicSlug
        });

        revalidatePath('/admin/categories');
        return { success: true };
    } catch (e: unknown) {
        if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY')) {
            return { error: t('aliasAlreadyExists') };
        }
        return { error: t('invalidAliasFormat') };
    }
}

export async function deleteTopicAlias(topicSlug: string, alias: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!topicSlug || !isValidSlug(topicSlug)) {
        return { error: t('invalidTopicSlug') };
    }

    // Use permissive check for delete too, ensuring we can delete legacy/weird aliases if they exist
    if (!alias || !isValidTopicAlias(alias)) {
        return { error: t('invalidAlias') };
    }

    await db.delete(topicAliases).where(
        and(
            eq(topicAliases.alias, alias),
            eq(topicAliases.topicSlug, topicSlug)
        )
    );

    revalidatePath('/admin/categories');
    return { success: true };
}

export async function createPhotoShareLink(imageId: number) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    // Validate imageId
    if (!Number.isInteger(imageId) || imageId <= 0) {
        return { error: 'Invalid image ID' };
    }

    const [image] = await db.select({ id: images.id, share_key: images.share_key })
        .from(images).where(eq(images.id, imageId));
    if (!image) return { error: 'Image not found' };

    if (image.share_key) {
        return { success: true, key: image.share_key };
    }

    // Generate new key with atomic update to prevent race conditions
    let retries = 0;
    while (retries < 5) {
        const key = generateBase56(PHOTO_SHARE_KEY_LENGTH);
        try {
            // Use WHERE clause to ensure we only update if share_key is still null
            // This prevents race condition where two requests try to set the key
            const [result] = await db.update(images)
                .set({ share_key: key })
                .where(and(eq(images.id, imageId), sql`${images.share_key} IS NULL`));

            if (result.affectedRows > 0) {
                return { success: true, key: key };
            }

            // If no rows updated, another request may have set it - re-fetch
            const [refreshedImage] = await db.select({ share_key: images.share_key })
                .from(images)
                .where(eq(images.id, imageId));

            if (refreshedImage?.share_key) {
                return { success: true, key: refreshedImage.share_key };
            }

            retries++;
        } catch {
            // Likely unique constraint violation - retry with new key
            retries++;
        }
    }
    return { error: 'Failed to generate unique key' };
}

export async function createGroupShareLink(imageIds: number[]) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    // Validate imageIds
    if (!Array.isArray(imageIds) || imageIds.length === 0) {
        return { error: 'No images selected' };
    }

    const uniqueImageIds = Array.from(new Set(imageIds));

    // Limit maximum images per group
    if (uniqueImageIds.length > 100) {
        return { error: 'Too many images (max 100)' };
    }

    // Validate all IDs are positive integers
    for (const id of uniqueImageIds) {
        if (!Number.isInteger(id) || id <= 0) {
            return { error: 'Invalid image ID' };
        }
    }

    let retries = 0;
    while (retries < 5) {
        const groupKey = generateBase56(GROUP_SHARE_KEY_LENGTH);
        try {
            const key = await db.transaction(async (tx) => {
                const [result] = await tx.insert(sharedGroups)
                    .values({ key: groupKey });

                const groupId = result.insertId;

                await tx.insert(sharedGroupImages)
                    .ignore()
                    .values(
                        uniqueImageIds.map((imgId) => ({
                            groupId: groupId,
                            imageId: imgId,
                        }))
                    );

                return groupKey;
            });

            return { success: true, key };
        } catch {
            // Key collision or other error - retry with new key
            retries++;
        }
    }
    return { error: 'Failed to create group' };
}

export async function revokePhotoShareLink(imageId: number) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Number.isInteger(imageId) || imageId <= 0) {
        return { error: 'Invalid image ID' };
    }

    await db.update(images)
        .set({ share_key: null })
        .where(eq(images.id, imageId));

    return { success: true };
}

export async function deleteGroupShareLink(groupId: number) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return { error: 'Invalid group ID' };
    }

    // sharedGroupImages cascade-deletes via FK
    await db.delete(sharedGroups).where(eq(sharedGroups.id, groupId));

    return { success: true };
}

// Tag Management

export async function getTags() {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    try {
        const allTags = await db.select({
            id: tags.id,
            name: tags.name,
            slug: tags.slug,
            count: sql<number>`count(${imageTags.imageId})`
        })
        .from(tags)
        .leftJoin(imageTags, eq(tags.id, imageTags.tagId))
        .groupBy(tags.id)
        .orderBy(sql`count(${imageTags.imageId}) desc`);

        return { success: true, tags: allTags };
    } catch {
        console.error("Failed to fetch tags");
        return { error: 'Failed to fetch tags' };
    }
}

export async function updateTag(id: number, name: string) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    // Validate ID is a positive integer
    if (!Number.isInteger(id) || id <= 0) {
        return { error: 'Invalid tag ID' };
    }

    if (!name || name.trim().length === 0) return { error: 'Name is required' };

    // Validate name length
    if (name.length > 100) {
        return { error: 'Tag name too long (max 100 characters)' };
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    if (!isValidSlug(slug)) return { error: 'Invalid tag name format' };

    try {
        await db.update(tags)
            .set({ name: name.trim(), slug })
            .where(eq(tags.id, id));
        revalidatePath('/admin/tags');
        return { success: true };
    } catch {
        console.error("Failed to update tag");
        return { error: 'Failed to update tag (Name might be taken)' };
    }
}

export async function deleteTag(id: number) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    // Validate ID is a positive integer
    if (!Number.isInteger(id) || id <= 0) {
        return { error: 'Invalid tag ID' };
    }

    try {
        await db.delete(tags).where(eq(tags.id, id));
        revalidatePath('/admin/tags');
        return { success: true };
    } catch {
        console.error("Failed to delete tag");
        return { error: 'Failed to delete tag' };
    }
}

export async function updatePassword(prevState: { error?: string; success?: boolean; message?: string } | null, formData: FormData) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        return { error: 'Unauthorized' };
    }

    const currentPassword = formData.get('currentPassword')?.toString() ?? '';
    const newPassword = formData.get('newPassword')?.toString() ?? '';
    const confirmPassword = formData.get('confirmPassword')?.toString() ?? '';

    if (!currentPassword || !newPassword || !confirmPassword) {
        return { error: 'All fields are required' };
    }

    if (newPassword !== confirmPassword) {
        return { error: 'New passwords do not match' };
    }

    if (newPassword.length < 8) {
        return { error: 'New password must be at least 8 characters long' };
    }

    if (newPassword.length > 1024) {
        return { error: 'Password is too long (max 1024 characters)' };
    }

    try {
        // Fetch user with hash for password verification (getCurrentUser no longer returns hash)
        const userWithHash = await getAdminUserWithHash(currentUser.id);
        if (!userWithHash) {
            return { error: 'Unauthorized' };
        }

        // Verify current password
        const match = await argon2.verify(userWithHash.password_hash, currentPassword);

        if (!match) {
            return { error: 'Incorrect current password' };
        }

        // Hash new password
        const newHash = await argon2.hash(newPassword, { type: argon2.argon2id });

        // Update password
        await db.update(adminUsers)
            .set({ password_hash: newHash })
            .where(eq(adminUsers.id, currentUser.id));

        // Invalidate all sessions for this user EXCEPT the current one
        const currentSession = await getSession();
        if (currentSession) {
             await db.delete(sessions).where(and(
                 eq(sessions.userId, currentUser.id),
                 sql`${sessions.id} != ${currentSession.id}`
             ));
        } else {
             await db.delete(sessions).where(eq(sessions.userId, currentUser.id));
        }

        return { success: true, message: 'Password updated successfully.' };

    } catch (e) {
        console.error("Failed to update password:", e instanceof Error ? e.message : 'Unknown error');
        return { error: 'Failed to update password' };
    }
}

export async function addTagToImage(imageId: number, tagName: string) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Number.isInteger(imageId) || imageId <= 0) return { error: 'Invalid image ID' };
    const cleanName = tagName?.trim();
    if (!cleanName) return { error: 'Tag name required' };
    if (cleanName.length > 100) return { error: 'Tag name too long' };

    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!isValidSlug(slug)) return { error: 'Invalid tag name format' };

    try {
        // Upsert tag
        await db.insert(tags).ignore().values({ name: cleanName, slug });

        // Get tag id (optimized select)
        const [tagRecord] = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.slug, slug));
        if (!tagRecord) return { error: 'Failed to retrieve tag' };

        // US-002: Warn on tag slug collision
        if (tagRecord.name !== cleanName) {
            console.warn(`Tag slug collision: "${cleanName}" collides with existing "${tagRecord.name}" on slug "${slug}"`);
        }

        // Link tag to image
        await db.insert(imageTags).ignore().values({
            imageId,
            tagId: tagRecord.id
        });

        revalidatePath('/admin/dashboard');
        return { success: true };
    } catch (e) {
        console.error("Failed to add tag", e);
        return { error: 'Failed to add tag' };
    }
}

export async function removeTagFromImage(imageId: number, tagName: string) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Number.isInteger(imageId) || imageId <= 0) return { error: 'Invalid image ID' };
    const cleanName = tagName?.trim();
    if (!cleanName) return { error: 'Tag name required' };

    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    try {
        const [tagRecord] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
        if (!tagRecord) return { error: 'Tag not found' };

        await db.delete(imageTags)
            .where(and(
                eq(imageTags.imageId, imageId),
                eq(imageTags.tagId, tagRecord.id)
            ));

        revalidatePath('/admin/dashboard');
        return { success: true };
    } catch (e) {
        console.error("Failed to remove tag", e);
        return { error: 'Failed to remove tag' };
    }
}

export async function batchAddTags(imageIds: number[], tagName: string) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Array.isArray(imageIds) || imageIds.length === 0) return { error: 'No images selected' };
    // Limit batch size to prevent DoS
    if (imageIds.length > 100) {
        return { error: 'Too many images selected (max 100)' };
    }

    // Validate ids
    for (const id of imageIds) {
        if (!Number.isInteger(id) || id <= 0) return { error: 'Invalid image ID' };
    }

    const cleanName = tagName?.trim();
    if (!cleanName) return { error: 'Tag name required' };
    if (cleanName.length > 100) return { error: 'Tag name too long' };

    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!isValidSlug(slug)) return { error: 'Invalid tag name format' };

    try {
        // Upsert tag
        await db.insert(tags).ignore().values({ name: cleanName, slug });
        const [tagRecord] = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.slug, slug));
        if (!tagRecord) return { error: 'Failed to retrieve tag' };

        // US-002: Warn on tag slug collision
        if (tagRecord.name !== cleanName) {
            console.warn(`Tag slug collision: "${cleanName}" collides with existing "${tagRecord.name}" on slug "${slug}"`);
        }

        // Batch insert
        const values = imageIds.map(imageId => ({
            imageId,
            tagId: tagRecord.id
        }));

        await db.insert(imageTags).ignore().values(values);

        revalidatePath('/admin/dashboard');
        return { success: true };
    } catch (e) {
        console.error("Failed to batch add tags", e);
        return { error: 'Failed to batch add tags' };
    }
}

export async function updateImageMetadata(id: number, title: string | null, description: string | null) {
    if (!(await isAdmin())) {
        return { error: 'Unauthorized' };
    }

    if (!Number.isInteger(id) || id <= 0) {
        return { error: 'Invalid image ID' };
    }

    if (title && title.length > 255) {
        return { error: 'Title is too long (max 255 chars)' };
    }

    if (description && description.length > 5000) {
        return { error: 'Description is too long (max 5000 chars)' };
    }

    try {
        await db.update(images)
            .set({
                title: title?.trim() || null,
                description: description?.trim() || null,
                updated_at: sql`CURRENT_TIMESTAMP`
            })
            .where(eq(images.id, id));

        revalidatePath('/admin/dashboard');
        revalidatePath('/'); // In case it's in the gallery
        return { success: true };
    } catch (e) {
        console.error("Failed to update image metadata", e);
        return { error: 'Failed to update image' };
    }
}

// Admin User Management
export async function getAdminUsers() {
    if (!(await isAdmin())) return [];

    return await db.select({
        id: adminUsers.id,
        username: adminUsers.username,
        created_at: adminUsers.created_at
    }).from(adminUsers)
      .orderBy(desc(adminUsers.created_at));
}

export async function createAdminUser(formData: FormData) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    const username = formData.get('username')?.toString() ?? '';
    const password = formData.get('password')?.toString() ?? '';

    if (!username || username.length < 3) return { error: 'Username must be at least 3 chars' };
    if (username.length > 64) return { error: 'Username is too long (max 64 chars)' };
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return { error: 'Username can only contain letters, numbers, underscores, and hyphens' };
    if (!password || password.length < 8) return { error: 'Password must be at least 8 chars' };
    if (password.length > 1024) return { error: 'Password is too long (max 1024 chars)' };

    try {
        const hash = await argon2.hash(password, { type: argon2.argon2id });
        await db.insert(adminUsers).values({
            username,
            password_hash: hash
        });

        revalidatePath('/admin/dashboard');
        return { success: true };
    } catch (e: unknown) {
        if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.message?.includes('users.username'))) {
            return { error: 'Username already exists' };
        }
        console.error('Create user failed', e);
        return { error: 'Failed to create user' };
    }
}

export async function deleteAdminUser(id: number) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return { error: 'Unauthorized' };

    if (!Number.isInteger(id) || id <= 0) {
        return { error: 'Invalid user ID' };
    }

    // Prevent deleting self
    if (currentUser.id === id) {
        return { error: 'Cannot delete your own account' };
    }

    // Atomically check last-admin and delete inside a transaction to prevent TOCTOU race
    try {
        await db.transaction(async (tx) => {
            const [adminCount] = await tx.select({ count: sql<number>`count(*)` }).from(adminUsers);
            if (Number(adminCount.count) <= 1) {
                throw new Error('LAST_ADMIN');
            }
            // Explicitly delete sessions before user (defense in depth alongside FK cascade)
            await tx.delete(sessions).where(eq(sessions.userId, id));
            await tx.delete(adminUsers).where(eq(adminUsers.id, id));
        });
        revalidatePath('/admin/dashboard');
        return { success: true };
    } catch (e: unknown) {
        if (e instanceof Error && e.message === 'LAST_ADMIN') {
            return { error: 'Cannot delete the last admin user' };
        }
        console.error('Delete user failed', e);
        return { error: 'Failed to delete user' };
    }
}

export async function loadMoreImages(topicSlug?: string, tagSlugs?: string[], offset: number = 0, limit: number = 30) {
    // Validate slug format before passing to data layer (defense in depth)
    if (topicSlug && (!isValidSlug(topicSlug))) return [];
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    // Cap maximum offset to prevent deep pagination DoS
    if (safeOffset > 10000) return [];
    // Cap tag array to prevent complex query DoS
    const safeTags = (tagSlugs || []).slice(0, 20);
    const images = await getImages(topicSlug, safeTags, safeLimit, safeOffset);
    return images;
}

export async function searchImagesAction(query: string) {
    if (!query || typeof query !== 'string' || query.length > 1000) return [];
    if (query.trim().length < 2) return [];
    const safeQuery = query.trim().slice(0, 200);
    return searchImages(safeQuery, 20);
}
