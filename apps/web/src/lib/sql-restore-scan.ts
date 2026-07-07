
// Every table emitted by the app's own `mysqldump` (db-actions.ts uses the
// default `--add-drop-table`, so each table is preceded by a
// `DROP TABLE IF EXISTS \`<table>\`;` line). The restore scanner masks ONLY
// these known-app drops before applying the destructive-SQL guard, so this
// list MUST stay a SUPERSET of every table in src/db/schema.ts — otherwise a
// restore of the app's own current-schema backup is erroneously blocked by the
// `\bDROP\s+TABLE\b` pattern. Kept sorted for readability. The superset
// invariant is locked by `__tests__/sql-restore-scan.test.ts` (a tripwire that
// introspects the Drizzle schema), so a future table added without updating
// this list fails the test rather than silently breaking restore.
export const APP_BACKUP_TABLES = [
    'admin_settings',
    'admin_tokens',
    'admin_users',
    'audit_log',
    'image_embeddings',
    'image_tags',
    'image_views',
    'images',
    'pending_file_deletions',
    'rate_limit_buckets',
    'sessions',
    'shared_group_images',
    'shared_group_views',
    'shared_groups',
    'smart_collections',
    'tags',
    'topic_aliases',
    'topic_views',
    'topics',
] as const;

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tableNamePatternWithScannerBoundary(tableName: string): string {
    // appendSqlScanChunk joins the compacted previous tail and current chunk
    // with a literal newline. If that newline lands inside a known app table
    // name, the allowed-drop mask must still recognize the dump's own
    // `DROP TABLE IF EXISTS` prelude; otherwise the generic DROP TABLE guard
    // false-positives on a valid backup. Restrict the tolerance to the scanner's
    // injected newline rather than arbitrary SQL whitespace.
    return Array.from(tableName).map(escapeRegExp).join('(?:\\n)?');
}

const APP_BACKUP_TABLE_PATTERN = APP_BACKUP_TABLES.map(tableNamePatternWithScannerBoundary).join('|');
const APP_BACKUP_TABLE_SET = new Set<string>(APP_BACKUP_TABLES);
const ALLOWED_APP_BACKUP_DROP_TABLE_PATTERN = new RegExp(
    "\\bDROP\\s+TABLE\\s+IF\\s+EXISTS\\s+`?(?:" + APP_BACKUP_TABLE_PATTERN + ")`?\\s*;",
    'gi',
);
const TRAILING_APP_BACKUP_DROP_FRAGMENT_PATTERN = /\bDROP\s+TABLE\s+IF\s+EXISTS\s+`?([A-Za-z0-9_$\n]*)$/i;

function maskAllowedAppBackupDrops(input: string): string {
    const withoutCompleteDrops = maskMatches(input, ALLOWED_APP_BACKUP_DROP_TABLE_PATTERN);
    return withoutCompleteDrops.replace(TRAILING_APP_BACKUP_DROP_FRAGMENT_PATTERN, (match, rawTablePrefix: string) => {
        const normalizedPrefix = rawTablePrefix.replace(/\n/g, '').toLowerCase();
        if (APP_BACKUP_TABLES.some((tableName) => tableName.startsWith(normalizedPrefix))) {
            return ' '.repeat(match.length);
        }
        return match;
    });
}
const SQL_IDENTIFIER_PATTERN = '(?:`(?:``|[^`])+`|[A-Za-z0-9_$]+)';
const SQL_SCHEMA_QUALIFIED_IDENTIFIER_PATTERN = new RegExp(
    `(?:^|[^A-Za-z0-9_$\`])${SQL_IDENTIFIER_PATTERN}\\s*\\.\\s*${SQL_IDENTIFIER_PATTERN}`,
    'i',
);
const SQL_WRITE_TARGET_PATTERN = new RegExp(
    [
        '\\b(?:',
        'CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+',
        '|ALTER\\s+TABLE\\s+',
        '|INSERT\\s+(?:(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY)\\s+)?(?:IGNORE\\s+)?(?:INTO\\s+)?',
        '|REPLACE(?:\\s+(?:LOW_PRIORITY|DELAYED))?(?:\\s+INTO)?\\s+',
        '|UPDATE(?:\\s+LOW_PRIORITY)?(?:\\s+IGNORE)?\\s+',
        ')(',
        SQL_IDENTIFIER_PATTERN,
        ')(?:\\s*\\.\\s*(',
        SQL_IDENTIFIER_PATTERN,
        '))?',
    ].join(''),
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
    /\bCREATE\s+TEMPORARY\s+TABLE\b/i,
    /\bDROP\s+TEMPORARY\s+TABLE\b/i,
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
    // C6-AGG6R-04: block HANDLER ... READ. MySQL's HANDLER interface provides
    // low-level table access that bypasses some access controls. Legitimate
    // mysqldump output never emits HANDLER statements. Defense-in-depth.
    /\bHANDLER\s+/i,
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
    // MySQL allows `CREATE DEFINER = ... TRIGGER|VIEW|FUNCTION|PROCEDURE|EVENT`.
    // Scan sanitized SQL with optional DEFINER clauses so mysqldump-style
    // conditional comments cannot hide routines/triggers behind CREATE modifiers.
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:DEFINER\s*=\s*[^;]*?\s+)?TRIGGER\b/i,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:DEFINER\s*=\s*[^;]*?\s+)?FUNCTION\b/i,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:DEFINER\s*=\s*[^;]*?\s+)?PROCEDURE\b/i,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:DEFINER\s*=\s*[^;]*?\s+)?EVENT\b/i,
    /\bALTER\s+EVENT\b/i,
    /\bDELIMITER\b/i,
    /\bINSTALL\s+PLUGIN\b/i,
    /\bSET\s+GLOBAL\b/i,
    /\bCREATE\s+SERVER\b/i,
    /\bRENAME\s+TABLE\b/i,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:DEFINER\s*=\s*[^;]*?\s+)?VIEW\b/i,
    /\bSQL\s+SECURITY\s+DEFINER\b/i,
    /\bPREPARE\b/i,
    /\bEXECUTE\b/i,
    /\bDEALLOCATE\s+PREPARE\b/i,
    /\bSET\s+@\w+\s*=\s*0x/i,
    /\bSET\s+@\w+\s*=\s*b'/i,
    /\bSET\s+@\w+\s*=\s*X'/i,
    /\bSET\s+@@global\./i,
] as const;

