import { describe, it, expect } from 'vitest';
import { normalizeEditorDisplay } from './useEditorDisplay';
import { DEFAULT_EDITOR_DISPLAY } from '@/types/config';

describe('normalizeEditorDisplay', () => {
  it('undefined 回填全部默认值(旧版 config.json 无 editor.display)', () => {
    expect(normalizeEditorDisplay(undefined)).toEqual(DEFAULT_EDITOR_DISPLAY);
  });

  it('部分字段缺失时逐字段回填,已写字段保留', () => {
    const normalized = normalizeEditorDisplay({ minimap: false, fontSize: 18 });
    expect(normalized.minimap).toBe(false);
    expect(normalized.fontSize).toBe(18);
    expect(normalized.bracketPairColorization).toBe(true);
    expect(normalized.stickyScroll).toBe(true);
    expect(normalized.indentationGuides).toBe(true);
    expect(normalized.wordWrap).toBe(true);
    expect(normalized.tabSize).toBe(2);
  });

  it('全量字段透传不改写', () => {
    const raw = {
      bracketPairColorization: false,
      stickyScroll: false,
      indentationGuides: false,
      wordWrap: false,
      minimap: false,
      fontSize: 20,
      tabSize: 8,
    };
    expect(normalizeEditorDisplay(raw)).toEqual(raw);
  });
});
