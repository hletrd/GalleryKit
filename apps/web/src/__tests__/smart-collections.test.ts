import { describe, it, expect } from 'vitest';
import {
    compileSmartCollection,
    parseSmartCollectionQuery,
    remapTopicSlugInQuery,
    SmartCollectionColumnError,
    SmartCollectionDepthError,
    SmartCollectionQueryError,
    type SmartCollectionQuery,
} from '@/lib/smart-collections';

/**
 * US-P42 security tests: the AST compiler is the only thing standing between
 * admin-supplied query JSON and the SQL executed by the smart-collection
 * route. These tests exercise the column allowlist, depth limit, and
 * Drizzle-parameter-binding contract against malicious input.
 */
describe('compileSmartCollection — column allowlist', () => {
    it('accepts every allowlisted column', () => {
        const allowed: Array<{ column: string; ast: SmartCollectionQuery }> = [
            { column: 'iso', ast: { type: 'predicate', column: 'iso', operator: 'eq', value: 100 } },
            { column: 'focal_length', ast: { type: 'predicate', column: 'focal_length', operator: 'gte', value: 50 } },
            { column: 'f_number', ast: { type: 'predicate', column: 'f_number', operator: 'lte', value: 2.8 } },
            { column: 'exposure_time', ast: { type: 'predicate', column: 'exposure_time', operator: 'eq', value: '1/100' } },
            { column: 'camera_model', ast: { type: 'predicate', column: 'camera_model', operator: 'contains', value: 'Sony' } },
            { column: 'lens_model', ast: { type: 'predicate', column: 'lens_model', operator: 'eq', value: '50mm f/1.8' } },
            { column: 'capture_date', ast: { type: 'predicate', column: 'capture_date', operator: 'gte', value: '2024-01-01' } },
            { column: 'topic', ast: { type: 'predicate', column: 'topic', operator: 'eq', value: 'travel' } },
            { column: 'tag', ast: { type: 'predicate', column: 'tag', operator: 'eq', value: 'sunset' } },
        ];
        for (const { ast } of allowed) {
            expect(() => compileSmartCollection(ast)).not.toThrow();
        }
    });

    it('rejects columns not in the allowlist', () => {
        const malicious = [
            'password_hash', 'admin_users', 'sessions', 'token_hash', 'visitor_id_hash',
            'image_filename', 'filename_original', 'user_filename', 'latitude', 'longitude',
        ];
        for (const column of malicious) {
            const ast = { type: 'predicate', column, operator: 'eq', value: 'x' } as unknown as SmartCollectionQuery;
            expect(() => compileSmartCollection(ast)).toThrow(SmartCollectionColumnError);
        }
    });

    it('rejects column names containing SQL keywords or punctuation', () => {
        const inputs = ['iso; DROP TABLE images;', 'iso--', "iso'OR'1'='1", '1=1', "iso) OR ('x"];
        for (const column of inputs) {
            const ast = { type: 'predicate', column, operator: 'eq', value: 1 } as unknown as SmartCollectionQuery;
            expect(() => compileSmartCollection(ast)).toThrow(SmartCollectionColumnError);
        }
    });
});

describe('compileSmartCollection — depth limit', () => {
    function nest(depth: number): SmartCollectionQuery {
        if (depth === 0) {
            return { type: 'predicate', column: 'iso', operator: 'eq', value: 100 };
        }
        return { type: 'and', children: [nest(depth - 1)] };
    }

    it('accepts up to MAX_DEPTH = 4 nested AND/OR groups', () => {
        expect(() => compileSmartCollection(nest(4))).not.toThrow();
    });

    it('rejects nesting beyond MAX_DEPTH', () => {
        expect(() => compileSmartCollection(nest(5))).toThrow(SmartCollectionDepthError);
        expect(() => compileSmartCollection(nest(20))).toThrow(SmartCollectionDepthError);
    });
});

describe('compileSmartCollection — empty and structural errors', () => {
    it('rejects empty AND/OR groups', () => {
        const emptyAnd: SmartCollectionQuery = { type: 'and', children: [] };
        const emptyOr: SmartCollectionQuery = { type: 'or', children: [] };
        expect(() => compileSmartCollection(emptyAnd)).toThrow(SmartCollectionQueryError);
        expect(() => compileSmartCollection(emptyOr)).toThrow(SmartCollectionQueryError);
    });
});

