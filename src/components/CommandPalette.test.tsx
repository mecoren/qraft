import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';
import { useToolStateStore } from '@/store/toolStateStore';
import type { ToolMetadata } from '@/types/tool';

const tools: ToolMetadata[] = [
  {
    id: 'json_formatter',
    name: 'JSON Formatter',
    description: 'Format JSON',
    category: 'formatter',
    icon: 'Braces',
    version: '0.1.0',
    input_schema: {},
    timeout_secs: null,
    streaming_supported: false,
    tags: ['json', 'pretty'],
  },
  {
    id: 'json_minifier',
    name: 'JSON Minifier',
    description: 'Minify JSON',
    category: 'formatter',
    icon: 'Braces',
    version: '0.1.0',
    input_schema: {},
    timeout_secs: null,
    streaming_supported: false,
    tags: ['json', 'min'],
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

describe('CommandPalette', () => {
  it('does not render dialog when closed', () => {
    render(<CommandPalette open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders tool list when open', () => {
    render(<CommandPalette open={true} onOpenChange={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /json formatter/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /json minifier/i })).toBeInTheDocument();
  });

  it('filters tools by search query', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open={true} onOpenChange={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'minifier');
    expect(screen.queryByRole('option', { name: /json formatter/i })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /json minifier/i })).toBeInTheDocument();
  });

  it('selecting a tool calls selectTool and closes palette', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(useToolStateStore.getState(), 'selectTool');
    const onOpenChange = vi.fn();
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('option', { name: /json formatter/i }));
    expect(spy).toHaveBeenCalledWith('json_formatter');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
