'use server';

import * as argon2 from 'argon2';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { isIP } from 'net';

import { cookies, headers } from 'next/headers';
import { saveOriginalAndGetMetadata, processImageFormats, extractExifForDb, UPLOAD_DIR_ORIGINAL } from '@/lib/process-image';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db, images, topics, topicAliases, adminSettings, sharedGroups, sharedGroupImages, tags, imageTags, adminUsers, sessions } from '@/db';
import { eq, sql, and, desc, or, isNull } from 'drizzle-orm';
import path from 'path';
import fs from 'fs/promises';
import { generateBase56 } from '@/lib/base56';
import { processTopicImage } from '@/lib/process-topic-image';
import PQueue from 'p-queue';

const processingQueueKey = Symbol.for('gallery.imageProcessingQueue');

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

    console.log(`[Queue] Enqueuing job ${job.id}`);
    state.enqueued.add(job.id);
    state.queue.start();

    // Explicitly add to queue
    state.queue.add(async () => {
        console.log(`[Queue] Processing job ${job.id} started`);
        try {
            const originalPath = path.join(UPLOAD_DIR_ORIGINAL, job.filenameOriginal);

            // Check if file exists before processing to avoid errors
            try {
                await fs.access(originalPath);
            } catch {
                console.error(`[Queue] File not found for job ${job.id}: ${originalPath}`);
                return;
            }

            const buffer = await fs.readFile(originalPath);
            await processImageFormats(
                buffer,
                job.filenameWebp,
                job.filenameAvif,
                job.filenameJpeg,
                job.width,
            );

            await db.update(images)
                .set({ processed: true })
                .where(eq(images.id, job.id));

            console.log(`[Queue] Job ${job.id} complete`);
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
    state.bootstrapped = true;

    try {
        const pending = await db.select().from(images).where(eq(images.processed, false));
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
    } catch (err) {
        console.error('Failed to bootstrap image processing queue', err);
    }
};

void bootstrapImageProcessingQueue();

// Secret for signing session tokens
const COOKIE_NAME = 'admin_session';

const PHOTO_SHARE_KEY_LENGTH = 10;
const GROUP_SHARE_KEY_LENGTH = 10;

const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_RATE_LIMIT_MAX_KEYS = 5000;

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
    for (const [key, entry] of loginRateLimit) {
        if (now - entry.lastAttempt > LOGIN_WINDOW_MS) {
            loginRateLimit.delete(key);
        }
    }

    if (loginRateLimit.size <= LOGIN_RATE_LIMIT_MAX_KEYS) return;

    // Evict the oldest entries rather than clearing everything so attackers cannot reset the limiter
    const entries = Array.from(loginRateLimit.entries())
        .sort((a, b) => a[1].lastAttempt - b[1].lastAttempt);

    for (const [key] of entries) {
        if (loginRateLimit.size <= LOGIN_RATE_LIMIT_MAX_KEYS) break;
        loginRateLimit.delete(key);
    }
}

// In-memory cache for the session secret (persists as long as the process runs)
let cachedSessionSecret: string | null = null;

// Mutex to prevent race condition in getSessionSecret
let sessionSecretPromise: Promise<string> | null = null;

function generateSecureSessionSecret(): string {
    const envSecret = process.env.SESSION_SECRET?.trim();

    // Enforce a minimum size to prevent weak secrets
    if (envSecret && envSecret.length >= 32) {
        return envSecret;
    }

    return randomBytes(32).toString('hex');
}

async function getSessionSecret(): Promise<string> {
    // Return cached value if available
    if (cachedSessionSecret) return cachedSessionSecret;

    // Use existing promise if another request is already fetching/generating
    if (sessionSecretPromise) return sessionSecretPromise;

    // Create a new promise for this operation
    sessionSecretPromise = (async () => {
        try {
            // Double-check cache after acquiring "lock"
            if (cachedSessionSecret) return cachedSessionSecret;

            // Try fetching from DB
            const setting = await db.query.adminSettings.findFirst({
                where: eq(adminSettings.key, 'session_secret')
            });

            if (setting?.value) {
                cachedSessionSecret = setting.value;
                return setting.value;
            }

            // Generate new secret
            const newSecret = generateSecureSessionSecret();

            // Save to DB using INSERT IGNORE to avoid overwriting
            // existing secret if another process created one
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
            // Clear the promise so future calls can proceed
            sessionSecretPromise = null;
        }
    })();

    return sessionSecretPromise;
}

async function rotateSessionSecret(): Promise<string> {
    const newSecret = generateSecureSessionSecret();

    await db.insert(adminSettings)
        .values({ key: 'session_secret', value: newSecret })
        .onDuplicateKeyUpdate({
            set: { value: newSecret }
        });

    cachedSessionSecret = newSecret;
    sessionSecretPromise = null;

    return newSecret;
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

// Verify session token
async function verifySessionToken(token: string): Promise<boolean> {
    if (!token) {
        return false;
    }

    const parts = token.split(':');
    if (parts.length !== 3) {
        return false;
    }

    const [timestamp, random, signature] = parts;
    const data = `${timestamp}:${random}`;

    const secret = await getSessionSecret();
    const expectedSignature = createHmac('sha256', secret).update(data).digest('hex');

    // Constant-time comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature);
    const expectedSignatureBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedSignatureBuffer.length) {
        return false;
    }

    if (!timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
        return false;
    }

    // Check token age (24 hours max)
    const tokenAge = Date.now() - parseInt(timestamp, 10);
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    if (tokenAge > maxAge || tokenAge < 0) {
        return false;
    }

    const session = await db.query.sessions.findFirst({
        where: eq(sessions.id, token)
    });

    if (!session) {
        return false;
    }

    if (session.expiresAt < new Date()) {
        // Cleanup expired session
        await db.delete(sessions).where(eq(sessions.id, token));
        return false;
    }

    return true;
}

export async function getSession() {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    if (!token) return null;

    if (!(await verifySessionToken(token))) return null;

    // Fetch full session with user data
    // Drizzle query using `findFirst` on sessions table
    // Since verifySessionToken already checked existence, we can just fetch
    const session = await db.query.sessions.findFirst({
        where: eq(sessions.id, token),
        // We can't use 'with' relations if not defined in schema, so we manually fetch user
    });

    if (!session) return null;

    return session;
}

export async function getCurrentUser() {
    const session = await getSession();
    if (!session) return null;

    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, session.userId));
    return user || null;
}