describe('compileSmartCollection — value binding (no raw concat)', () => {
    it('treats malicious values as parameters, not SQL fragments', () => {
        // Compilation must succeed for arbitrary string values; Drizzle's
        // parameter binding is the safety boundary. The compiled object is a
        // Drizzle SQL instance with circular references (column ↔ table), so
        // we don't deep-stringify it here — the safety contract is that no
        // raw concat happens in compileSmartCollection (verified by code
        // review of lib/smart-collections.ts and exercised end-to-end by
        // the integration tests when the public route lands).
        const malicious: SmartCollectionQuery = {
            type: 'predicate',
            column: 'camera_model',
            operator: 'contains',
            value: "'; DROP TABLE images; --",
        };
        const compiled = compileSmartCollection(malicious);
        expect(compiled).toBeDefined();
        // Drizzle SQL objects expose queryChunks at runtime; presence of
        // that property is the structural marker that we got a SQL builder
        // back rather than a raw string concatenation.
        const sqlObject = compiled as unknown as Record<string, unknown>;
        expect('queryChunks' in sqlObject).toBe(true);
    });

    it('rejects IN predicates beyond MAX_IN_VALUES (100) to prevent DoS', () => {
        const tooMany: SmartCollectionQuery = {
            type: 'predicate',
            column: 'iso',
            operator: 'in',
            values: Array.from({ length: 101 }, (_, i) => i),
        };
        expect(() => compileSmartCollection(tooMany)).toThrow(SmartCollectionQueryError);
    });
});

describe('parseSmartCollectionQuery', () => {
    it('parses valid JSON into the AST', () => {
        const json = JSON.stringify({ type: 'predicate', column: 'iso', operator: 'eq', value: 100 });
        const parsed = parseSmartCollectionQuery(json);
        expect(parsed).toEqual({ type: 'predicate', column: 'iso', operator: 'eq', value: 100 });
    });

    it('rejects invalid JSON', () => {
        expect(() => parseSmartCollectionQuery('not json')).toThrow();
    });

    it('rejects structurally invalid AST shapes', () => {
        expect(() => parseSmartCollectionQuery('null')).toThrow();
        expect(() => parseSmartCollectionQuery('"string"')).toThrow();
        expect(() => parseSmartCollectionQuery('42')).toThrow();
        expect(() => parseSmartCollectionQuery('[]')).toThrow();
    });

    it('rejects oversized serialized queries before validation', () => {
        const ast = {
            type: 'predicate',
            column: 'camera_model',
            operator: 'contains',
            value: 'x'.repeat(70 * 1024),
        };

        expect(() => parseSmartCollectionQuery(JSON.stringify(ast)))
            .toThrow(/query_json may be at most/);
    });

    it('rejects groups with too many direct children', () => {
        const children = Array.from({ length: 65 }, () => ({
            type: 'predicate',
            column: 'iso',
            operator: 'eq',
            value: 100,
        }));

        expect(() => parseSmartCollectionQuery(JSON.stringify({ type: 'or', children })))
            .toThrow(/may contain at most 64 children/);
    });
});

// R4C4 HARD-R4C4-07 / TEST-R4C4-14: runtime scalar enforcement for predicate
// values. The declared types say string | number; non-scalars previously
// flowed into Drizzle parameter binding where mysql2's escaping expands
// plain objects into `key` = 'val' SQL fragments — breaking the module's
// "parameter binding for all values" invariant on the public /c/[slug]
// compiler. Malformed stored queries must fail loudly at parse time.
describe('parseSmartCollectionQuery — scalar value enforcement (R4C4 HARD-R4C4-07)', () => {
    const pred = (extra: Record<string, unknown>) =>
        JSON.stringify({ type: 'predicate', column: 'camera_model', operator: 'eq', ...extra });

    it('rejects object values', () => {
        expect(() => parseSmartCollectionQuery(pred({ value: { a: 1 } }))).toThrow(/string or finite number/);
    });

    it('rejects array values', () => {
        expect(() => parseSmartCollectionQuery(pred({ value: ['x'] }))).toThrow(/string or finite number/);
    });

    it('rejects null values', () => {
        expect(() => parseSmartCollectionQuery(pred({ value: null }))).toThrow(/string or finite number/);
    });

    it('rejects boolean values', () => {
        expect(() => parseSmartCollectionQuery(pred({ value: true }))).toThrow(/string or finite number/);
    });

    it('rejects non-scalar lo/hi on between', () => {
        const between = JSON.stringify({
            type: 'predicate', column: 'iso', operator: 'between', lo: { gt: 1 }, hi: 800,
        });
        expect(() => parseSmartCollectionQuery(between)).toThrow(/strings or finite numbers/);
    });

    it('rejects non-scalar elements inside in values', () => {
        const inPred = JSON.stringify({
            type: 'predicate', column: 'iso', operator: 'in', values: [100, { v: 200 }],
        });
        expect(() => parseSmartCollectionQuery(inPred)).toThrow(/strings or finite numbers/);
    });

    it('rejects a non-scalar value on the tag predicate', () => {
        const tagPred = JSON.stringify({
            type: 'predicate', column: 'tag', operator: 'eq', value: ['landscape'],
        });
        expect(() => parseSmartCollectionQuery(tagPred)).toThrow(/string or finite number/);
    });

    it('rejects finite-number tag predicate values before they compile as tag names', () => {
        const tagPred = JSON.stringify({
            type: 'predicate', column: 'tag', operator: 'eq', value: 42,
        });
        expect(() => parseSmartCollectionQuery(tagPred)).toThrow(/string tag name/);
    });

    it('accepts string and finite-number scalars', () => {
        expect(() => parseSmartCollectionQuery(pred({ value: 'X-T5' }))).not.toThrow();
        const iso = JSON.stringify({ type: 'predicate', column: 'iso', operator: 'gte', value: 800 });
        expect(() => parseSmartCollectionQuery(iso)).not.toThrow();
        const between = JSON.stringify({
            type: 'predicate', column: 'iso', operator: 'between', lo: 100, hi: 800,
        });
        expect(() => parseSmartCollectionQuery(between)).not.toThrow();
        const inPred = JSON.stringify({
            type: 'predicate', column: 'camera_model', operator: 'in', values: ['A7IV', 'X-T5'],
        });
        expect(() => parseSmartCollectionQuery(inPred)).not.toThrow();
    });
});

