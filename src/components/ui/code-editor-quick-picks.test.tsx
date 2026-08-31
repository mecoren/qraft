/**
 * 状态栏快选弹窗单元测试(转到行/列 / 缩进操作 / 编码 / 行尾序列)
 *
 * 验证「全局搜索」式弹窗的核心交互契约:
 * - 转到行/列:预填、行/行:列解析、非法输入提示、Enter 与结果项确认
 * - 缩进操作:根动作列表、关键词筛选、二级宽度列表与返回、应用回调
 * - 编码:动作项可用性(无磁盘路径禁用重新打开)、二级列表、直接切换、搜索过滤
 * - 行尾序列:LF/CRLF 列表、当前项打勾、筛选与选择
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  EncodingQuickPick,
  EolQuickPick,
  GotoLineQuickPick,
  IndentQuickPick,
} from './code-editor-quick-picks';

// ============ 转到行/列 ============

describe('GotoLineQuickPick', () => {
  it('打开时输入为空,提示有效行号范围', () => {
    render(
      <GotoLineQuickPick
        open
        onOpenChange={vi.fn()}
        cursor={{ line: 3, column: 4 }}
        maxLine={278}
        onJump={vi.fn()}
        data-testid="goto"
      />,
    );
    // 空输入(VSCode 一致):无确认项,仅提示范围
    expect(screen.getByTestId('goto-search')).toHaveValue('');
    expect(screen.getByTestId('goto-hint')).toHaveTextContent('1 到 278');
    expect(screen.queryByTestId('goto-apply')).toBeNull();
  });

  it('输入纯行号后回车:跳转该行(列未指定)', async () => {
    const onJump = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <GotoLineQuickPick
        open
        onOpenChange={onOpenChange}
        cursor={{ line: 1, column: 1 }}
        maxLine={100}
        onJump={onJump}
        data-testid="goto"
      />,
    );
    const input = screen.getByTestId('goto-search');
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onJump).toHaveBeenCalledWith(42, undefined);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('输入「行:列」经结果项确认:回调带行列', async () => {
    const onJump = vi.fn();
    render(
      <GotoLineQuickPick
        open
        onOpenChange={vi.fn()}
        cursor={{ line: 1, column: 1 }}
        maxLine={100}
        onJump={onJump}
        data-testid="goto"
      />,
    );
    fireEvent.change(screen.getByTestId('goto-search'), { target: { value: '12:9' } });
    fireEvent.click(screen.getByTestId('goto-apply'));
    expect(onJump).toHaveBeenCalledWith(12, 9);
  });

  it('非法输入:提示格式错误,回车不跳转', () => {
    const onJump = vi.fn();
    render(
      <GotoLineQuickPick
        open
        onOpenChange={vi.fn()}
        cursor={{ line: 1, column: 1 }}
        maxLine={100}
        onJump={onJump}
        data-testid="goto"
      />,
    );
    const input = screen.getByTestId('goto-search');
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.getByTestId('goto-hint')).toHaveTextContent('无法识别的输入');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onJump).not.toHaveBeenCalled();
    expect(screen.queryByTestId('goto-apply')).toBeNull();
  });

  it('全角冒号与「仅列号」输入均可解析', () => {
    const onJump = vi.fn();
    render(
      <GotoLineQuickPick
        open
        onOpenChange={vi.fn()}
        cursor={{ line: 1, column: 1 }}
        maxLine={100}
        onJump={onJump}
        data-testid="goto"
      />,
    );
    fireEvent.change(screen.getByTestId('goto-search'), { target: { value: ':7' } });
    expect(screen.getByTestId('goto-apply')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('goto-apply'));
    // 仅列号:行取当前光标行 1,列 7
    expect(onJump).toHaveBeenCalledWith(1, 7);
  });
});

// ============ 缩进操作 ============

describe('IndentQuickPick', () => {
  const base = {
    open: true,
    onOpenChange: vi.fn(),
    insertSpaces: true,
    tabSize: 2,
  };

  it('根列表展示全部缩进动作项,当前方式打勾', () => {
    render(
      <IndentQuickPick
        {...base}
        onApply={vi.fn()}
        onDetect={vi.fn()}
        onConvert={vi.fn()}
        onTrim={vi.fn()}
        data-testid="indent"
      />,
    );
    expect(screen.getByTestId('indent-use-spaces')).toBeInTheDocument();
    expect(screen.getByTestId('indent-use-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('indent-display-size')).toBeInTheDocument();
    expect(screen.getByTestId('indent-detect')).toBeInTheDocument();
    expect(screen.getByTestId('indent-to-spaces')).toBeInTheDocument();
    expect(screen.getByTestId('indent-to-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('indent-trim')).toBeInTheDocument();
  });

  it('点击「使用制表符缩进」应用 insertSpaces=false 并关闭', async () => {
    const onApply = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <IndentQuickPick
        {...base}
        onOpenChange={onOpenChange}
        onApply={onApply}
        onDetect={vi.fn()}
        onConvert={vi.fn()}
        onTrim={vi.fn()}
        data-testid="indent"
      />,
    );
    fireEvent.click(screen.getByTestId('indent-use-tabs'));
    expect(onApply).toHaveBeenCalledWith({ insertSpaces: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('「使用空格缩进」展开宽度二级列表,选择 4 应用空格 4', async () => {
    const onApply = vi.fn();
    render(
      <IndentQuickPick
        {...base}
        tabSize={2}
        onApply={onApply}
        onDetect={vi.fn()}
        onConvert={vi.fn()}
        onTrim={vi.fn()}
        data-testid="indent"
      />,
    );
    fireEvent.click(screen.getByTestId('indent-use-spaces'));
    expect(screen.getByTestId('indent-width-1')).toBeInTheDocument();
    expect(screen.getByTestId('indent-width-4')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('indent-width-4'));
    expect(onApply).toHaveBeenCalledWith({ insertSpaces: true, tabSize: 4 });
  });

  it('二级列表「返回」回到根列表', async () => {
    render(
      <IndentQuickPick
        {...base}
        onApply={vi.fn()}
        onDetect={vi.fn()}
        onConvert={vi.fn()}
        onTrim={vi.fn()}
        data-testid="indent"
      />,
    );
    fireEvent.click(screen.getByTestId('indent-display-size'));
    fireEvent.click(screen.getByTestId('indent-back'));
    expect(screen.getByTestId('indent-detect')).toBeInTheDocument();
  });

  it('输入关键词筛选(中英文均可),选择「裁剪尾随空格」回调 onTrim', async () => {
    const onTrim = vi.fn();
    const user = userEvent.setup();
    render(
      <IndentQuickPick
        {...base}
        onApply={vi.fn()}
        onDetect={vi.fn()}
        onConvert={vi.fn()}
        onTrim={onTrim}
        data-testid="indent"
      />,
    );
    await user.type(screen.getByTestId('indent-search'), 'trim');
    fireEvent.click(screen.getByTestId('indent-trim'));
    expect(onTrim).toHaveBeenCalledTimes(1);
  });

  it('检测/转换动作分发对应回调', () => {
    const onDetect = vi.fn();
    const onConvert = vi.fn();
    render(
      <IndentQuickPick
        {...base}
        onApply={vi.fn()}
        onDetect={onDetect}
        onConvert={onConvert}
        onTrim={vi.fn()}
        data-testid="indent"
      />,
    );
    fireEvent.click(screen.getByTestId('indent-detect'));
    expect(onDetect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('indent-to-tabs'));
    expect(onConvert).toHaveBeenCalledWith('tabs');
  });
});

// ============ 编码 ============

describe('EncodingQuickPick', () => {
  const base = {
    open: true,
    onOpenChange: vi.fn(),
    currentEncoding: 'utf-8',
    onEncodingChange: vi.fn(),
    onEncodingReopen: vi.fn(),
    onEncodingSave: vi.fn(),
  };

  it('展示「重新打开/保存」动作项与编码列表', () => {
    render(<EncodingQuickPick {...base} reopenAvailable data-testid="enc" />);
    expect(screen.getByTestId('enc-reopen')).toBeInTheDocument();
    expect(screen.getByTestId('enc-save')).toBeInTheDocument();
    expect(screen.getByTestId('enc-encoding-utf-8')).toBeInTheDocument();
    expect(screen.getByTestId('enc-encoding-gb18030')).toBeInTheDocument();
  });

  it('reopenAvailable=false 时「重新打开」禁用,保存可用', () => {
    render(<EncodingQuickPick {...base} reopenAvailable={false} data-testid="enc" />);
    expect(screen.getByTestId('enc-reopen')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('enc-save')).not.toHaveAttribute('data-disabled', 'true');
  });

  it('「通过编码重新打开」进入二级列表,选择编码回调 onEncodingReopen', async () => {
    const onEncodingReopen = vi.fn();
    render(
      <EncodingQuickPick
        {...base}
        reopenAvailable
        onEncodingReopen={onEncodingReopen}
        data-testid="enc"
      />,
    );
    fireEvent.click(screen.getByTestId('enc-reopen'));
    fireEvent.click(screen.getByTestId('enc-encoding-gb18030'));
    expect(onEncodingReopen).toHaveBeenCalledWith('gb18030');
  });

  it('「通过编码保存」二级列表选择回调 onEncodingSave', () => {
    const onEncodingSave = vi.fn();
    render(<EncodingQuickPick {...base} onEncodingSave={onEncodingSave} data-testid="enc" />);
    fireEvent.click(screen.getByTestId('enc-save'));
    fireEvent.click(screen.getByTestId('enc-encoding-utf-8-bom'));
    expect(onEncodingSave).toHaveBeenCalledWith('utf-8-bom');
  });

  it('直接选择编码列表项回调 onEncodingChange', () => {
    const onEncodingChange = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <EncodingQuickPick
        {...base}
        onEncodingChange={onEncodingChange}
        onOpenChange={onOpenChange}
        data-testid="enc"
      />,
    );
    fireEvent.click(screen.getByTestId('enc-encoding-big5'));
    expect(onEncodingChange).toHaveBeenCalledWith('big5');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('搜索词过滤编码列表(按 id)', async () => {
    const user = userEvent.setup();
    render(<EncodingQuickPick {...base} reopenAvailable data-testid="enc" />);
    await user.type(screen.getByTestId('enc-search'), 'gb');
    expect(screen.getByTestId('enc-encoding-gb18030')).toBeInTheDocument();
    expect(screen.queryByTestId('enc-encoding-utf-8')).toBeNull();
  });

  it('未提供 onEncodingSave 时不渲染保存动作项', () => {
    render(<EncodingQuickPick {...base} onEncodingSave={undefined} data-testid="enc" />);
    expect(screen.queryByTestId('enc-save')).toBeNull();
  });
});

// ============ 行尾序列 ============

describe('EolQuickPick', () => {
  it('展示 LF/CRLF 两项,当前项存在', () => {
    render(
      <EolQuickPick
        open
        onOpenChange={vi.fn()}
        currentEol="CRLF"
        onSelect={vi.fn()}
        data-testid="eol"
      />,
    );
    expect(screen.getByTestId('eol-eol-LF')).toBeInTheDocument();
    expect(screen.getByTestId('eol-eol-CRLF')).toBeInTheDocument();
  });

  it('选择 CRLF 回调 onSelect 并关闭', () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <EolQuickPick
        open
        onOpenChange={onOpenChange}
        currentEol="LF"
        onSelect={onSelect}
        data-testid="eol"
      />,
    );
    fireEvent.click(screen.getByTestId('eol-eol-CRLF'));
    expect(onSelect).toHaveBeenCalledWith('CRLF');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('搜索词过滤(windows 关键词命中 CRLF)', async () => {
    const user = userEvent.setup();
    render(
      <EolQuickPick
        open
        onOpenChange={vi.fn()}
        currentEol="LF"
        onSelect={vi.fn()}
        data-testid="eol"
      />,
    );
    await user.type(screen.getByTestId('eol-search'), 'windows');
    await waitFor(() => expect(screen.queryByTestId('eol-eol-LF')).toBeNull());
    expect(screen.getByTestId('eol-eol-CRLF')).toBeInTheDocument();
  });
});
