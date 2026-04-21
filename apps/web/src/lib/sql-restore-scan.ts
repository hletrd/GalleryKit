const DANGEROUS_SQL_PATTERNS = [
    /\bGRANT\s/i,
    /\bCREATE\s+USER\b/i,
    /\bALTER\s+USER\b/i,
    /\bSET\s+PASSWORD\b/i,
    /\bDROP\s+DATABASE\b/i,
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

export const SQL_SCAN_TAIL_BYTES = 64 * 1024;

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

    return [
        /'(?:''|\\.|[^'\\])*'/gs,
        /"(?:\"\"|\\.|[^"\\])*"/gs,
        /`(?:``|\\.|[^`\\])*`/gs,
        // Hex literals: 0x followed by hex digits (can encode malicious data for INSERT)
        /0x[0-9a-fA-F]+/g,
        // Binary literals: b'...' or 0b... (MySQL bit-value literals)
        /b'[01]+'/g,
        /0b[01]+/g,
    ].reduce((acc, pattern) => maskMatches(acc, pattern), withoutComments);
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
