/**
 * R18C18 A1 (architect, structural) — topic-slug rename fan-out registry guard.
 *
 * `topics.slug` is a mutable natural key used as the PRIMARY KEY. It is referenced
 * by FK children (`topic_aliases.topic_slug`, `images.topic`, `topic_views.topic`)
 * — NONE with `ON UPDATE CASCADE` — plus the non-FK `smart_collections.query_json`
 * JSON store. `updateTopic` renames a slug by re-pointing every child BY HAND
 * inside one transaction, then delete+insert the topics row. A child that is NOT
 * re-pointed is silently orphaned or CASCADE-wiped on the delete — this is exactly
 * the recurring "fix one sibling, miss the next" root that already caused real
 * `topic_views` data loss (DBG-16-01, cycle-16).
 *
 * The rename test (`topics-actions.test.ts`) only hand-mocks the CURRENT child
 * list, so a NEW FK child added to schema.ts without a matching re-point would
 * still pass every test. This fixture closes that blind spot: it derives the FK
 * child set directly from schema.ts and asserts it equals the set updateTopic
 * actually re-points. A new FK child fails the set-equality assertion, forcing
 * the developer to add the re-point (and update this registry) deliberately.
 *
 * NOTE: the structural fix (FK `onUpdate:'cascade'` + in-place UPDATE, or a
 * surrogate auto-increment PK) is a deliberate schema migration, DEFERRED in the
 * cycle-18 plan. This test is the tactical net until that lands.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHEMA = readFileSync(resolve(__dirname, '../db/schema.ts'), 'utf8');
const TOPICS_ACTION = readFileSync(resolve(__dirname, '../app/actions/topics.ts'), 'utf8');

// The KNOWN FK children of topics.slug. Keep this in lockstep with schema.ts AND
// with the updateTopic re-point logic — the assertions below fail if either drifts.
const KNOWN_SLUG_FK_TABLES = ['images', 'topic_aliases', 'topic_views'];

/** Tables whose schema.ts block contains a `references(() => topics.slug` FK. */
function tablesReferencingTopicsSlug(schema: string): string[] {
    const re = /mysqlTable\(\s*"([a-z0-9_]+)"/g;
    const starts: Array<{ name: string; idx: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(schema)) !== null) {
        starts.push({ name: m[1], idx: m.index });
    }
    const found: string[] = [];
    for (let i = 0; i < starts.length; i++) {
        const start = starts[i].idx;
        const end = i + 1 < starts.length ? starts[i + 1].idx : schema.length;
        const block = schema.slice(start, end);
        if (/references\(\s*\(\)\s*=>\s*topics\.slug\b/.test(block)) {
            found.push(starts[i].name);
        }
    }
    return found.sort();
}

describe('topics.slug FK rename fan-out registry (R18C18 A1)', () => {
    it('every schema FK child of topics.slug is in the known re-point set (no new silent sibling)', () => {
        const referencing = tablesReferencingTopicsSlug(SCHEMA);
        expect(referencing).toEqual([...KNOWN_SLUG_FK_TABLES].sort());
    });

    it('updateTopic re-points every known FK child', () => {
        expect(TOPICS_ACTION).toMatch(/tx\.update\(images\)\s*\.set\(\{\s*topic:/);
        expect(TOPICS_ACTION).toMatch(/tx\.update\(topicAliases\)\s*\.set\(\{\s*topicSlug:/);
        expect(TOPICS_ACTION).toMatch(/tx\.update\(topicViews\)\s*\.set\(\{\s*topic:/);
    });

    it('updateTopic also remaps the smart_collections JSON store (non-FK slug referrer)', () => {
        expect(TOPICS_ACTION).toMatch(/tx\.update\(smartCollections\)/);
        expect(TOPICS_ACTION).toContain('remapTopicSlugInQuery');
    });

    it('the rename delete happens AFTER all re-points (no orphaned/cascade-wiped rows)', () => {
        const lastRepoint = Math.max(
            TOPICS_ACTION.indexOf('tx.update(images)'),
            TOPICS_ACTION.indexOf('tx.update(topicAliases)'),
            TOPICS_ACTION.indexOf('tx.update(topicViews)'),
            TOPICS_ACTION.indexOf('tx.update(smartCollections)'),
        );
        const deleteIdx = TOPICS_ACTION.indexOf('tx.delete(topics)');
        expect(lastRepoint).toBeGreaterThan(0);
        expect(deleteIdx).toBeGreaterThan(lastRepoint);
    });
});
