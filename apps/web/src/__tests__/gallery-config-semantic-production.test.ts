import { describe, it, expect } from 'vitest';
import { isValidSettingValue } from '@/lib/gallery-config-shared';

describe('semantic_search_mode validator', () => {
  const v = (val: string) => isValidSettingValue('semantic_search_mode', val);
  it('accepts disabled, stub, AND production', () => {
    expect(v('disabled')).toBe(true);
    expect(v('stub')).toBe(true);
    expect(v('production')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(v('prod')).toBe(false);
    expect(v('')).toBe(false);
  });
});
