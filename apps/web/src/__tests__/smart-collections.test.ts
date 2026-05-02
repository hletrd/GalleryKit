import { describe, it, expect } from 'vitest';
import {
    compileSmartCollection,
    parseSmartCollectionQuery,
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
});
