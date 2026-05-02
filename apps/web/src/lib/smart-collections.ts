/**
 * US-P42 (Phase 4.2): Smart collections — AST type definitions and safe
 * parameterized SQL compiler.
 *
 * Design constraints:
 * - Pure function: no I/O, no side effects — fully Vitestable in isolation.
 * - Allowlisted columns only: unknown column names throw a typed error.
 * - Depth-limited: max 4 nested AND/OR groups; deeper trees throw.
 * - Drizzle parameter binding for all values — no raw string concatenation.
 * - Discriminated-union AST supports eq, gt, gte, lt, lte, between, in,
 *   contains predicates over iso, focal_length, f_number, exposure_time,
 *   camera_model, lens_model, capture_date, topic, tag.
 */

import { sql, type SQL, and as drizzleAnd, or as drizzleOr, eq, gt, gte, lt, lte, like, inArray } from 'drizzle-orm';
import { images, tags, imageTags } from '@/db';

// ── Column allowlist ─────────────────────────────────────────────────────────

export type AllowedColumn =
    | 'iso'
    | 'focal_length'
    | 'f_number'
    | 'exposure_time'
    | 'camera_model'
    | 'lens_model'
    | 'capture_date'
    | 'topic'
    | 'tag';

/** Maps AST column names to their Drizzle column references. */
const ALLOWED_COLUMNS = {
    iso: images.iso,
    focal_length: images.focal_length,
    f_number: images.f_number,
    exposure_time: images.exposure_time,
    camera_model: images.camera_model,
    lens_model: images.lens_model,
    capture_date: images.capture_date,
    topic: images.topic,
} as const satisfies Partial<Record<AllowedColumn, unknown>>;

// tag is handled separately via a subquery (not a direct column comparison)
type DirectColumn = keyof typeof ALLOWED_COLUMNS;

function isAllowedDirectColumn(col: string): col is DirectColumn {
    return Object.prototype.hasOwnProperty.call(ALLOWED_COLUMNS, col);
}

// ── AST node types ───────────────────────────────────────────────────────────

export type ScalarOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
export type StringOperator = 'contains';
export type BetweenOperator = 'between';
export type InOperator = 'in';

/** Predicate over a numeric/string column with a scalar operator. */
export type ScalarPredicate = {
    type: 'predicate';
    column: Exclude<AllowedColumn, 'tag'>;
    operator: ScalarOperator;
    value: string | number;
};

/** LIKE-style contains predicate (maps to SQL LIKE %value%). */
export type ContainsPredicate = {
    type: 'predicate';
    column: Exclude<AllowedColumn, 'tag'>;
    operator: StringOperator;
    value: string;
};

/** Range predicate: column BETWEEN lo AND hi. */
export type BetweenPredicate = {
    type: 'predicate';
    column: Exclude<AllowedColumn, 'tag'>;
    operator: BetweenOperator;
    lo: string | number;
    hi: string | number;
};

/** Set-membership predicate: column IN (...values). */
export type InPredicate = {
    type: 'predicate';
    column: Exclude<AllowedColumn, 'tag'>;
    operator: InOperator;
    values: (string | number)[];
};

/** Tag-name match predicate: image has a tag with this exact name. */
export type TagPredicate = {
    type: 'predicate';
    column: 'tag';
    operator: 'eq' | 'contains';
    value: string;
};

export type Predicate =
    | ScalarPredicate
    | ContainsPredicate
    | BetweenPredicate
    | InPredicate
    | TagPredicate;

export type AndGroup = {
    type: 'and';
    children: SmartCollectionQuery[];
};

export type OrGroup = {
    type: 'or';
    children: SmartCollectionQuery[];
};

/** Top-level discriminated-union AST node. */
export type SmartCollectionQuery = Predicate | AndGroup | OrGroup;

// ── Validation ────────────────────────────────────────────────────────────────

export class SmartCollectionColumnError extends Error {
    constructor(column: string) {
        super(`SmartCollection: column "${column}" is not in the allowlist`);
        this.name = 'SmartCollectionColumnError';
    }
}

