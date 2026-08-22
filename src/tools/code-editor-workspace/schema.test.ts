import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WORKSPACE,
  normalizeWorkspace,
  resolveSidebarResize,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_HIDE_DELTA,
} from './schema';

/** 快捷构造:基准宽度 startWidth,从 startX 拖到 clientX */
function resolve(startWidth: number, deltaX: number, visible = true, pinned = false) {
  return resolveSidebarResize(startWidth, 500 + deltaX, 500, visible, pinned);
}

describe('resolveSidebarResize', () => {
  it('visible(常规): 右移加宽并跟随位移', () => {
    expect(resolve(288, 100)).toEqual({ action: 'resize', width: 388 });
  });

  it('visible(常规): 左移收窄但不低于最小宽度', () => {
    // 未越过隐藏阈值(288-100=188 > 180-48)按原始目标收窄
    expect(resolve(288, -100)).toEqual({ action: 'resize', width: 188 });
    // 越过最小宽度但未越过隐藏阈值时夹在最小宽度
    expect(resolve(SIDEBAR_MIN_WIDTH + 20, -20)).toEqual({
      action: 'resize',
      width: SIDEBAR_MIN_WIDTH,
    });
  });

  it('visible(常规): 右移不超过最大宽度', () => {
    expect(resolve(SIDEBAR_MAX_WIDTH - 10, 100)).toEqual({
      action: 'resize',
      width: SIDEBAR_MAX_WIDTH,
    });
  });

  it('visible(常规): 越过「最小宽度 - 阈值」继续左移 → 隐藏', () => {
    // 起点略高于最小宽度,越过「MIN - 48」即隐藏
    const raw = SIDEBAR_MIN_WIDTH + 10;
    expect(resolve(raw, -(SIDEBAR_HIDE_DELTA + 10 + 1))).toEqual({ action: 'hide' });
    // 单次大幅左移直接越过阈值同样隐藏
    expect(resolve(288, -200)).toEqual({ action: 'hide' });
  });

  it('visible(常规): 隐藏阈值内左移不触发隐藏(滞回防抖)', () => {
    const raw = SIDEBAR_MIN_WIDTH + 30;
    expect(resolve(raw, -SIDEBAR_HIDE_DELTA)).toEqual({
      action: 'resize',
      width: SIDEBAR_MIN_WIDTH,
    });
    expect(resolve(200, -(SIDEBAR_HIDE_DELTA - 1))).toEqual({
      action: 'resize',
      width: SIDEBAR_MIN_WIDTH,
    });
  });

  it('hidden(左缘零点锚定): 向右任意移动即恢复显示', () => {
    expect(resolve(0, 0, false)).toEqual({ action: 'show' });
    expect(resolve(0, 1, false)).toEqual({ action: 'show' });
    expect(resolve(0, 200, false)).toEqual({ action: 'show' });
  });

  it('hidden: 左移保持 idle,不产生状态写入', () => {
    expect(resolve(0, -1, false)).toEqual({ action: 'idle' });
    expect(resolve(0, -300, false)).toEqual({ action: 'idle' });
  });

  it('手势内 hide 重锚(-滞回带): 右移不满带宽仍隐藏,满带宽才恢复', () => {
    expect(resolve(-SIDEBAR_HIDE_DELTA, SIDEBAR_HIDE_DELTA - 1, false)).toEqual({
      action: 'idle',
    });
    expect(resolve(-SIDEBAR_HIDE_DELTA, SIDEBAR_HIDE_DELTA, false)).toEqual({ action: 'show' });
  });

  it('pinned: 未越过「左缘+MIN」恒以最小宽度展示,越过才放宽', () => {
    // show 后基准不变(raw = 光标到左缘距离),钉住区内不放宽
    expect(resolve(0, 100, true, true)).toEqual({ action: 'resize', width: SIDEBAR_MIN_WIDTH });
    expect(resolve(0, SIDEBAR_MIN_WIDTH - 1, true, true)).toEqual({
      action: 'resize',
      width: SIDEBAR_MIN_WIDTH,
    });
    // 越过「左缘 + MIN」→ 跟手放宽
    expect(resolve(0, SIDEBAR_MIN_WIDTH + 40, true, true)).toEqual({
      action: 'resize',
      width: 220,
    });
  });

  it('pinned: 不误触标准隐藏阈值(raw ∈ [0,132] 是合法钉住区)', () => {
    for (const dx of [0, 50, SIDEBAR_MIN_WIDTH - SIDEBAR_HIDE_DELTA]) {
      expect(resolve(0, dx, true, true).action).toBe('resize');
    }
  });

  it('pinned: 向左拖离侧栏左缘超过滞回带 → 重新隐藏', () => {
    expect(resolve(0, -(SIDEBAR_HIDE_DELTA - 1), true, true)).toEqual({
      action: 'resize',
      width: SIDEBAR_MIN_WIDTH,
    });
    expect(resolve(0, -SIDEBAR_HIDE_DELTA, true, true)).toEqual({ action: 'hide' });
  });

  it('完整手势模拟: 隐藏 → 右拖恢复钉住 → 越界加宽 → 回拖隐藏', () => {
    // 1) 隐藏态按下(零点=抓取点),右移 3px 触发 show
    expect(resolve(0, 3, false, true)).toEqual({ action: 'show' });
    // 2) 继续在钉住区移动(未到左缘+180),恒为最小宽度
    expect(resolve(0, 80, true, true)).toEqual({ action: 'resize', width: SIDEBAR_MIN_WIDTH });
    // 3) 越过「左缘+MIN」→ 加宽并退出钉住阶段(width>MIN)
    expect(resolve(0, 260, true, true)).toEqual({ action: 'resize', width: 260 });
    // 4) 退出钉住后回归标准规则:回拖越过「MIN-48」→ hide
    expect(resolve(260, -176, true, false)).toEqual({ action: 'hide' });
  });
});

