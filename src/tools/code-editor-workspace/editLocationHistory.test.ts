/**
 * editLocationHistory 单元测试 —— 位置记录合并规则与后退/前进栈行为
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  editLocationBackCount,
  editLocationForwardCount,
  goBackEditLocation,
  goForwardEditLocation,
  recordEditLocation,
  resetEditLocationHistory,
} from './editLocationHistory';

/** 同一 Tab 的便捷记录 */
function rec(line: number, tabId = 't1', atMs = Date.now()): void {
  recordEditLocation({ tabId, line, column: 1 });
  // recordEditLocation 内部取 Date.now();注入 atMs 仅用于推进虚拟时钟
  vi.setSystemTime(atMs);
}

beforeEach(() => {
  resetEditLocationHistory();
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('记录合并', () => {
  it('同 Tab 短间隔内连续记录合并为一条(保留最新位置)', () => {
    rec(1);
    vi.advanceTimersByTime(500);
    rec(5);
    expect(editLocationBackCount()).toBe(1);
  });

  it('同 Tab 超过时间窗但行距小于阈值仍合并', () => {
    rec(1);
    vi.advanceTimersByTime(5000);
    rec(5); // 距 1 行仅 4 行 < 10
    expect(editLocationBackCount()).toBe(1);
  });

  it('同 Tab 大幅跳转(≥10 行)分条', () => {
    rec(1);
    vi.advanceTimersByTime(5000);
    rec(50);
    expect(editLocationBackCount()).toBe(2);
  });

  it('跨 Tab 恒分条(即使时间与行号都接近)', () => {
    rec(1, 't1');
    vi.advanceTimersByTime(100);
    rec(1, 't2');
    expect(editLocationBackCount()).toBe(2);
  });

  it('新记录清空前进栈(浏览器后退后再编辑则无法前进)', () => {
    rec(1);
    vi.advanceTimersByTime(6000);
    rec(50);
    vi.advanceTimersByTime(6000);
    rec(100);
    expect(goBackEditLocation()).not.toBeNull();
    expect(editLocationForwardCount()).toBe(1);
    rec(120); // 后退后产生新编辑
    expect(editLocationForwardCount()).toBe(0);
  });
});

describe('后退/前进', () => {
  it('后退返回上一位置并进入前进栈', () => {
    rec(1);
    vi.advanceTimersByTime(6000);
    rec(50);
    vi.advanceTimersByTime(6000);
    rec(100);
    const target = goBackEditLocation();
    expect(target).toMatchObject({ tabId: 't1', line: 50 });
    expect(editLocationForwardCount()).toBe(1);
  });

  it('后退到栈底后继续后退返回 null(不再清前进栈)', () => {
    rec(1);
    const target = goBackEditLocation();
    expect(target).toBeNull();
    expect(editLocationForwardCount()).toBe(1);
  });

  it('前进恢复后退前的位置', () => {
    rec(1);
    vi.advanceTimersByTime(6000);
    rec(50);
    expect(goBackEditLocation()).toMatchObject({ line: 1 });
    const fwd = goForwardEditLocation();
    expect(fwd).toMatchObject({ tabId: 't1', line: 50 });
    expect(editLocationForwardCount()).toBe(0);
  });

  it('无可前进返回 null', () => {
    rec(1);
    expect(goForwardEditLocation()).toBeNull();
  });

  it('单条记录后退返回 null 但位置已入前进栈(可前进回原位)', () => {
    rec(1);
    expect(goBackEditLocation()).toBeNull();
    expect(goForwardEditLocation()).toMatchObject({ line: 1 });
  });
});
