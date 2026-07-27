import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SideNav } from './SideNav';
import { useToolStateStore } from '@/store/toolStateStore';
import type { ToolMetadata } from '@/types/tool';

const tools: ToolMetadata[] = [
  {
    id: 'json_formatter',
    name: 'JSON Formatter',
    description: '',
    category: 'formatter',
    icon: 'Braces',
    version: '0.1.0',
    input_schema: {},
    timeout_secs: null,
    streaming_supported: false,
    tags: [],
  },
  {
    id: 'base64_codec',
    name: 'Base64 Codec',
    description: '',
    category: 'encoder',
    icon: 'Binary',
    version: '0.1.0',
    input_schema: {},
    timeout_secs: null,
    streaming_supported: false,
    tags: [],
  },
  {
    id: 'hash_calculator',
    name: 'Hash Calculator',
    description: '',
    category: 'converter',
    icon: 'Hash',
    version: '0.1.0',
    input_schema: {},
    timeout_secs: null,
    streaming_supported: false,
    tags: [],
  },
];

beforeEach(() => {
  useToolStateStore.setState({
    availableTools: tools,
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
});

describe('SideNav', () => {
  it('renders groups by category with headings', () => {
    render(<SideNav />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /格式化/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /编解码/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /转换器/ })).toBeInTheDocument();
  });

  it('clicking a tool calls selectTool', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(useToolStateStore.getState(), 'selectTool');
    render(<SideNav />);
    await user.click(screen.getByRole('button', { name: /json formatter/i }));
    expect(spy).toHaveBeenCalledWith('json_formatter');
  });

  it('highlights current tool via aria-current', () => {
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<SideNav />);
    const btn = screen.getByRole('button', { name: /base64 codec/i });
    expect(btn).toHaveAttribute('aria-current', 'true');
  });

  it('ArrowDown moves focus to next tool', async () => {
    const user = userEvent.setup();
    render(<SideNav />);
    const jsonBtn = screen.getByRole('button', { name: /json formatter/i });
    const base64Btn = screen.getByRole('button', { name: /base64 codec/i });
    jsonBtn.focus();
    expect(document.activeElement).toBe(jsonBtn);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(base64Btn);
  });
});
