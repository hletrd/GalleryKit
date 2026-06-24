import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import type { PoolConnection as CallbackPoolConnection } from "mysql2";
import * as schema from "./schema";

// Enable TLS for non-localhost DB connections to protect credentials in transit.
// Override with DB_SSL=false to disable (e.g., for VPC-internal connections).
const dbHost = process.env.DB_HOST ?? '127.0.0.1';
const isLocalhost = ['127.0.0.1', 'localhost', '::1'].includes(dbHost);
const sslDisabled = process.env.DB_SSL === 'false';
const sslConfig = (!isLocalhost && !sslDisabled) ? { ssl: { rejectUnauthorized: true } } : {};

// AGG-R5C3-05 + AGG-5 (run-6 c1): exported so background maintenance ops (the
// color-pipeline backfill runner) can budget how many of the shared pool
// connections they pin without starving live traffic. The runner caps its
// effective concurrency at max(1, floor((POOL_CONNECTION_LIMIT - RESERVED - 1)
// / 2)) with RESERVED = max(3, ceil(POOL_CONNECTION_LIMIT / 2)) — each backfill
// worker can hold up to 2 connections at once (the per-image processing claim
// + a transient db.execute), the whole-run advisory lock pins 1 more, and
// RESERVED is held back for live traffic. At the shipped limit of 10 the cap is
// 2 (a backfill pins ≤ 5, leaving ≥ 5 free). See `resolveBackfillConcurrency`
// in admin-backfill-runner.ts for the authoritative arithmetic.
export const POOL_CONNECTION_LIMIT = 10;

const poolConnection = mysql.createPool({
    host: dbHost,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: POOL_CONNECTION_LIMIT,
    waitForConnections: true,
    queueLimit: 20,
    connectTimeout: 5000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000,
    ...sslConfig,
});

// Increase GROUP_CONCAT max length from default 1024 to prevent silent truncation of tag lists.
// IMPORTANT: the `connection` event listener in mysql2 receives the base
// callback-style Connection even when the pool was created via mysql2/promise
// (see https://github.com/sidorares/node-mysql2 — the "try con.promise().query()"
// runtime guard fires when chaining `.catch`). Call `.promise()` to obtain a
// PromiseConnection whose `.query(...)` returns a Promise so the `.catch()`
// handler logs transient failures via `console.error` instead of:
//   (a) producing an unhandled promise rejection under Node 24 strict, AND
//   (b) silently reverting the pooled connection to the default 1024-byte
//       limit, which would truncate GROUP_CONCAT output in CSV exports and
//       SEO settings.
// C4R-RPL2-01 (aggregated finding AGG4R2-01).
//
// C6R-04: Use a well-known Symbol property on the connection object itself
// instead of a WeakMap keyed by callback-style PoolConnection. The 'connection'
// event handler and getConnection() may see different wrapper objects (callback
// vs promise-style), so WeakMap lookups can silently fail. A Symbol property
// travels with the object reference that getConnection() returns.
const connectionInitSymbol = Symbol.for('gallerykit.db.connectionInit');

poolConnection.on('connection', (connection) => {
    const callbackConnection = connection as unknown as CallbackPoolConnection;
    const initPromise = callbackConnection.promise().query('SET group_concat_max_len = 65535')
        .then(() => undefined)
        .catch((err: unknown) => {
            console.error('[db] Failed to set group_concat_max_len on pooled connection:', err);
        });
    (connection as unknown as Record<symbol, Promise<void>>)[connectionInitSymbol] = initPromise;
});

const originalGetConnection = poolConnection.getConnection.bind(poolConnection);
poolConnection.getConnection = (async (...args: Parameters<typeof poolConnection.getConnection>) => {
    const connection = await originalGetConnection(...args);
    // C8-F01: The symbol property is attached to the underlying callback
    // Connection in the 'connection' event handler, but getConnection()
    // returns a PromisePoolConnection wrapper. Access the symbol via the
    // wrapper's .connection property so the init promise is actually awaited.
    const underlying = (connection as unknown as { connection?: Record<symbol, Promise<void> | undefined> }).connection;
    const initPromise = underlying?.[connectionInitSymbol];
    if (initPromise) {
        // C4-C1: Race the init query against a 10-second timeout. If MySQL
        // accepts the TCP connection but never responds to the init query
        // (e.g., server under extreme load), the connection would be held
        // indefinitely, starving the pool. On timeout, release the connection
        // and throw so the caller can retry or fail fast.
        const initTimeout = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error('DB connection init query timed out after 10s')), 10_000);
        });
        try {
            await Promise.race([initPromise, initTimeout]);
        } catch (err) {
            connection.release();
            throw err;
        }
    }
    return connection;
}) as typeof poolConnection.getConnection;


poolConnection.query = (async (...args: Parameters<typeof poolConnection.query>) => {
    const queryConnection = await poolConnection.getConnection();
    try {
        return await queryConnection.query(...args as Parameters<typeof queryConnection.query>);
    } finally {
        queryConnection.release();
    }
}) as typeof poolConnection.query;

poolConnection.execute = (async (...args: Parameters<typeof poolConnection.execute>) => {
    const executeConnection = await poolConnection.getConnection();
    try {
        return await executeConnection.execute(...args as Parameters<typeof executeConnection.execute>);
    } finally {
        executeConnection.release();
    }
}) as typeof poolConnection.execute;

export const connection = poolConnection;
export const db = drizzle(poolConnection, { mode: "default", schema });
export { images, topics, topicAliases, tags, imageTags, adminSettings, sharedGroups, sharedGroupImages, adminUsers, sessions, rateLimitBuckets, auditLog, adminTokens, smartCollections, imageViews, topicViews, sharedGroupViews, imageEmbeddings } from './schema';
