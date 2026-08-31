import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';
import { useToolStateStore } from '@/store/toolStateStore';
import { getCatalogEntry } from '@/lib/tool-catalog';

// 从静态目录取真实显示名,避免与目录命名脱节
const jf = getCatalogEntry('json_formatter')!;
const jm = getCatalogEntry('json_minifier')!;
const cron = getCatalogEntry('cron_parser')!;

beforeEach(() => {
  useToolStateStore.setState({
    availableTools: [],
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
});

describe('CommandPalette', () => {
  it('does not render dialog when closed', () => {
    render(<CommandPalette open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders tool list when open', () => {
    render(<CommandPalette open={true} onOpenChange={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: new RegExp(jf.name.zh, 'i') })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: new RegExp(jm.name.zh, 'i') })).toBeInTheDocument();
  });

  it('filters tools by search query', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open={true} onOpenChange={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'cron');
    // 仅 cron 相关工具保留
    expect(screen.getByRole('option', { name: new RegExp(cron.name.zh, 'i') })).toBeInTheDocument();
    // 不相关工具被过滤
    expect(
      screen.queryByRole('option', { name: new RegExp(jf.name.zh, 'i') }),
    ).not.toBeInTheDocument();
  });

  it('selecting a tool selects the tool and closes the palette', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('option', { name: new RegExp(jf.name.zh, 'i') }));
    // 选中工具写入 store.currentToolId(经 uiStore.openTool → selectTool)
    expect(useToolStateStore.getState().currentToolId).toBe('json_formatter');
    // 面板关闭
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows category badge and description in tool rows', () => {
    render(<CommandPalette open={true} onOpenChange={() => {}} />);
    // 类别徽章:Base64/Certificate/GZip/HTML/JWT/Basic Auth 同属编解码器(>=1),JSONPath/正则/XML/XSD 同属测试工具
    expect(screen.getAllByText('编解码器').length).toBeGreaterThan(0);
    expect(screen.getAllByText('测试工具').length).toBeGreaterThan(0);
    // 描述行:Base64 的描述文案(取 z h 子串即可,匹配多 span 拼接的可访问名)
    expect(screen.getAllByText(/Base64/i).length).toBeGreaterThan(0);
  });

  it('shows footer with key hints and result count', () => {
    render(<CommandPalette open={true} onOpenChange={() => {}} />);
    const footer = screen.getByTestId('palette-footer');
    expect(footer).toBeInTheDocument();
    // 三个键盘提示
    expect(footer.textContent).toMatch(/导航/);
    expect(footer.textContent).toMatch(/跳转/);
    expect(footer.textContent).toMatch(/关闭/);
    // 右侧计数:正整数 + "条结果" / "results" 兼容多语言
    expect(screen.getByTestId('palette-footer-count').textContent).toMatch(/\d+\s+(条结果|results)/);
  });
});
