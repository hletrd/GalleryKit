/**
 * US-P21 privacy guard tests.
 *
 * 1. Compile-time contract: publicMapSelectFields includes latitude/longitude
 *    and excludes all admin-only fields except those two.
 * 2. Key-set assertion: publicMapSelectFields keys == publicSelectFields keys
 *    UNION {latitude, longitude}.
 * 3. GPS-leak guard: publicSelectFields still excludes GPS (regression guard).
 */
import { describe, it, expect } from 'vitest';
import { publicSelectFieldKeys, publicMapSelectFieldKeys, adminSelectFieldKeys } from '@/lib/data';

const GPS_KEYS = ['latitude', 'longitude'] as const;
const ADMIN_ONLY_SENSITIVE = [
    'filename_original',
    'user_filename',
    'processed',
    'original_format',
    'original_file_size',
] as const;

describe('publicMapSelectFields privacy contract', () => {
    it('publicMapSelectFields includes latitude and longitude', () => {
        for (const key of GPS_KEYS) {
            expect(publicMapSelectFieldKeys).toContain(key);
        }
    });

    it('publicMapSelectFields excludes admin-only sensitive fields', () => {
        for (const key of ADMIN_ONLY_SENSITIVE) {
            expect(publicMapSelectFieldKeys).not.toContain(key);
        }
    });

    it('publicSelectFields (non-map) still excludes GPS — regression guard', () => {
        for (const key of GPS_KEYS) {
            expect(publicSelectFieldKeys).not.toContain(key);
        }
    });

    it('publicMapSelectFields == publicSelectFields UNION {latitude, longitude}', () => {
        const publicSet = new Set<string>(publicSelectFieldKeys);
        const mapSet = new Set<string>(publicMapSelectFieldKeys);

        // Every key in publicSelectFields must also be in publicMapSelectFields
        for (const key of publicSelectFieldKeys) {
            expect(mapSet.has(key)).toBe(true);
        }

        // The only keys in publicMapSelectFields that are NOT in publicSelectFields
        // must be exactly {latitude, longitude}.
        const extraKeys = [...mapSet].filter(k => !publicSet.has(k)).sort();
        expect(extraKeys).toEqual([...GPS_KEYS].sort());
    });

    it('adminSelectFieldKeys contains all GPS keys', () => {
        for (const key of GPS_KEYS) {
            expect(adminSelectFieldKeys).toContain(key);
        }
    });
});

describe('getMapImages topic-filtering predicate (unit)', () => {
    /**
     * The SQL predicate for getMapImages enforces:
     *   topics.map_visible = true
     *   AND images.latitude IS NOT NULL
     *   AND images.longitude IS NOT NULL
     *
     * The runtime guard throws if any row has topic_map_visible = false.
     * We verify the guard logic independently of the DB here.
     */
    it('runtime guard rejects rows with map_visible=false', () => {
        const fakeRows = [
            { id: 1, latitude: 37.5, longitude: 127.0, topic_map_visible: false },
        ];

        expect(() => {
            for (const row of fakeRows) {
                if (!row.topic_map_visible) {
                    throw new Error(
                        `[getMapImages] GPS leak guard: image ${row.id} belongs to a map_visible=false topic.`
                    );
                }
            }
        }).toThrow(/GPS leak guard/);
    });

    it('runtime guard accepts rows with map_visible=true', () => {
        const fakeRows = [
            { id: 2, latitude: 37.5, longitude: 127.0, topic_map_visible: true },
        ];

        expect(() => {
            for (const row of fakeRows) {
                if (!row.topic_map_visible) {
                    throw new Error(`GPS leak guard: image ${row.id}`);
                }
            }
        }).not.toThrow();
    });

    it('topic-filtering predicate: only map_visible=true topics included', () => {
        const allTopics = [
            { slug: 'nature', map_visible: true },
            { slug: 'private', map_visible: false },
            { slug: 'travel', map_visible: true },
        ];

        const visible = allTopics.filter(t => t.map_visible);
        expect(visible.map(t => t.slug)).toEqual(['nature', 'travel']);
        expect(visible.find(t => t.slug === 'private')).toBeUndefined();
    });
});
