import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Titlebar } from './Titlebar';
import { useUiStore } from '@/store/uiStore';
import { useToolStateStore } from '@/store/toolStateStore';

beforeEach(() => {
  useUiStore.setState({
    view: 'welcome',
    sidebarCollapsed: false,
    favorites: [],
    recents: [],
    expandedCategories: [],
  });
  useToolStateStore.setState({
    availableTools: [],
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
});

describe('Titlebar', () => {
  it('shows the current tool icon + name on the left in tool view', () => {
    useUiStore.setState({ view: 'tool' });
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<Titlebar />);
    // 左区展示当前工具名,中间品牌 Qraft 仍在
    expect(screen.getByTestId('titlebar-tool-name')).toHaveTextContent(/Base64/i);
    expect(screen.getByText('Qraft')).toBeInTheDocument();
  });

  it('hides the tool title on non-tool views (e.g. welcome)', () => {
    useUiStore.setState({ view: 'welcome' });
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<Titlebar />);
    expect(screen.queryByTestId('titlebar-tool-name')).not.toBeInTheDocument();
    expect(screen.getByText('Qraft')).toBeInTheDocument();
  });

  it('shows the tool description in a tooltip when hovering the tool title', async () => {
    useUiStore.setState({ view: 'tool' });
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<Titlebar />);
    const trigger = screen.getByTestId('titlebar-tool');
    // Radix Tooltip 由 pointermove 触发打开
    fireEvent.pointerMove(trigger);
    const tooltip = await screen.findByRole('tooltip', {}, { timeout: 2000 });
    expect(tooltip).toHaveTextContent(/Base64/i);
  });
});
