import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { App } from './App';
import type { ToolMetadata } from '@/types/tool';
import type { CommandResponse } from '@/types/ipc';
import type { UserConfig } from '@/types/config';
import { DEFAULT_USER_CONFIG } from '@/types/config';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

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
];

function setupHappyPath() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'config_get_all') {
      return Promise.resolve({
        success: true,
        data: { ...DEFAULT_USER_CONFIG },
      } as CommandResponse<UserConfig>);
    }
    if (cmd === 'tool_list') {
      return Promise.resolve({
        success: true,
        data: tools,
      } as CommandResponse<ToolMetadata[]>);
    }
    if (cmd === 'history_list') {
      return Promise.resolve({ success: true, data: [] });
    }
    return Promise.resolve({ success: true, data: null });
  });
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe('App', () => {
  it('renders SideNav with tool groups after mount', async () => {
    setupHappyPath();
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /json formatter/i })).toBeInTheDocument();
  });

  it('clicking a tool switches main area to ToolPanel', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    await user.click(await screen.findByRole('button', { name: /json formatter/i }));
    // ToolPanel header 显示工具名
    expect(screen.getAllByText(/json formatter/i).length).toBeGreaterThan(0);
  });

  it('Ctrl+K opens CommandPalette', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Control>}{k}{/Control}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
