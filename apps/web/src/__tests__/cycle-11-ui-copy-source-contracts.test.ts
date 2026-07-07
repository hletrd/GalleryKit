import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function src(relativePath: string): string {
    return readFileSync(resolve(__dirname, '..', relativePath), 'utf8');
}

describe('cycle 11 UI and copy source contracts', () => {
    it('keeps normal photo navigation shortcut metadata aligned with keyboard behavior', () => {
        const navigation = src('components/photo-navigation.tsx');

        expect(navigation).toContain('aria-keyshortcuts="ArrowLeft"');
        expect(navigation).toContain('aria-keyshortcuts="ArrowRight"');
    });

    it('keeps smart-collection category-delete guidance honest about the missing admin UI', () => {
        const en = readFileSync(resolve(__dirname, '../../messages/en.json'), 'utf8');
        const ko = readFileSync(resolve(__dirname, '../../messages/ko.json'), 'utf8');

        expect(en).toContain('Collections are not editable in the admin UI yet');
        expect(en).toContain('smart_collections query_json');
        expect(ko).toContain('아직 관리자 화면에서는 컬렉션을 수정할 수 없으니');
        expect(ko).toContain('smart_collections query_json');
    });
});
