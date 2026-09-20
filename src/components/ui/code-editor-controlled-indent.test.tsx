/**
 * CodeEditor 受控缩进 —— Task 3 (RED 先行)。
 *
 * 契约:
 * - 受控(`indent` prop 存在)时徽章由 prop 驱动:父传回什么就展示什么,
 *   全局设置 / 每 Tab override 变化即时反映,切 Tab(modelKey)不丢记忆。
 * - 用户经缩进菜单应用/检测后,经 `onIndentChange(具体值)` 上报宿主
 *   (工作台落到对应 Tab 的 indentOverride);`null` 表示清除回跟随。
 * - 非受控(prop 缺省,其他工具直用)保持原局部 state 行为。
 *
 * 注意:jsdom 下 Monaco 以受控 textarea 垫片运行(handleMount 永不触发),
 * 故此处只断言垫片可观察面——徽章 DOM 文本与上报回调,不碰 Monaco 内部状态。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CodeEditor } from './code-editor';
import { IndentQuickPick } from './code-editor-quick-picks';
import type { IndentStyle } from '@/lib/indentation';

const SPACES_2: IndentStyle = { insertSpaces: true, tabSize: 2 };
const TABS_4: IndentStyle = { insertSpaces: false, tabSize: 4 };

describe('CodeEditor 受控缩进', () => {
  it('受控 indent prop 驱动徽章:空格2 → 制表符', () => {
    const { rerender } = render(<CodeEditor data-testid="ed" value="hi" indent={SPACES_2} />);
    expect(screen.getByTestId('ed-status-indent')).toHaveTextContent('空格:2');

    // 切到 Tab(典型:工作台 resolved 由 override 算出):徽章即时跟随
    rerender(<CodeEditor data-testid="ed" value="hi" indent={TABS_4} />);
    expect(screen.getByTestId('ed-status-indent')).toHaveTextContent('制表符');
  });

  it('缩进菜单应用后经 onIndentChange 上报具体值,父写回后徽章更新', async () => {
    const onIndentChange = vi.fn();
    const { rerender } = render(
      <CodeEditor
        data-testid="ed"
        value="  hi"
        indent={SPACES_2}
        onIndentChange={onIndentChange}
      />,
    );

    fireEvent.click(screen.getByTestId('ed-status-indent'));
    fireEvent.click(await screen.findByTestId('ed-indent-picker-use-tabs'));

    // apply 只给子集,上报的是合并后的具体值(当前宽度保留)
    expect(onIndentChange).toHaveBeenCalledWith({ insertSpaces: false, tabSize: 2 });

    // 宿主写回(工作台 setTabIndent)→ 新 prop 驱动徽章
    rerender(
      <CodeEditor
        data-testid="ed"
        value="  hi"
        indent={{ insertSpaces: false, tabSize: 2 }}
        onIndentChange={onIndentChange}
      />,
    );
    expect(screen.getByTestId('ed-status-indent')).toHaveTextContent('制表符');
  });

  it('非受控(prop 缺省)保持原行为:初始空格徽章', () => {
    render(<CodeEditor data-testid="ed" value="hi" />);
    expect(screen.getByTestId('ed-status-indent')).toHaveTextContent('空格:2');
  });
});

describe('IndentQuickPick 跟随设置项', () => {
  const base = {
    open: true,
    onOpenChange: vi.fn(),
    insertSpaces: false,
    tabSize: 4,
    onApply: vi.fn(),
    onDetect: vi.fn(),
    onConvert: vi.fn(),
    onTrim: vi.fn(),
  };

  it('无 override 时不显示跟随项', () => {
    render(<IndentQuickPick {...base} data-testid="indent" />);
    expect(screen.queryByTestId('indent-follow')).toBeNull();
  });

  it('有 override 时显示当前全局值,点击回调 onReset', () => {
    const onReset = vi.fn();
    render(
      <IndentQuickPick
        {...base}
        hasOverride
        followStyle={SPACES_2}
        onReset={onReset}
        data-testid="indent"
      />,
    );
    const item = screen.getByTestId('indent-follow');
    expect(item).toHaveTextContent('跟随设置');
    expect(item).toHaveTextContent('空格:2');
    fireEvent.click(item);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
