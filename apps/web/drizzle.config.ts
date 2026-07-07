import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";

dotenv.config({ path: ".env.local" });

const dbHost = process.env.DB_HOST ?? '127.0.0.1';
const isLocalhost = ['127.0.0.1', 'localhost', '::1'].includes(dbHost);
const sslDisabled = process.env.DB_SSL === 'false';
const ssl = (() => {
    if (isLocalhost || sslDisabled) return undefined;
    const caPath = process.env.DB_SSL_CA?.trim();
    if (!caPath) {
        throw new Error('DB_SSL_CA is required for non-local DB connections unless DB_SSL=false');
    }
    return { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
})();

export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    dialect: "mysql",
    dbCredentials: {
        host: dbHost,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER ?? '',
        password: process.env.DB_PASSWORD ?? '',
        database: process.env.DB_NAME ?? '',
        ...(ssl ? { ssl } : {}),
    },
});
