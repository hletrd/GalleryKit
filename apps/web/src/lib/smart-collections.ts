/**
 * US-P42 (Phase 4.2): Smart collections — AST type definitions and safe
 * parameterized SQL compiler.
 *
 * Design constraints:
 * - Pure function: no I/O, no side effects — fully Vitestable in isolation.
 * - Allowlisted columns only: unknown column names throw a typed error.
 * - Depth-limited: max 4 nested AND/OR groups; deeper trees throw.
 * - Drizzle parameter binding for all values — no raw string concatenation.
 * - Discriminated-union AST supports column-appropriate predicates over iso,
 *   focal_length, f_number, exposure_time, camera_model, lens_model,
 *   capture_date, topic, tag.
 */

import { sql, type SQL, and as drizzleAnd, or as drizzleOr, eq, gt, gte, lt, lte, inArray } from 'drizzle-orm';
import { images, tags, imageTags } from '@/db';
import { containsLike } from '@/lib/sql-like';

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
            return containsLike(col, String((pred as ContainsPredicate).value));
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

        default: {
            const exhaustive = pred as { operator: string; column: string };
            throw new SmartCollectionQueryError(
                `Unknown operator "${exhaustive.operator}" for column "${exhaustive.column}"`,
            );
        }
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
        return sql`${images.id} IN (
            SELECT ${imageTags.imageId}
            FROM ${imageTags}
            INNER JOIN ${tags} ON ${imageTags.tagId} = ${tags.id}
            WHERE ${containsLike(tags.name, pred.value)}
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

/**
 * R4C7 COR-R4C7-03: per-column operator narrowing. `VALID_OPERATORS`
 * above is column-global, but `compileTagPredicate` only implements
 * `eq` / `contains` for the tag subquery and THROWS for everything
 * else. The save actions (`createSmartCollection` /
 * `updateSmartCollection`) validate with `parseSmartCollectionQuery`
 * only — without this narrowing an admin could "successfully" save
 * `{column:'tag', operator:'gt', …}` and every public visit to
 * `/c/[slug]` would then compile-throw into `notFound()` with zero
 * signal. Per the module's own write-time-failure doctrine
 * (R4C4 HARD-R4C4-07), malformed queries must fail loudly at
 * validation. `compileTagPredicate` keeps its throw as defense in
 * depth for rows persisted before this guard.
 */
const TAG_OPERATORS = new Set(['eq', 'contains']);
const NUMERIC_COLUMNS = new Set<AllowedColumn>(['iso', 'focal_length', 'f_number']);
const TEXT_COLUMNS = new Set<AllowedColumn>(['exposure_time', 'camera_model', 'lens_model']);
const DATE_COLUMNS = new Set<AllowedColumn>(['capture_date']);
const TOPIC_COLUMNS = new Set<AllowedColumn>(['topic']);
const NUMERIC_OPERATORS = new Set(['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'in']);
const TEXT_OPERATORS = new Set(['eq', 'contains', 'in']);
const DATE_OPERATORS = new Set(['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'in']);
const TOPIC_OPERATORS = new Set(['eq', 'in']);

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

/**
 * R4C4 HARD-R4C4-07: runtime enforcement of the declared scalar value types.
 * The Predicate types say `string | number`; without this check, a stored
 * query carrying `value: {…}` / `[..]` / `null` / `NaN` flowed into Drizzle
 * parameter binding, where mysql2's value escaping expands plain objects
 * into `` `key` = 'val' `` SQL fragments — violating the module's
 * "parameter binding for all values" invariant. Admin-only input, but the
 * compiled query executes on the PUBLIC /c/[slug] page, so malformed values
 * must fail loudly at validation (write time) instead.
 */
function isScalarValue(v: unknown): v is string | number {
    return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
}

function isDateStringValue(v: unknown): v is string {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(v);
}

function validatePredicateSemantics(column: AllowedColumn, operator: string, node: Record<string, unknown>) {
    if (column === 'tag') {
        if (!TAG_OPERATORS.has(operator)) {
            throw new SmartCollectionQueryError(
                `Tag predicate only supports "eq" and "contains" operators, got "${operator}"`,
            );
        }
        return;
    }

    if (NUMERIC_COLUMNS.has(column)) {
        if (!NUMERIC_OPERATORS.has(operator)) {
            throw new SmartCollectionQueryError(`Column "${column}" does not support "${operator}"`);
        }
        const values = operator === 'between'
            ? [node.lo, node.hi]
            : operator === 'in'
                ? node.values
                : [node.value];
        const flatValues = Array.isArray(values) ? values : [];
        if (!flatValues.every((v) => typeof v === 'number' && Number.isFinite(v))) {
            throw new SmartCollectionQueryError(`Column "${column}" requires finite number values`);
        }
        return;
    }

    if (TEXT_COLUMNS.has(column)) {
        if (!TEXT_OPERATORS.has(operator)) {
            throw new SmartCollectionQueryError(`Column "${column}" does not support "${operator}"`);
        }
        const values = operator === 'in' ? node.values : [node.value];
        const flatValues = Array.isArray(values) ? values : [];
        if (!flatValues.every((v) => typeof v === 'string')) {
            throw new SmartCollectionQueryError(`Column "${column}" requires string values`);
        }
        return;
    }

    if (DATE_COLUMNS.has(column)) {
        if (!DATE_OPERATORS.has(operator)) {
            throw new SmartCollectionQueryError(`Column "${column}" does not support "${operator}"`);
        }
        const values = operator === 'between'
            ? [node.lo, node.hi]
            : operator === 'in'
                ? node.values
                : [node.value];
        const flatValues = Array.isArray(values) ? values : [];
        if (!flatValues.every(isDateStringValue)) {
            throw new SmartCollectionQueryError(`Column "${column}" requires date string values`);
        }
        return;
    }

    if (TOPIC_COLUMNS.has(column)) {
        if (!TOPIC_OPERATORS.has(operator)) {
            throw new SmartCollectionQueryError(`Column "${column}" does not support "${operator}"`);
        }
        const values = operator === 'in' ? node.values : [node.value];
        const flatValues = Array.isArray(values) ? values : [];
        if (!flatValues.every((v) => typeof v === 'string')) {
            throw new SmartCollectionQueryError(`Column "${column}" requires string values`);
        }
    }
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
            // R4C4 HARD-R4C4-07: scalar enforcement.
            if (!isScalarValue(n.lo) || !isScalarValue(n.hi)) {
                throw new SmartCollectionQueryError('between predicate lo/hi must be strings or finite numbers');
            }
        } else if (n.operator === 'in') {
            if (!Array.isArray(n.values) || n.values.length === 0) {
                throw new SmartCollectionQueryError('in predicate requires a non-empty values array');
            }
            if (n.values.length > MAX_IN_VALUES) {
                throw new SmartCollectionQueryError(`in predicate may have at most ${MAX_IN_VALUES} values`);
            }
            // R4C4 HARD-R4C4-07: every element must be scalar.
            if (!n.values.every(isScalarValue)) {
                throw new SmartCollectionQueryError('in predicate values must be strings or finite numbers');
            }
        } else {
            if (n.value === undefined) {
                throw new SmartCollectionQueryError(`${n.operator} predicate requires a value`);
            }
            // R4C4 HARD-R4C4-07: scalar enforcement (covers eq/gt/gte/lt/lte/
            // contains and the tag-subquery predicate).
            if (!isScalarValue(n.value)) {
                throw new SmartCollectionQueryError(`${n.operator} predicate value must be a string or finite number`);
            }
        }
        validatePredicateSemantics(n.column as AllowedColumn, n.operator, n);
        return n as unknown as Predicate;
    }

    throw new SmartCollectionQueryError(`Unknown AST node type: ${String(n.type)}`);
}

/**
 * DBG-16-03 (R16C16): when a topic slug is renamed, smart-collection rules that
 * reference the OLD slug by exact identity (`topic eq <old>` or `topic in […]`)
 * would silently stop matching (images were re-pointed to the new slug), leaving
 * the collection empty. This pure helper rewrites those exact-identity topic
 * references from `oldSlug` → `newSlug`, returning the (possibly new) AST plus a
 * `changed` flag so callers update only the rows that actually moved.
 *
 * Deliberately conservative: only `eq` and `in` (exact-identity) topic
 * predicates are rewritten. `contains` (substring) / ordering operators
 * (`gt`/`lt`/…) are NOT touched — a substring or range filter is not an identity
 * reference and rewriting it could change the admin's intent. Non-topic
 * predicates are returned unchanged.
 */
export function remapTopicSlugInQuery(
    ast: SmartCollectionQuery,
    oldSlug: string,
    newSlug: string,
): { ast: SmartCollectionQuery; changed: boolean } {
    if (ast.type === 'and' || ast.type === 'or') {
        let changed = false;
        const children = ast.children.map((child) => {
            const res = remapTopicSlugInQuery(child, oldSlug, newSlug);
            if (res.changed) changed = true;
            return res.ast;
        });
        return changed ? { ast: { type: ast.type, children } as AndGroup | OrGroup, changed: true } : { ast, changed: false };
    }

    // Predicate node.
    if (ast.type === 'predicate' && ast.column === 'topic') {
        if (ast.operator === 'eq' && ast.value === oldSlug) {
            return { ast: { ...ast, value: newSlug }, changed: true };
        }
        if (ast.operator === 'in' && Array.isArray(ast.values) && ast.values.includes(oldSlug)) {
            return {
                ast: { ...ast, values: ast.values.map((v) => (v === oldSlug ? newSlug : v)) },
                changed: true,
            };
        }
    }
    return { ast, changed: false };
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
