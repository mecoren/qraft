import { describe, expect, it } from 'vitest';
import { applyInlineWrap, toggleLinePrefixes } from './markdown-edit';

describe('applyInlineWrap 行内包裹', () => {
  it('有选区:两侧加标记并保持原文选中', () => {
    const r = applyInlineWrap('文字', '**', '**', '加粗');
    expect(r).toEqual({ insert: '**文字**', selectStart: 2, selectEnd: 4 });
  });

  it('已包裹的选区:剥离标记(toggle 取消)', () => {
    const r = applyInlineWrap('**文字**', '**', '**', '加粗');
    expect(r).toEqual({ insert: '文字', selectStart: 0, selectEnd: 2 });
  });

  it('无选区:插入标记+占位并选中占位', () => {
    const r = applyInlineWrap('', '`', '`', '代码');
    expect(r).toEqual({ insert: '`代码`', selectStart: 1, selectEnd: 3 });
  });
});

describe('toggleLinePrefixes 标题', () => {
  it('h1:普通行添加标题标记', () => {
    const r = toggleLinePrefixes(['Alpha', 'Beta'], 'h1');
    expect(r.lines).toEqual(['# Alpha', '# Beta']);
    expect(r.appliedToAll).toBe(false);
  });

  it('h1:已是 h1 的行整体移除(toggle off)', () => {
    const r = toggleLinePrefixes(['# Alpha'], 'h1');
    expect(r.lines).toEqual(['Alpha']);
    expect(r.appliedToAll).toBe(true);
  });

  it('h2:替换既有 h1 级别而非叠加', () => {
    const r = toggleLinePrefixes(['# Alpha'], 'h2');
    expect(r.lines).toEqual(['## Alpha']);
  });

  it('混合状态(h1 + 普通行):统一补齐为 h1,不移除', () => {
    const r = toggleLinePrefixes(['# Alpha', 'Beta'], 'h1');
    expect(r.lines).toEqual(['# Alpha', '# Beta']);
    expect(r.appliedToAll).toBe(false);
  });
});

describe('toggleLinePrefixes 引用 / 列表 / 任务', () => {
  it('quote:添加与整体移除', () => {
    const add = toggleLinePrefixes(['A', '', 'B'], 'quote');
    expect(add.lines).toEqual(['> A', '', '> B']);
    const remove = toggleLinePrefixes(add.lines, 'quote');
    expect(remove.lines).toEqual(['A', '', 'B']);
    expect(remove.appliedToAll).toBe(true);
  });

  it('task 添加时把 bullet 升级为任务框', () => {
    const r = toggleLinePrefixes(['- 已有条目'], 'task');
    expect(r.lines).toEqual(['- [ ] 已有条目']);
  });

  it('bullet 移除时同时剥离任务框', () => {
    const r = toggleLinePrefixes(['- [x] 完成'], 'bullet');
    expect(r.lines).toEqual(['完成']);
  });

  it('task 全部应用后再次切换 → 整体移除勾选框(含已勾选)', () => {
    const r = toggleLinePrefixes(['- [ ] A', '- [x] B'], 'task');
    expect(r.lines).toEqual(['A', 'B']);
    expect(r.appliedToAll).toBe(true);
  });
});