export async function isAdmin() {
    return !!(await getCurrentUser());
}

export async function login(prevState: any, formData: FormData) {
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

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

    // Increment count
    limitData.count++;
    limitData.lastAttempt = now;
    loginRateLimit.set(ip, limitData);

    if (!username || typeof username !== 'string') {
        return { error: 'Username is required' };
    }

    if (!password || typeof password !== 'string') {
        return { error: 'Password is required' };
    }

    try {
        const [user] = await db.select()
            .from(adminUsers)
            .where(eq(adminUsers.username, username))
            .limit(1);

        if (!user) {
            return { error: 'Invalid credentials' };
        }

        const match = await argon2.verify(user.password_hash, password);

        if (match) {
            // Successful auth: drop any accumulated failures for this IP.
            loginRateLimit.delete(ip);

            const cookieStore = await cookies();
            const sessionToken = await generateSessionToken();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

            await db.insert(sessions).values({
                id: sessionToken,
                userId: user.id,
                expiresAt: expiresAt
            });

            // Determine if we're in production (HTTPS) or development (HTTP)
            const isProduction = process.env.NODE_ENV === 'production';

            // Set secure cookie with proper attributes
            cookieStore.set(COOKIE_NAME, sessionToken, {
                httpOnly: true,
                secure: isProduction, // Only require HTTPS in production
                sameSite: 'lax',
                maxAge: 24 * 60 * 60, // 24 hours
                path: '/',
            });

            redirect('/admin/dashboard');
        }
    } catch (e) {
        if (e instanceof Error && e.message === 'NEXT_REDIRECT') {
            throw e;
        }
        console.error("Login verification failed", e);
    }

    return { error: 'Invalid credentials' };
}

