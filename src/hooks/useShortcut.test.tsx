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
    const onFire = vi.fn((): false => false);
    render(<Harness onFire={onFire} />);
    fireKey({ key: 'Enter', ctrlKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(lastEvent?.defaultPrevented).toBe(false);
  });

  it('Ctrl+Tab / Ctrl+Shift+Tab(Tab 循环切换)可解析并匹配', () => {
    const onFire = vi.fn();
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        shortcuts: {
          ...DEFAULT_USER_CONFIG.shortcuts,
          execute_tool: 'Ctrl+Tab',
        },
      },
    });
    render(<Harness onFire={onFire} />);

    fireKey({ key: 'Tab', ctrlKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);

    // 不带 Ctrl 的裸 Tab 不匹配(交给编辑器焦点移动)
    fireKey({ key: 'Tab' });
    expect(onFire).toHaveBeenCalledTimes(1);

    // Ctrl+Shift+Tab 与 Ctrl+Tab 是不同组合
    fireKey({ key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Shift+T(恢复关闭 Tab)可解析并匹配', () => {
    const onFire = vi.fn();
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        shortcuts: {
          ...DEFAULT_USER_CONFIG.shortcuts,
          execute_tool: 'Ctrl+Shift+T',
        },
      },
    });
    render(<Harness onFire={onFire} />);
    fireKey({ key: 'T', ctrlKey: true, shiftKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
    // 大小写不敏感:小写 t 同样命中
    fireKey({ key: 't', ctrlKey: true, shiftKey: true });
    expect(onFire).toHaveBeenCalledTimes(2);
  });

  it('空字符串绑定表示禁用,不注册监听(不触发)', () => {
    const onFire = vi.fn();
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        shortcuts: {
          ...DEFAULT_USER_CONFIG.shortcuts,
          execute_tool: '',
        },
      },
    });
    render(<Harness onFire={onFire} />);
    fireKey({ key: 'Enter', ctrlKey: true });
    expect(onFire).not.toHaveBeenCalled();
  });
});
