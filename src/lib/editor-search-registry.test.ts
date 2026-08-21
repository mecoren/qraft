/**
 * editor-search-registry 单元测试 —— tabId → 编辑器实例注册表的存取与注销。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerTabEditor,
  unregisterTabEditor,
  getTabEditor,
  clearTabEditors,
} from './editor-search-registry';
import type { editor } from 'monaco-editor';

function fakeEditor(): editor.IStandaloneCodeEditor {
  return { getModel: vi.fn() } as unknown as editor.IStandaloneCodeEditor;
}

beforeEach(() => {
  clearTabEditors();
});

describe('editor-search-registry', () => {
  it('注册后可获取对应实例', () => {
    const ed = fakeEditor();
    registerTabEditor('tab-1', ed);
    expect(getTabEditor('tab-1')).toBe(ed);
  });

  it('未注册的 tabId 返回 null', () => {
    expect(getTabEditor('missing')).toBeNull();
  });

  it('不同 tabId 各自注册互不影响', () => {
    const a = fakeEditor();
    const b = fakeEditor();
    registerTabEditor('a', a);
    registerTabEditor('b', b);
    expect(getTabEditor('a')).toBe(a);
    expect(getTabEditor('b')).toBe(b);
  });

  it('注销对应实例后不可再获取', () => {
    const ed = fakeEditor();
    registerTabEditor('tab-1', ed);
    unregisterTabEditor('tab-1', ed);
    expect(getTabEditor('tab-1')).toBeNull();
  });

  it('注销旧实例不影响新注册的同 tabId 实例', () => {
    const oldEd = fakeEditor();
    const newEd = fakeEditor();
    registerTabEditor('tab-1', oldEd);
    registerTabEditor('tab-1', newEd);
    unregisterTabEditor('tab-1', oldEd);
    expect(getTabEditor('tab-1')).toBe(newEd);
  });

  it('clearTabEditors 清空全部', () => {
    registerTabEditor('a', fakeEditor());
    registerTabEditor('b', fakeEditor());
    clearTabEditors();
    expect(getTabEditor('a')).toBeNull();
    expect(getTabEditor('b')).toBeNull();
  });
});