export async function logout() {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    // Delete session from database if it exists
    if (token) {
        await db.delete(sessions).where(eq(sessions.id, token)).catch(() => {});
    }

    cookieStore.delete({ name: COOKIE_NAME, path: '/' });
    redirect('/admin');
}

// Validate slug format (alphanumeric, hyphens, underscores only)
function isValidSlug(slug: string): boolean {
    return /^[a-z0-9_-]+$/i.test(slug) && slug.length > 0 && slug.length <= 100;
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

    const files = formData.getAll('files') as File[];
    // Topic is now a string slug
    const topic = formData.get('topic') as string;
    const tagsString = formData.get('tags') as string;

    if (tagsString && tagsString.length > 1000) {
        return { error: 'Tags string is too long (max 1000 chars)' };
    }

    const tagNames = tagsString ? tagsString.split(',').map(t => t.trim()).filter(Boolean) : [];

    if (!files.length) return { error: 'No files provided' };
    if (files.length > 10) return { error: 'Too many files at once (max 10)' };
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
                ? (await db.select()
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
                        processed: false,
                        updated_at: sql`CURRENT_TIMESTAMP`,
                        ...exifDb
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
                processed: false,
                ...exifDb
            };

            const [result] = await db.insert(images).values(insertValues);
            const insertedImage = { id: result.insertId, ...insertValues };

            if (insertedImage) {
                processedIds.push(insertedImage.id);

                // Phase 3: Process Tags
                if (tagNames.length > 0) {
                    try {
                        const uniqueTagNames = Array.from(new Set(tagNames));
                        for (const tagName of uniqueTagNames) {
                            const cleanName = tagName.trim();
                            if (!cleanName) continue;
                            const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                            await db.insert(tags as any).ignore().values({ name: cleanName, slug });
                            const [tagRecord] = await db.select().from(tags).where(eq(tags.slug, slug));
                            if (tagRecord) {
                                await db.insert(imageTags).ignore().values({
                                    imageId: insertedImage.id,
                                    tagId: tagRecord.id
                                });
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
            console.error(`Failed to process file ${file.name}`, e);
            failedFiles.push(file.name);
        }
    }

    if (failedFiles.length > 0 && successCount === 0) {
        return { error: 'All uploads failed' };
    }

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

    // Get image to find filenames
    const [image] = await db.select().from(images).where(eq(images.id, id));
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

    // Extract ID (basename without extension) from webp filename
    // specific format: uuid.webp
    const imageId = path.basename(image.filename_webp, path.extname(image.filename_webp));
    const safePrefix = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId)
        ? imageId
        : null;

    // Delete db record first (so if it fails, files remain intact)
    await db.delete(images).where(eq(images.id, id));

    // Delete files (best effort - log errors but don't fail)
    try {
        const dirs = [
            { path: 'public/uploads/original', file: image.filename_original }, // Original is exact
            { path: 'public/uploads/webp', file: image.filename_webp, prefix: safePrefix },
            { path: 'public/uploads/avif', file: image.filename_avif, prefix: safePrefix },
            { path: 'public/uploads/jpeg', file: image.filename_jpeg, prefix: safePrefix },
        ];

        for (const dirInfo of dirs) {
             const dirPath = path.join(process.cwd(), dirInfo.path);

             if (dirInfo.file) {
                 // Exact file deletion (original)
                 await fs.unlink(path.join(dirPath, dirInfo.file)).catch(() => {});
             }

             const prefix = dirInfo.prefix;
             if (prefix) {
                 // Prefix based deletion (converted variants)
                 try {
                     const files = await fs.readdir(dirPath);
                     // Delete file if it starts with the ID (e.g. "uuid.webp" or "uuid_2048.webp")
                     const toDelete = files.filter(f => f.startsWith(prefix));

                     for (const f of toDelete) {
                         await fs.unlink(path.join(dirPath, f)).catch(() => {});
                     }
                 } catch {
                     // dir might not exist or error reading
                 }
             }
        }

    } catch {
        console.error("Error deleting files");
    }

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

    let successCount = 0;
    let errorCount = 0;

    for (const id of ids) {
        const result = await deleteImage(id);
        if (result.success) {
            successCount++;
        } else {
            errorCount++;
        }
    }

    return { success: true, count: successCount, errors: errorCount };
}

export async function createTopic(formData: FormData) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    const label = formData.get('label') as string;
    const slug = formData.get('slug') as string;
    const orderStr = formData.get('order') as string;
    const imageFile = formData.get('image') as File;

    if (!label || !slug) return { error: 'Label and Slug are required' };

    // Validate and sanitize order (default to 0, limit range)
    let order = parseInt(orderStr, 10);
    if (isNaN(order)) order = 0;
    order = Math.max(-1000, Math.min(1000, order)); // Limit to reasonable range

    // Validate slug format
    if (!isValidSlug(slug)) {
        return { error: 'Invalid slug format. Use only lowercase letters, numbers, hyphens, and underscores.' };
    }

    // Checking for duplicate slug
    const existingTopic = await db.select().from(topics).where(eq(topics.slug, slug)).limit(1);
    if (existingTopic.length > 0) {
        return { error: 'Topic slug already exists' };
    }

    // Validate label length
    if (label.length > 100) {
        return { error: 'Label is too long (max 100 characters)' };
    }

    let imageFilename = null;
    if (imageFile && imageFile.size > 0 && imageFile.name !== 'undefined') {
         try {
             imageFilename = await processTopicImage(imageFile);
         } catch {
             // If image processing fails, continue without image but maybe warn?
             // For now, fail safely without image
         }
    }

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
    } catch {
        return { error: 'Failed to create topic' };
    }
}

