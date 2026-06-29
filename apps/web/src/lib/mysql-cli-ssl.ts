const LOCAL_MYSQL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function shouldRequireMysqlCliSsl(
    host: string | undefined,
    dbSsl: string | undefined = process.env.DB_SSL,
) {
    const dbHost = host ?? '127.0.0.1';
    return !LOCAL_MYSQL_HOSTS.has(dbHost) && dbSsl !== 'false';
}

export function getMysqlCliSslArgs(
    host: string | undefined,
    dbSsl: string | undefined = process.env.DB_SSL,
    dbSslCa: string | undefined = process.env.DB_SSL_CA,
) {
    if (!shouldRequireMysqlCliSsl(host, dbSsl)) return [];

    const caPath = dbSslCa?.trim();
    if (!caPath) {
        throw new Error('DB_SSL_CA is required for verified MySQL CLI TLS when DB_HOST is non-local');
    }

    return ['--ssl', `--ssl-ca=${caPath}`, '--ssl-verify-server-cert'];
}
