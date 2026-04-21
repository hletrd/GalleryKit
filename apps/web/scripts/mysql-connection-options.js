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

    return {
        host,
        port: Number(overrides.port ?? process.env.DB_PORT) || 3306,
        user: overrides.user ?? getRequiredEnv('DB_USER'),
        password: overrides.password ?? getRequiredEnv('DB_PASSWORD'),
        database: overrides.database ?? getRequiredEnv('DB_NAME'),
        ...(useTls ? { ssl: { rejectUnauthorized: true } } : {}),
    };
}

module.exports = {
    getMysqlConnectionOptions,
};