export const SQL_SCAN_TAIL_BYTES = 1024 * 1024;

// C6-01 (run-10 cycle-6): raw byte-continuous bridge width. The compacted
// `\n`-join in appendSqlScanChunk collapses megabytes of inter-token whitespace
// so `CREATE … TRIGGER` still fits the retained tail window, but that injected
// newline lands EXACTLY at the read boundary. An attacker who aligns a dangerous
// statement so the boundary falls inside a keyword TOKEN (e.g. `DROP TAB`|`LE`)
// breaks the token with the newline, evading `/\bDROP\s+TABLE\b/i`. To close
// that, we ALSO scan the raw suffix of the previous chunk concatenated directly
// (no separator) to the raw prefix of the current chunk, losslessly rejoining a
// split keyword. 128 comfortably spans the longest contiguous dangerous keyword
// phrase; huge-whitespace inter-token splits stay covered by the compacted tail.
export const SQL_SCAN_RAW_BRIDGE_BYTES = 128;

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
    const withoutAllowedAppBackupDrops = maskAllowedAppBackupDrops(withoutComments);

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

function stripSqlCommentsAndLiteralsWithCommentSpaces(input: string): string {
    const withoutConditionals = input.replace(/\/\*!(\d{5,6})\s*([\s\S]*?)\*\//g, (_, _version, inner) => inner);
    const withoutComments = withoutConditionals.replace(/\/\*.*?\*\//gs, (match) => ' '.repeat(match.length));
    const withoutAllowedAppBackupDrops = maskAllowedAppBackupDrops(withoutComments);

    return [
        /'(?:''|\\.|[^'\\])*'/gs,
        /"(?:\"\"|\\.|[^"\\])*"/gs,
        /`(?:``|\\.|[^`\\])*`/gs,
        /0x[0-9a-fA-F]+/g,
        /b'[01]+'/g,
        /0b[01]+/g,
    ].reduce((acc, pattern) => maskMatches(acc, pattern), withoutAllowedAppBackupDrops);
}

function stripSqlCommentsAndValueLiterals(input: string): string {
    const withoutConditionals = input.replace(/\/\*!(\d{5,6})\s*([\s\S]*?)\*\//g, (_, _version, inner) => inner);
    const withoutComments = withoutConditionals.replace(/\/\*.*?\*\//gs, '');
    const withoutAllowedAppBackupDrops = maskAllowedAppBackupDrops(withoutComments);

    return [
        /'(?:''|\\.|[^'\\])*'/gs,
        /"(?:\"\"|\\.|[^"\\])*"/gs,
        /0x[0-9a-fA-F]+/g,
        /b'[01]+'/g,
        /0b[01]+/g,
    ].reduce((acc, pattern) => maskMatches(acc, pattern), withoutAllowedAppBackupDrops);
}

function stripSqlCommentsAsSpacesAndValueLiterals(input: string): string {
    const withoutConditionals = input.replace(/\/\*!(\d{5,6})\s*([\s\S]*?)\*\//g, (_, _version, inner) => inner);
    const withoutComments = withoutConditionals.replace(/\/\*.*?\*\//gs, (match) => ' '.repeat(match.length));
    const withoutAllowedAppBackupDrops = maskAllowedAppBackupDrops(withoutComments);

    return [
        /'(?:''|\\.|[^'\\])*'/gs,
        /"(?:\"\"|\\.|[^"\\])*"/gs,
        /0x[0-9a-fA-F]+/g,
        /b'[01]+'/g,
        /0b[01]+/g,
    ].reduce((acc, pattern) => maskMatches(acc, pattern), withoutAllowedAppBackupDrops);
}

function compactSqlScanTail(input: string): string {
    const forms = [
        stripSqlCommentsAndLiterals(input),
        stripSqlCommentsAndLiteralsWithCommentSpaces(input),
        stripSqlCommentsAndValueLiterals(input),
        stripSqlCommentsAsSpacesAndValueLiterals(input),
    ];
    const compactedForms = forms
        .map((form) => form.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    return Array.from(new Set(compactedForms)).join('\n');
}

function normalizeSqlIdentifier(identifier: string) {
    const trimmed = identifier.trim();
    if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
        return trimmed.slice(1, -1).replace(/``/g, '`').toLowerCase();
    }
    return trimmed.toLowerCase();
}

