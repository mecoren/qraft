import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useShortcut } from './useShortcut';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';

function Harness({ onFire }: { onFire: (e: KeyboardEvent) => void | false }) {
  useShortcut('execute_tool', onFire, [onFire]);
  return null;
}

/** 记录最近一次派发的 keydown,供断言 defaultPrevented */
let lastEvent: KeyboardEvent | null = null;

describe('useShortcut', () => {
  beforeEach(() => {
    useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG } });
  });

  function fireKey(init: KeyboardEventInit) {
    act(() => {
      // cancelable 必须显式开启,否则 preventDefault() 不生效,defaultPrevented 恒为 false
      lastEvent = new KeyboardEvent('keydown', { cancelable: true, ...init });
      window.dispatchEvent(lastEvent);
    });
  }

  it('匹配组合键时触发一次', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    fireKey({ key: 'Enter', ctrlKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('长按自动重复(e.repeat)不触发,防止快捷键连发', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    fireKey({ key: 'Enter', ctrlKey: true, repeat: true });
    fireKey({ key: 'Enter', ctrlKey: true, repeat: true });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('首次按下(repeat=false)后,同次长按的 repeat 不叠加触发', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    fireKey({ key: 'Enter', ctrlKey: true, repeat: false });
    fireKey({ key: 'Enter', ctrlKey: true, repeat: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('默认匹配后吞掉事件(preventDefault + stopPropagation)', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    fireKey({ key: 'Enter', ctrlKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(lastEvent?.defaultPrevented).toBe(true);
  });

  it('handler 返回 false 时不吞事件,交给深层组件处理(如 Monaco 关闭查找部件)', () => {
    const onFire = vi.fn(() => false);
    render(<Harness onFire={onFire} />);
    fireKey({ key: 'Enter', ctrlKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(lastEvent?.defaultPrevented).toBe(false);
  });
});
