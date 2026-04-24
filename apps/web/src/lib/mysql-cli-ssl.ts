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
) {
    return shouldRequireMysqlCliSsl(host, dbSsl) ? ['--ssl-mode=REQUIRED'] : [];
}
