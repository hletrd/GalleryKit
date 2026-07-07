const { readFileSync } = module.require('node:fs');

const LOCAL_DB_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function getRequiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function getMysqlConnectionOptions(overrides = {}) {
    const host = (overrides.host ?? process.env.DB_HOST ?? '127.0.0.1').trim();
    const sslDisabled = process.env.DB_SSL === 'false';
    const useTls = !LOCAL_DB_HOSTS.has(host) && !sslDisabled;
    const caPath = (overrides.sslCa ?? process.env.DB_SSL_CA ?? '').trim();
    if (useTls && !caPath) {
        throw new Error('DB_SSL_CA is required for non-local DB connections unless DB_SSL=false');
    }

    return {
        host,
        port: Number(overrides.port ?? process.env.DB_PORT) || 3306,
        user: overrides.user ?? getRequiredEnv('DB_USER'),
        password: overrides.password ?? getRequiredEnv('DB_PASSWORD'),
        database: overrides.database ?? getRequiredEnv('DB_NAME'),
        ...(useTls ? { ssl: { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true } } : {}),
    };
}

module.exports = {
    getMysqlConnectionOptions,
};
