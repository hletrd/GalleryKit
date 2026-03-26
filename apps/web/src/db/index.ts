import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

const poolConnection = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 20,
    waitForConnections: true,
    queueLimit: 50,
    connectTimeout: 5000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000,
});

export const connection = poolConnection;
export const db = drizzle(poolConnection, { mode: "default", schema });
export { images, topics, topicAliases, tags, imageTags, adminSettings, sharedGroups, sharedGroupImages, adminUsers, sessions } from './schema';
