/**
 * CI check: verifies all /api/admin/ route files export HTTP handlers wrapped
 * directly with withAdminAuth(...).
 * Run with: npx tsx scripts/check-api-auth.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const API_ADMIN_DIR = path.resolve(__dirname, '../src/app/api/admin');

function findRouteFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findRouteFiles(full));
        } else if (entry.name === 'route.ts' || entry.name === 'route.js') {
            results.push(full);
        }
    }
    return results;
}

let failed = false;
const routeFiles = findRouteFiles(API_ADMIN_DIR);
const HTTP_METHOD_EXPORTS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function unwrapExpression(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (
        ts.isParenthesizedExpression(current)
        || ts.isAsExpression(current)
        || ts.isTypeAssertionExpression(current)
        || ts.isSatisfiesExpression(current)
    ) {
        current = current.expression;
    }
    return current;
}

function getLineNumber(sourceFile: ts.SourceFile, node: ts.Node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function variableUsesWithAdminAuth(initializer: ts.Expression | undefined): boolean {
    if (!initializer) return false;
    const unwrapped = unwrapExpression(initializer);
    if (!ts.isCallExpression(unwrapped)) {
        return false;
    }

    const callee = unwrapExpression(unwrapped.expression);
    return ts.isIdentifier(callee) && callee.text === 'withAdminAuth';
}

function checkRouteFile(file: string) {
    const content = fs.readFileSync(file, 'utf-8');
    const relative = path.relative(process.cwd(), file);
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
    let sawHandlerExport = false;

    for (const statement of sourceFile.statements) {
        const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
        const isExported = !!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
        if (!isExported) continue;

        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (!ts.isIdentifier(declaration.name) || !HTTP_METHOD_EXPORTS.has(declaration.name.text)) {
                    continue;
                }

                sawHandlerExport = true;
                if (!variableUsesWithAdminAuth(declaration.initializer)) {
                    console.error(`MISSING AUTH: ${relative}:${getLineNumber(sourceFile, declaration)} must export ${declaration.name.text} = withAdminAuth(...)`);
                    failed = true;
                }
            }
            continue;
        }

        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name && HTTP_METHOD_EXPORTS.has(statement.name.text)) {
            sawHandlerExport = true;
            console.error(`MISSING AUTH: ${relative}:${getLineNumber(sourceFile, statement)} must export ${statement.name.text} via withAdminAuth(...)`);
            failed = true;
        }
    }

    if (!sawHandlerExport) {
        console.error(`MISSING AUTH: ${relative} does not export any HTTP handlers`);
        failed = true;
        return;
    }

    console.log(`OK: ${relative}`);
}

if (routeFiles.length === 0) {
    console.log('No admin API route files found — skipping check.');
    process.exit(0);
}

for (const file of routeFiles) {
    checkRouteFile(file);
}

process.exit(failed ? 1 : 0);
