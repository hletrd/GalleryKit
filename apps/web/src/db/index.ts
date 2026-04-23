import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
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
// Attach a .catch() handler so a transient failure is logged instead of producing an
// unhandled promise rejection (Node 24 strict) AND silently reverting the pooled
// connection to the default 1024-byte limit, which would truncate GROUP_CONCAT output
// in CSV exports and SEO settings (C4R-RPL2-01 — aggregated finding AGG4R2-01).
poolConnection.on('connection', (connection) => {
    connection.query('SET group_concat_max_len = 65535')
        .catch((err) => console.error('[db] Failed to set group_concat_max_len on pooled connection:', err));
});

export const connection = poolConnection;
export const db = drizzle(poolConnection, { mode: "default", schema });
export { images, topics, topicAliases, tags, imageTags, adminSettings, sharedGroups, sharedGroupImages, adminUsers, sessions, rateLimitBuckets, auditLog } from './schema';