describe('normalizeWorkspace: folders / expandedDirs', () => {
  it('旧版本数据缺失 folders/expandedDirs 字段时回退为空数组', () => {
    const w = normalizeWorkspace({ tabs: [], activeTabId: null });
    expect(w.folders).toEqual([]);
    expect(w.expandedDirs).toEqual([]);
  });

  it('损坏值(非数组/非法条目)被剔除或回退为空', () => {
    expect(normalizeWorkspace({ folders: 'nope' }).folders).toEqual([]);
    expect(
      normalizeWorkspace({ folders: [{ rootPath: '' }, null, { other: 1 }, 42] }).folders,
    ).toEqual([]);
    expect(normalizeWorkspace({ expandedDirs: [1, null, ''] }).expandedDirs).toEqual([]);
  });

  it('合法条目保留并按 rootPath 去重、展开路径去重', () => {
    const w = normalizeWorkspace({
      folders: [
        { rootPath: 'C:\\a' },
        { rootPath: 'C:\\a' }, // 重复根去重
        { rootPath: 'C:\\b' },
      ],
      expandedDirs: ['C:\\a', 'C:\\a\\sub', 'C:\\a'], // 重复展开路径去重
    });
    expect(w.folders).toEqual([{ rootPath: 'C:\\a' }, { rootPath: 'C:\\b' }]);
    expect(w.expandedDirs).toEqual(['C:\\a', 'C:\\a\\sub']);
  });

  it('兼容直接存路径字符串的旧格式文件夹条目', () => {
    const w = normalizeWorkspace({ folders: ['C:\\legacy'] });
    expect(w.folders).toEqual([{ rootPath: 'C:\\legacy' }]);
  });

  it('非对象输入回退默认工作区(folders/expandedDirs 为空)', () => {
    const w = normalizeWorkspace(null);
    expect(w.folders).toEqual(DEFAULT_WORKSPACE.folders);
    expect(w.expandedDirs).toEqual(DEFAULT_WORKSPACE.expandedDirs);
  });
});
