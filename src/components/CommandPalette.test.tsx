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
    expect(screen.getByRole('option', { name: new RegExp(jf.name, 'i') })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: new RegExp(jm.name, 'i') })).toBeInTheDocument();
  });

  it('filters tools by search query', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open={true} onOpenChange={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'cron');
    // 仅 cron 相关工具保留
    expect(screen.getByRole('option', { name: new RegExp(cron.name, 'i') })).toBeInTheDocument();
    // 不相关工具被过滤
    expect(
      screen.queryByRole('option', { name: new RegExp(jf.name, 'i') }),
    ).not.toBeInTheDocument();
  });

  it('selecting a tool selects the tool and closes the palette', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('option', { name: new RegExp(jf.name, 'i') }));
    // 选中工具写入 store.currentToolId(经 uiStore.openTool → selectTool)
    expect(useToolStateStore.getState().currentToolId).toBe('json_formatter');
    // 面板关闭
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