export class SmartCollectionDepthError extends Error {
    constructor(depth: number) {
        super(`SmartCollection: AST depth ${depth} exceeds maximum of ${MAX_DEPTH}`);
        this.name = 'SmartCollectionDepthError';
    }
}

export class SmartCollectionQueryError extends Error {
    constructor(message: string) {
        super(`SmartCollection: ${message}`);
        this.name = 'SmartCollectionQueryError';
    }
}

const MAX_DEPTH = 4;
/** Maximum number of values in an IN predicate. */
const MAX_IN_VALUES = 100;

// ── Compiler ─────────────────────────────────────────────────────────────────

/**
 * Compile a SmartCollectionQuery AST into a Drizzle SQL condition that can be
 * passed directly to `.where()`. All values flow through Drizzle's parameter
 * binding — no raw string concatenation.
 *
 * @throws SmartCollectionColumnError if an unknown column is referenced.
 * @throws SmartCollectionDepthError if AND/OR nesting exceeds MAX_DEPTH.
 * @throws SmartCollectionQueryError for other structural errors.
 */
export function compileSmartCollection(
    ast: SmartCollectionQuery,
    depth = 0,
): SQL {
    if (depth > MAX_DEPTH) {
        throw new SmartCollectionDepthError(depth);
    }

    if (ast.type === 'and') {
        if (!Array.isArray(ast.children) || ast.children.length === 0) {
            throw new SmartCollectionQueryError('AND group must have at least one child');
        }
        const clauses = ast.children.map((child) => compileSmartCollection(child, depth + 1));
        return drizzleAnd(...clauses) as SQL;
    }

    if (ast.type === 'or') {
        if (!Array.isArray(ast.children) || ast.children.length === 0) {
            throw new SmartCollectionQueryError('OR group must have at least one child');
        }
        const clauses = ast.children.map((child) => compileSmartCollection(child, depth + 1));
        return drizzleOr(...clauses) as SQL;
    }

    if (ast.type === 'predicate') {
        return compilePredicate(ast);
    }

    // Exhaustive check — any unrecognised type is a structural error.
    throw new SmartCollectionQueryError(`Unknown AST node type: ${(ast as { type: string }).type}`);
}

function compilePredicate(pred: Predicate): SQL {
    // Tag column: compile to a subquery instead of a direct column reference.
    if (pred.column === 'tag') {
        return compileTagPredicate(pred as TagPredicate);
    }

    // Enforce column allowlist for all non-tag predicates.
    if (!isAllowedDirectColumn(pred.column)) {
        throw new SmartCollectionColumnError(pred.column);
    }

    const col = ALLOWED_COLUMNS[pred.column];

    switch (pred.operator) {
        case 'eq':
            return eq(col, pred.value) as SQL;

        case 'gt':
            return gt(col, pred.value) as SQL;

        case 'gte':
            return gte(col, pred.value) as SQL;

        case 'lt':
            return lt(col, pred.value) as SQL;

        case 'lte':
            return lte(col, pred.value) as SQL;

        case 'contains': {
            const escaped = String((pred as ContainsPredicate).value)
                .replace(/[%_\\]/g, '\\$&');
            return like(col, `%${escaped}%`) as SQL;
        }

        case 'between': {
            const p = pred as BetweenPredicate;
            return sql`${col} BETWEEN ${p.lo} AND ${p.hi}`;
        }

        case 'in': {
            const p = pred as InPredicate;
            if (!Array.isArray(p.values) || p.values.length === 0) {
                throw new SmartCollectionQueryError('IN predicate must have at least one value');
            }
            if (p.values.length > MAX_IN_VALUES) {
                throw new SmartCollectionQueryError(`IN predicate may have at most ${MAX_IN_VALUES} values`);
            }
            return inArray(col, p.values) as SQL;
        }

        default:
            throw new SmartCollectionQueryError(
                `Unknown operator "${(pred as { operator: string }).operator}" for column "${pred.column}"`,
            );
    }
}

