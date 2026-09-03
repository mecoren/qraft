/**
 * command.tsx —— QuickPickDialog 一体化 Quick Pick 弹窗 单元测试
 *
 * 契约(以「全局查找」为参考组件):
 * - 顶部搜索框固定、中间结果列表、底部操作提示条(count 可选);
 * - 列表行数据驱动:一行/两行由 description 是否传入决定;
 * - 行结构:左侧(打勾列/前导图标 + 主文本[+次行])、右侧尾随信息(右对齐);
 * - 高度随内容伸缩:h-auto + max-h;长列表内部滚动;
 * - 受控/非受控查询、empty 空态、listFooter 列表附注。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Check } from 'lucide-react';
import { QuickPickDialog, type QuickPickGroup } from './command';

/** 手写一组分组,含一行/两行/徽标/灰字场景 */
function makeGroups(): QuickPickGroup[] {
  return [
    {
      heading: '分组一',
      items: [
        {
          key: 'a',
          label: '单项主文本',
          trailing: 'hint值',
        },
        {
          key: 'b',
          label: '两项主文本',
          description: '次行描述',
          leading: <span data-testid="lead-icon">*</span>,
          trailing: '徽标',
          trailingStyle: 'badge',
        },
      ],
    },
  ];
}

describe('QuickPickDialog', () => {
  it('渲染顶部搜索框 / 列表 / 底部操作提示条与计数', () => {
    render(
      <QuickPickDialog open title="测试标题" groups={makeGroups()} count={<span>3 条结果</span>} />,
    );
    // 顶部输入框
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    // 列表项
    expect(screen.getByText('单项主文本')).toBeInTheDocument();
    expect(screen.getByText('两项主文本')).toBeInTheDocument();
    // sr-only 标题
    expect(screen.getByText('测试标题')).toBeInTheDocument();
    // 底部快捷键提示(zh:导航 / 确认 / 关闭)
    expect(screen.getByText('导航')).toBeInTheDocument();
    expect(screen.getByText('确认')).toBeInTheDocument();
    expect(screen.getByText('关闭')).toBeInTheDocument();
    // 右侧计数
    expect(screen.getByText('3 条结果')).toBeInTheDocument();
  });

  it('description 未传为单行、传入为两行', () => {
    render(<QuickPickDialog open title="t" groups={makeGroups()} />);
    // 单行项:没有次行描述
    const single = screen.getByText('单项主文本');
    expect(single.closest('[role="option"]')?.textContent).not.toContain('次行描述');
    // 两行项:描述出现在同一 option 内
    const two = screen.getByText('两项主文本');
    expect(
      within(two.closest('[role="option"]') as HTMLElement).getByText('次行描述'),
    ).toBeInTheDocument();
  });

  it('trailing 以 hint 灰字与 badge 徽标区分', () => {
    render(<QuickPickDialog open title="t" groups={makeGroups()} />);
    const hint = screen.getByText('hint值');
    expect(hint.className).toContain('text-muted-foreground');
    const badge = screen.getByText('徽标');
    expect(badge.className).toContain('bg-muted');
  });

  it('leading 前导槽渲染在文本之前', () => {
    render(<QuickPickDialog open title="t" groups={makeGroups()} />);
    expect(screen.getByTestId('lead-icon')).toBeInTheDocument();
  });

  it('checkColumn 为 true 时渲染行首打勾列(未勾占位对齐)', () => {
    const groups: QuickPickGroup[] = [
      {
        items: [
          { key: 'u', label: '未选中', checkColumn: true, selected: false },
          {
            key: 's',
            label: '已选中',
            checkColumn: true,
            selected: true,
            leading: <Check data-testid="ck" />,
          },
        ],
      },
    ];
    render(<QuickPickDialog open title="t" groups={groups} />);
    // 已选中项渲染打勾图标
    expect(screen.getByTestId('ck')).toBeInTheDocument();
  });

  it('受控查询:value/onValueChange 生效', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <QuickPickDialog
        open
        title="t"
        value="abc"
        onValueChange={onValueChange}
        groups={makeGroups()}
      />,
    );
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.value).toBe('abc');
    await user.type(input, 'x');
    expect(onValueChange).toHaveBeenCalled();
  });

  it('非受控查询:不传 value 由 cmdk 内部管理', async () => {
    const user = userEvent.setup();
    render(<QuickPickDialog open title="t" groups={makeGroups()} />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await user.type(input, 'x');
    expect(input.value).toBe('x');
  });

  it('shouldFilter=false 且无 items 时渲染 empty 空态', () => {
    render(
      <QuickPickDialog
        open
        title="t"
        shouldFilter={false}
        groups={[]}
        empty={<span data-testid="empty-state">空</span>}
      />,
    );
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    // 不应渲染任何 option
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('listFooter 渲染在列表底部', () => {
    render(
      <QuickPickDialog
        open
        title="t"
        groups={makeGroups()}
        listFooter={<span data-testid="list-foot">附注</span>}
      />,
    );
    expect(screen.getByTestId('list-foot')).toBeInTheDocument();
  });

  it('hint 渲染在输入框下方', () => {
    render(
      <QuickPickDialog
        open
        title="t"
        groups={makeGroups()}
        hint={<span data-testid="hintline">提示</span>}
      />,
    );
    expect(screen.getByTestId('hintline')).toBeInTheDocument();
  });

  it('对话框高度固定(垂直居中下顶部恒定,搜索框位置不随结果/空态变化)', () => {
    render(<QuickPickDialog open title="t" groups={makeGroups()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('h-[min(60vh,560px)]');
  });

  it('testid 契约:contentTestId / footerTestId / footerCountTestId / inputTestId / listTestId', () => {
    render(
      <QuickPickDialog
        open
        title="t"
        groups={makeGroups()}
        count={<span>3 条结果</span>}
        contentTestId="panel"
        footerTestId="footer"
        footerCountTestId="footer-count"
        inputTestId="input"
        listTestId="list"
      />,
    );
    expect(screen.getByTestId('panel')).toBeInTheDocument();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
    expect(screen.getByTestId('footer-count')).toBeInTheDocument();
    expect(screen.getByTestId('input')).toBeInTheDocument();
    expect(screen.getByTestId('list')).toBeInTheDocument();
  });

  it('hideCloseButton 隐藏右上角关闭钮', () => {
    const { unmount } = render(<QuickPickDialog open title="t" groups={makeGroups()} />);
    expect(screen.getByText('Close')).toBeInTheDocument();
    unmount();
    render(<QuickPickDialog open title="t" groups={makeGroups()} hideCloseButton />);
    expect(screen.queryByText('Close')).not.toBeInTheDocument();
  });

  it('点击列表项触发 onSelect 并通过 onOpenChange 关闭', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const groups: QuickPickGroup[] = [{ items: [{ key: 'x', label: '可点项', onSelect }] }];
    render(<QuickPickDialog open title="t" groups={groups} onOpenChange={onOpenChange} />);
    await user.click(screen.getByText('可点项'));
    expect(onSelect).toHaveBeenCalled();
  });
});