function hasDisallowedRestoreWriteTarget(input: string) {
    const sanitizedForms = [
        stripSqlCommentsAndValueLiterals(input),
        stripSqlCommentsAsSpacesAndValueLiterals(input),
    ];

    for (const sanitized of sanitizedForms) {
        if (SQL_SCHEMA_QUALIFIED_IDENTIFIER_PATTERN.test(sanitized)) {
            return true;
        }

        SQL_WRITE_TARGET_PATTERN.lastIndex = 0;

        let match: RegExpExecArray | null;
        while ((match = SQL_WRITE_TARGET_PATTERN.exec(sanitized)) !== null) {
            const firstIdentifier = normalizeSqlIdentifier(match[1] ?? '');
            const secondIdentifier = match[2] ? normalizeSqlIdentifier(match[2]) : null;
            if (!firstIdentifier) continue;

            if (secondIdentifier) {
                return true;
            }

            if (!APP_BACKUP_TABLE_SET.has(firstIdentifier)) {
                return true;
            }
        }
    }

    return false;
}

export function containsDangerousSql(input: string): boolean {
    if (hasDisallowedRestoreWriteTarget(input)) {
        return true;
    }

    const sanitizedForms = [
        stripSqlCommentsAndLiterals(input),
        stripSqlCommentsAndLiteralsWithCommentSpaces(input),
    ];
    return sanitizedForms.some((sanitized) => DANGEROUS_SQL_PATTERNS.some((pattern) => pattern.test(sanitized)));
}

export function appendSqlScanChunk(
    previousTail: string,
    chunk: string,
    maxTailBytes: number = SQL_SCAN_TAIL_BYTES,
    previousRawSuffix: string = '',
) {
    // Compacted-tail join: preserves the >window whitespace-collapse case so a
    // dangerous keyword separated from its object by megabytes of whitespace
    // still fits the retained tail. The injected `\n` is a token separator here.
    const compactedJoin = previousTail ? `${previousTail}\n${chunk}` : chunk;
    // Raw byte-continuous bridge (C6-01): rejoin a keyword token split exactly at
    // the chunk read boundary. `previousRawSuffix` is the last
    // SQL_SCAN_RAW_BRIDGE_BYTES raw chars of the prior chunk; concatenating it
    // directly (NO separator) to this chunk's raw prefix reassembles e.g.
    // `DROP TAB` + `LE images;` → `DROP TABLE images;`, which the compacted `\n`
    // join would otherwise break. Scanned as an extra `\n`-separated segment so
    // it cannot merge tokens with the compacted-join tail.
    const rawBridge = previousRawSuffix
        ? `${previousRawSuffix}${chunk.slice(0, SQL_SCAN_RAW_BRIDGE_BYTES)}`
        : '';
    const combined = rawBridge ? `${compactedJoin}\n${rawBridge}` : compactedJoin;
    const compactTail = compactSqlScanTail(compactedJoin);
    return {
        combined,
        nextTail: compactTail.slice(-maxTailBytes),
        // C7-12 (run-10 cycle 7b): the rolling raw suffix must cover the
        // CUMULATIVE stream, not just the current chunk. The previous
        // per-chunk shape (`chunk.slice(-N)` / whole short chunk) DROPPED the
        // prior suffix whenever a read returned fewer than N bytes — a
        // legally-possible short fd.read() could then split a dangerous
        // keyword across THREE reads ("DR" | "OP TAB" | "LE images;") and the
        // middle chunk's tiny suffix lost the "DR", evading the bridge scan.
        // Concatenating previous suffix + chunk before slicing keeps the last
        // N raw bytes of everything seen so far, regardless of chunk sizes.
        nextRawSuffix: `${previousRawSuffix}${chunk}`.slice(-SQL_SCAN_RAW_BRIDGE_BYTES),
    };
}
