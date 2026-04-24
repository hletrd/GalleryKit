
const APP_BACKUP_TABLES = [
    'admin_settings',
    'admin_users',
    'audit_log',
    'image_tags',
    'images',
    'rate_limit_buckets',
    'sessions',
    'shared_group_images',
    'shared_groups',
    'tags',
    'topic_aliases',
    'topics',
] as const;

const APP_BACKUP_TABLE_PATTERN = APP_BACKUP_TABLES.join('|');
const ALLOWED_APP_BACKUP_DROP_TABLE_PATTERN = new RegExp(
    "\\bDROP\\s+TABLE\\s+IF\\s+EXISTS\\s+`?(?:" + APP_BACKUP_TABLE_PATTERN + ")`?\\s*;",
    'gi',
);

const DANGEROUS_SQL_PATTERNS = [
    /\bGRANT\s/i,
    // C5R-RPL-01: also block REVOKE and RENAME USER. Legitimate mysqldump
    // output never contains these; a crafted dump restored into a shared
    // MySQL instance with GRANT OPTION could otherwise downgrade another
    // app's privileges or rename a co-hosted admin user. Defense-in-depth.
    /\bREVOKE\s/i,
    /\bRENAME\s+USER\b/i,
    /\bCREATE\s+USER\b/i,
    /\bALTER\s+USER\b/i,
    /\bSET\s+PASSWORD\b/i,
    /\bDROP\s+DATABASE\b/i,
    // C3RPF-02 / AGG-C3-03: block destructive table-level statements.
    // A restore file is supposed to represent the application backup shape;
    // accepting arbitrary table drops/deletes/truncates creates a data-loss
    // path that --one-database does not prevent.
    /\bDROP\s+TABLE\b/i,
    /\bTRUNCATE\s+(?:TABLE\s+)?/i,
    /\bDELETE\s+FROM\b/i,
    // C4R-RPL2-05: also block CREATE DATABASE. `--one-database` filters out
    // writes that target a different schema, but a malformed dump that
    // creates a sibling database (then USEs it before data writes) would
    // otherwise slip past the scanner. Blocking here is defence-in-depth.
    /\bCREATE\s+DATABASE\b/i,
    // C5R-RPL-01: also block CALL proc_name(...). A crafted dump could
    // invoke an already-installed stored procedure (e.g. a procedure
    // defined with `SQL SECURITY DEFINER` by another tenant's setup)
    // to execute actions beyond --one-database's scope. Legitimate
    // mysqldump output never emits CALL. Defense-in-depth.
    /\bCALL\s+\w+/i,
    // C1RPF-03 / AGG1-04: block DO statements. `DO SLEEP(...)` is not
    // emitted by normal mysqldump output and can hold the restore session
    // and maintenance lock without touching table data.
    /\bDO\s+/i,
    /\bLOAD\s+DATA\b/i,
    /\bINTO\s+OUTFILE\b/i,
    /\bINTO\s+DUMPFILE\b/i,
    /\bSYSTEM\s+\w/i,
    /\bSHUTDOWN\b/i,
    /\bSOURCE\s/i,
    /\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i,
    /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i,
    /\bCREATE\s+(OR\s+REPLACE\s+)?PROCEDURE\b/i,
    /\bCREATE\s+(OR\s+REPLACE\s+)?EVENT\b/i,
    /\bALTER\s+EVENT\b/i,
    /\bDELIMITER\b/i,
    /\bINSTALL\s+PLUGIN\b/i,
    /\bSET\s+GLOBAL\b/i,
    /\bCREATE\s+SERVER\b/i,
    /\bRENAME\s+TABLE\b/i,
    /\bCREATE\s+(OR\s+REPLACE\s+)?VIEW\b/i,
    /\bPREPARE\b/i,
    /\bEXECUTE\b/i,
    /\bDEALLOCATE\s+PREPARE\b/i,
    /\bSET\s+@\w+\s*=\s*0x/i,
    /\bSET\s+@\w+\s*=\s*b'/i,
    /\bSET\s+@\w+\s*=\s*X'/i,
    /\bSET\s+@@global\./i,
] as const;

export const SQL_SCAN_TAIL_BYTES = 1024 * 1024;

function maskMatches(input: string, pattern: RegExp): string {
    return input.replace(pattern, (match) => ' '.repeat(match.length));
}

export function stripSqlCommentsAndLiterals(input: string): string {
    // Extract inner content from MySQL conditional comments (/*!ddddd ... */)
    // before stripping. These are EXECUTED by MySQL when server version >= ddddd,
    // so their content must be scanned. Replace the entire conditional comment
    // with its inner statement text so the dangerous-SQL patterns can match it.
    const withoutConditionals = input.replace(/\/\*!(\d{5,6})\s*([\s\S]*?)\*\//g, (_, _version, inner) => inner);

    const withoutComments = withoutConditionals.replace(/\/\*.*?\*\//gs, '');
    const withoutAllowedAppBackupDrops = maskMatches(withoutComments, ALLOWED_APP_BACKUP_DROP_TABLE_PATTERN);

    return [
        /'(?:''|\\.|[^'\\])*'/gs,
        /"(?:\"\"|\\.|[^"\\])*"/gs,
        /`(?:``|\\.|[^`\\])*`/gs,
        // Hex literals: 0x followed by hex digits (can encode malicious data for INSERT)
        /0x[0-9a-fA-F]+/g,
        // Binary literals: b'...' or 0b... (MySQL bit-value literals)
        /b'[01]+'/g,
        /0b[01]+/g,
    ].reduce((acc, pattern) => maskMatches(acc, pattern), withoutAllowedAppBackupDrops);
}

export function containsDangerousSql(input: string): boolean {
    const sanitized = stripSqlCommentsAndLiterals(input);
    return DANGEROUS_SQL_PATTERNS.some((pattern) => pattern.test(sanitized));
}

export function appendSqlScanChunk(
    previousTail: string,
    chunk: string,
    maxTailBytes: number = SQL_SCAN_TAIL_BYTES,
) {
    const combined = `${previousTail}${chunk}`;
    return {
        combined,
        nextTail: combined.slice(-maxTailBytes),
    };
}
