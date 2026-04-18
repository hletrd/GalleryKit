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
] as const;

function maskMatches(input: string, pattern: RegExp): string {
    return input.replace(pattern, (match) => ' '.repeat(match.length));
}

export function stripSqlCommentsAndLiterals(input: string): string {
    const withoutComments = input.replace(/\/\*.*?\*\//gs, '');

    return [
        /'(?:''|\\.|[^'\\])*'/gs,
        /"(?:\"\"|\\.|[^"\\])*"/gs,
        /`(?:``|\\.|[^`\\])*`/gs,
    ].reduce((acc, pattern) => maskMatches(acc, pattern), withoutComments);
}

export function containsDangerousSql(input: string): boolean {
    const sanitized = stripSqlCommentsAndLiterals(input);
    return DANGEROUS_SQL_PATTERNS.some((pattern) => pattern.test(sanitized));
}