function compileTagPredicate(pred: TagPredicate): SQL {
    if (pred.operator === 'eq') {
        // EXISTS (SELECT 1 FROM image_tags JOIN tags WHERE images.id = image_tags.image_id AND tags.name = ?)
        return sql`${images.id} IN (
            SELECT ${imageTags.imageId}
            FROM ${imageTags}
            INNER JOIN ${tags} ON ${imageTags.tagId} = ${tags.id}
            WHERE ${tags.name} = ${pred.value}
        )`;
    }

    if (pred.operator === 'contains') {
        const escaped = String(pred.value).replace(/[%_\\]/g, '\\$&');
        return sql`${images.id} IN (
            SELECT ${imageTags.imageId}
            FROM ${imageTags}
            INNER JOIN ${tags} ON ${imageTags.tagId} = ${tags.id}
            WHERE ${tags.name} LIKE ${`%${escaped}%`}
        )`;
    }

    throw new SmartCollectionQueryError(
        `Tag predicate only supports "eq" and "contains" operators, got "${pred.operator}"`,
    );
}

// ── JSON parse/validate ───────────────────────────────────────────────────────

const VALID_OPERATORS = new Set([
    'eq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'contains',
]);

const VALID_COLUMNS = new Set<AllowedColumn>([
    'iso', 'focal_length', 'f_number', 'exposure_time',
    'camera_model', 'lens_model', 'capture_date', 'topic', 'tag',
]);

/**
 * Parse and structurally validate a JSON string into a SmartCollectionQuery.
 * Does NOT compile to SQL — call compileSmartCollection() for that.
 *
 * @throws SmartCollectionQueryError on parse or structural errors.
 */
export function parseSmartCollectionQuery(json: string): SmartCollectionQuery {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        throw new SmartCollectionQueryError('query_json is not valid JSON');
    }
    return validateNode(raw, 0);
}

function validateNode(node: unknown, depth: number): SmartCollectionQuery {
    if (depth > MAX_DEPTH) {
        throw new SmartCollectionDepthError(depth);
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
        throw new SmartCollectionQueryError('AST node must be a plain object');
    }
    const n = node as Record<string, unknown>;

    if (n.type === 'and' || n.type === 'or') {
        if (!Array.isArray(n.children) || n.children.length === 0) {
            throw new SmartCollectionQueryError(`${n.type} group must have at least one child`);
        }
        const children = n.children.map((c: unknown) => validateNode(c, depth + 1));
        return { type: n.type, children } as AndGroup | OrGroup;
    }

    if (n.type === 'predicate') {
        if (typeof n.column !== 'string' || !VALID_COLUMNS.has(n.column as AllowedColumn)) {
            throw new SmartCollectionColumnError(String(n.column));
        }
        if (typeof n.operator !== 'string' || !VALID_OPERATORS.has(n.operator)) {
            throw new SmartCollectionQueryError(`Unknown operator "${n.operator}"`);
        }
        // Structural checks per operator
        if (n.operator === 'between') {
            if (n.lo === undefined || n.hi === undefined) {
                throw new SmartCollectionQueryError('between predicate requires lo and hi');
            }
        } else if (n.operator === 'in') {
            if (!Array.isArray(n.values) || n.values.length === 0) {
                throw new SmartCollectionQueryError('in predicate requires a non-empty values array');
            }
            if (n.values.length > MAX_IN_VALUES) {
                throw new SmartCollectionQueryError(`in predicate may have at most ${MAX_IN_VALUES} values`);
            }
        } else {
            if (n.value === undefined) {
                throw new SmartCollectionQueryError(`${n.operator} predicate requires a value`);
            }
        }
        return n as unknown as Predicate;
    }

    throw new SmartCollectionQueryError(`Unknown AST node type: ${String(n.type)}`);
}

// ── DB helpers (with I/O — not pure, kept separate from compiler) ─────────────

export type SmartCollectionRow = {
    id: number;
    slug: string;
    name: string;
    query_json: string;
    is_public: boolean;
    created_at: Date;
};
