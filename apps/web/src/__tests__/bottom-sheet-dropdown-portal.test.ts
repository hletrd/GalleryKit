import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bottomSheetSource = readFileSync(
    resolve(__dirname, '../components/info-bottom-sheet.tsx'),
    'utf8',
);
const dropdownMenuSource = readFileSync(
    resolve(__dirname, '../components/ui/dropdown-menu.tsx'),
    'utf8',
);

describe('mobile bottom-sheet dropdown portal containment', () => {
    it('lets DropdownMenuContent render inside a supplied modal container', () => {
        expect(dropdownMenuSource).toContain('container?: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>["container"]');
        expect(dropdownMenuSource).toContain('<DropdownMenuPrimitive.Portal container={container}>');
    });

    it('keeps the mobile download menu inside the bottom-sheet focus trap subtree', () => {
        expect(bottomSheetSource).toContain('const sheetRef = useRef<HTMLDivElement>(null)');
        expect(bottomSheetSource).toContain('const [sheetElement, setSheetElement] = useState<HTMLDivElement | null>(null)');
        expect(bottomSheetSource).toContain('const setSheetNode = useCallback((node: HTMLDivElement | null) => {');
        expect(bottomSheetSource).toContain('ref={setSheetNode}');
        expect(bottomSheetSource).toContain('container={sheetElement ?? undefined}');
    });
});
