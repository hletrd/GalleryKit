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

const poolConnection = mysql.createPool({
    host: dbHost,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 10,
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
// Type note: mysql2/promise declares the 'connection' event arg as its own
// promise-based PoolConnection (which lacks `.promise()` in types). At
// runtime the listener receives the base callback-style PoolConnection from
// the mysql2 (non-promise) module, which does expose `.promise()`. Cast
// through `CallbackPoolConnection` so the cast is explicit and documented.
const connectionInitPromises = new WeakMap<CallbackPoolConnection, Promise<void>>();

poolConnection.on('connection', (connection) => {
    const callbackConnection = connection as unknown as CallbackPoolConnection;
    const initPromise = callbackConnection.promise().query('SET group_concat_max_len = 65535')
        .then(() => undefined)
        .catch((err: unknown) => {
            console.error('[db] Failed to set group_concat_max_len on pooled connection:', err);
        });
    connectionInitPromises.set(callbackConnection, initPromise);
});

const originalGetConnection = poolConnection.getConnection.bind(poolConnection);
poolConnection.getConnection = (async (...args: Parameters<typeof poolConnection.getConnection>) => {
    const connection = await originalGetConnection(...args);
    const callbackConnection = connection as unknown as CallbackPoolConnection;
    const initPromise = connectionInitPromises.get(callbackConnection);
    if (initPromise) {
        await initPromise;
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
