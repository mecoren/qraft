import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useShortcut } from './useShortcut';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';

function Harness({ onFire }: { onFire: () => void }) {
  useShortcut('execute_tool', onFire, [onFire]);
  return null;
}

describe('useShortcut', () => {
  beforeEach(() => {
    useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG } });
  });

  function fireKey(init: KeyboardEventInit) {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', init));
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
});