export async function updateTopic(currentSlug: string, formData: FormData) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    // Validate currentSlug
    if (!currentSlug || !isValidSlug(currentSlug)) {
        return { error: 'Invalid current slug' };
    }

    const label = formData.get('label') as string;
    const slug = formData.get('slug') as string;
    const orderStr = formData.get('order') as string;
    const imageFile = formData.get('image') as File;

    if (!label || !slug) return { error: 'Label and Slug are required' };

    let order = parseInt(orderStr, 10);
    if (isNaN(order)) order = 0;
    order = Math.max(-1000, Math.min(1000, order));

    if (!isValidSlug(slug)) {
        return { error: 'Invalid slug format' };
    }

    // Check if slug changed and if new slug exists
    if (slug !== currentSlug) {
         const existingTopic = await db.select().from(topics).where(eq(topics.slug, slug)).limit(1);
         if (existingTopic.length > 0) {
             return { error: 'Topic slug already exists' };
         }
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
        await db.update(topics)
            .set({
                label,
                slug,
                order,
                ...(imageFilename ? { image_filename: imageFilename } : {})
            })
            .where(eq(topics.slug, currentSlug));

        revalidatePath('/admin/categories');
        revalidatePath('/');
        return { success: true };
    } catch {
         return { error: 'Failed to update topic' };
    }
}

export async function deleteTopic(slug: string) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!slug || !isValidSlug(slug)) {
        return { error: 'Invalid slug' };
    }

    try {
        const headerImages = await db.select().from(images).where(eq(images.topic, slug)).limit(1);
        if (headerImages.length > 0) {
            return { error: 'Cannot delete category containing images. Delete images first.' };
        }

        await db.delete(topics).where(eq(topics.slug, slug));
        revalidatePath('/admin/categories');
        revalidatePath('/');

        return { success: true };
    } catch {
         return { error: 'Failed to delete topic' };
    }
}