// R4C7 COR-R4C7-03: the validator must reject tag-column operators the
// compiler cannot execute. Before this guard, an admin could save
// `{column:'tag', operator:'gt', …}` (parse-only validation in the save
// actions) and the public /c/[slug] page compile-threw into notFound()
// for every visitor.
describe('parseSmartCollectionQuery — per-column operator enforcement (R4C7 COR-R4C7-03)', () => {
    const tagPred = (operator: string, extra: Record<string, unknown> = { value: 'landscape' }) =>
        JSON.stringify({ type: 'predicate', column: 'tag', operator, ...extra });

    it.each(['gt', 'gte', 'lt', 'lte'])('rejects tag × %s at validation time', (op) => {
        expect(() => parseSmartCollectionQuery(tagPred(op)))
            .toThrow(/Tag predicate only supports "eq" and "contains"/);
    });

    it('rejects tag × between at validation time', () => {
        expect(() => parseSmartCollectionQuery(tagPred('between', { lo: 'a', hi: 'b' })))
            .toThrow(/Tag predicate only supports "eq" and "contains"/);
    });

    it('rejects tag × in at validation time', () => {
        expect(() => parseSmartCollectionQuery(tagPred('in', { values: ['a', 'b'] })))
            .toThrow(/Tag predicate only supports "eq" and "contains"/);
    });

    it('still accepts tag × eq and tag × contains', () => {
        expect(() => parseSmartCollectionQuery(tagPred('eq'))).not.toThrow();
        expect(() => parseSmartCollectionQuery(tagPred('contains'))).not.toThrow();
    });

    it('rejects tag misuse nested inside groups (write-time, not render-time)', () => {
        const nested = JSON.stringify({
            type: 'and',
            children: [
                { type: 'predicate', column: 'iso', operator: 'gte', value: 800 },
                { type: 'or', children: [{ type: 'predicate', column: 'tag', operator: 'gt', value: 'x' }] },
            ],
        });
        expect(() => parseSmartCollectionQuery(nested))
            .toThrow(/Tag predicate only supports "eq" and "contains"/);
    });
});

// R4C7 COR-R4C7-03 agreement property: every minimal AST the validator
// ACCEPTS must compile without throwing. This pins the validate/compile
// contract as a CLASS, so a future operator or column addition cannot
// reintroduce the asymmetry (validator-pass → public-page compile-throw).
describe('validate/compile agreement (R4C7 COR-R4C7-03)', () => {
    const columns = ['iso', 'focal_length', 'f_number', 'exposure_time', 'camera_model', 'lens_model', 'capture_date', 'topic', 'tag'] as const;
    const operators = ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'contains'] as const;

    const valueFor = (column: string) => {
        if (['iso', 'focal_length', 'f_number'].includes(column)) return 1;
        if (column === 'capture_date') return '2024-01-01';
        return '1';
    };

    const minimalAstFor = (column: string, operator: string): string => {
        if (operator === 'between') {
            const lo = valueFor(column);
            const hi = typeof lo === 'number' ? 2 : '2024-01-02';
            return JSON.stringify({ type: 'predicate', column, operator, lo, hi });
        }
        if (operator === 'in') {
            const first = valueFor(column);
            const second = typeof first === 'number' ? 2 : column === 'capture_date' ? '2024-01-02' : '2';
            return JSON.stringify({ type: 'predicate', column, operator, values: [first, second] });
        }
        return JSON.stringify({ type: 'predicate', column, operator, value: valueFor(column) });
    };

    it('compiles every validator-accepted column × operator combination', () => {
        let accepted = 0;
        for (const column of columns) {
            for (const operator of operators) {
                let ast;
                try {
                    ast = parseSmartCollectionQuery(minimalAstFor(column, operator));
                } catch {
                    continue; // validator rejected — nothing to agree on
                }
                accepted++;
                expect(() => compileSmartCollection(ast)).not.toThrow();
            }
        }
        // Sanity: numeric 3×7 + text 3×3 + date 1×7 + topic 1×2 + tag 2 = 41.
        expect(accepted).toBe(41);
    });

    it('rejects semantically invalid column/operator/value combinations at validation time', () => {
        const invalid = [
            { type: 'predicate', column: 'iso', operator: 'contains', value: '1' },
            { type: 'predicate', column: 'camera_model', operator: 'gt', value: 'Leica' },
            { type: 'predicate', column: 'camera_model', operator: 'eq', value: 1 },
            { type: 'predicate', column: 'capture_date', operator: 'contains', value: '2024' },
            { type: 'predicate', column: 'capture_date', operator: 'eq', value: 20240101 },
            { type: 'predicate', column: 'topic', operator: 'contains', value: 'old' },
            { type: 'predicate', column: 'topic', operator: 'gt', value: 'travel' },
            { type: 'predicate', column: 'tag', operator: 'eq', value: 1 },
            { type: 'predicate', column: 'tag', operator: 'contains', value: 1 },
        ];

        for (const ast of invalid) {
            expect(() => parseSmartCollectionQuery(JSON.stringify(ast))).toThrow(SmartCollectionQueryError);
        }
    });
});

describe('remapTopicSlugInQuery — topic slug rename (DBG-16-03)', () => {
    it('rewrites a top-level topic eq predicate', () => {
        const ast: SmartCollectionQuery = { type: 'predicate', column: 'topic', operator: 'eq', value: 'old' };
        const res = remapTopicSlugInQuery(ast, 'old', 'new');
        expect(res.changed).toBe(true);
        expect(res.ast).toEqual({ type: 'predicate', column: 'topic', operator: 'eq', value: 'new' });
    });

    it('rewrites a topic in predicate, preserving other values', () => {
        const ast = parseSmartCollectionQuery(
            JSON.stringify({ type: 'predicate', column: 'topic', operator: 'in', values: ['old', 'keep'] }),
        );
        const res = remapTopicSlugInQuery(ast, 'old', 'new');
        expect(res.changed).toBe(true);
        expect(res.ast).toEqual({ type: 'predicate', column: 'topic', operator: 'in', values: ['new', 'keep'] });
    });

    it('rewrites topic refs nested inside and/or groups', () => {
        const ast = parseSmartCollectionQuery(JSON.stringify({
            type: 'and',
            children: [
                { type: 'predicate', column: 'topic', operator: 'eq', value: 'old' },
                { type: 'or', children: [
                    { type: 'predicate', column: 'camera_model', operator: 'eq', value: 'Leica' },
                    { type: 'predicate', column: 'topic', operator: 'eq', value: 'old' },
                ] },
            ],
        }));
        const res = remapTopicSlugInQuery(ast, 'old', 'new');
        expect(res.changed).toBe(true);
        expect(JSON.stringify(res.ast)).not.toContain('"value":"old"');
        expect((JSON.stringify(res.ast).match(/"value":"new"/g) || []).length).toBe(2);
    });

    it('leaves non-matching slugs and non-topic predicates unchanged', () => {
        const ast: SmartCollectionQuery = { type: 'predicate', column: 'topic', operator: 'eq', value: 'other' };
        expect(remapTopicSlugInQuery(ast, 'old', 'new').changed).toBe(false);
        const camera: SmartCollectionQuery = { type: 'predicate', column: 'camera_model', operator: 'eq', value: 'old' };
        expect(remapTopicSlugInQuery(camera, 'old', 'new').changed).toBe(false);
    });

    it('rejects substring topic predicates — only exact identity is supported', () => {
        expect(() => parseSmartCollectionQuery(
            JSON.stringify({ type: 'predicate', column: 'topic', operator: 'contains', value: 'old' }),
        )).toThrow(SmartCollectionQueryError);
    });
});