export async function createTopicAlias(topicSlug: string, alias: string) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!topicSlug || !isValidSlug(topicSlug)) {
        return { error: 'Invalid topic slug' };
    }

    if (!isValidSlug(alias)) {
        return { error: 'Invalid alias format' };
    }

    // Check if alias already exists (as a topic or alias)
    const existingTopic = await db.select().from(topics).where(eq(topics.slug, alias)).limit(1);
    if (existingTopic.length > 0) return { error: 'Alias conflicts with an existing topic slug' };

    const existingAlias = await db.select().from(topicAliases).where(eq(topicAliases.alias, alias)).limit(1);
    if (existingAlias.length > 0) return { error: 'Alias already exists' };

    await db.insert(topicAliases).values({
        alias,
        topicSlug
    });

    revalidatePath('/admin/categories');
    return { success: true };
}

export async function deleteTopicAlias(topicSlug: string, alias: string) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!topicSlug || !isValidSlug(topicSlug)) {
        return { error: 'Invalid topic slug' };
    }

    if (!alias || !isValidSlug(alias)) {
        return { error: 'Invalid alias' };
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

    const [image] = await db.select().from(images).where(eq(images.id, imageId));
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

                const group = { id: result.insertId, key: groupKey };

                if (!group) {
                    throw new Error('Failed to create group');
                }

                await tx.insert(sharedGroupImages)
                    .ignore()
                    .values(
                        uniqueImageIds.map((imgId) => ({
                            groupId: group.id,
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

export async function updatePassword(prevState: any, formData: FormData) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        return { error: 'Unauthorized' };
    }

    const currentPassword = formData.get('currentPassword') as string;
    const newPassword = formData.get('newPassword') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    if (!currentPassword || !newPassword || !confirmPassword) {
        return { error: 'All fields are required' };
    }

    if (newPassword !== confirmPassword) {
        return { error: 'New passwords do not match' };
    }

    if (newPassword.length < 8) {
        return { error: 'New password must be at least 8 characters long' };
    }

    try {
        // Verify current password
        const match = await argon2.verify(currentUser.password_hash, currentPassword);

        if (!match) {
            return { error: 'Incorrect current password' };
        }

        // Hash new password
        const newHash = await argon2.hash(newPassword);

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
        console.error("Failed to update password", e);
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
        const [tagRecord] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
        if (!tagRecord) return { error: 'Failed to retrieve tag' };

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
        const [tagRecord] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
        if (!tagRecord) return { error: 'Failed to retrieve tag' };

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

    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    if (!username || username.length < 3) return { error: 'Username must be at least 3 chars' };
    if (username.length > 64) return { error: 'Username is too long (max 64 chars)' };
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return { error: 'Username can only contain letters, numbers, underscores, and hyphens' };
    if (!password || password.length < 8) return { error: 'Password must be at least 8 chars' };

    try {
        const hash = await argon2.hash(password);
        await db.insert(adminUsers).values({
            username,
            password_hash: hash
        });

        revalidatePath('/admin/dashboard');
        return { success: true };
    } catch (e: any) {
        if (e.code === 'ER_DUP_ENTRY' || e.message?.includes('users.username')) {
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

    // Check if it's the last admin? (Optional but good safety)
    // const admins = await db.select({ count: sql<number>`count(*)` }).from(adminUsers);
    // if (admins[0].count <= 1) return { error: 'Cannot delete the last admin' };

    try {
        await db.delete(adminUsers).where(eq(adminUsers.id, id));
        revalidatePath('/admin/dashboard');
        return { success: true };
    } catch (e) {
        console.error('Delete user failed', e);
        return { error: 'Failed to delete user' };
    }
}
