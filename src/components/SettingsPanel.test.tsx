import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { SettingsPanel } from './SettingsPanel';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG }, loading: false, error: null });
});

describe('SettingsPanel', () => {
  it('renders form fields from current config', () => {
    render(<SettingsPanel />);
    expect(screen.getByLabelText(/theme mode/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max history/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/open command palette/i)).toBeInTheDocument();
  });

  it('shows validation error when max history is negative', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);
    const input = screen.getByLabelText(/max history/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '-5');
    await screen.findByText(/must be 0 or greater/i);
  });

  it('clicking save calls setConfig with changed values', async () => {
    const user = userEvent.setup();
    invokeMock.mockResolvedValueOnce({ success: true, data: true });
    render(<SettingsPanel />);
    const input = screen.getByLabelText(/max history/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '50');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(invokeMock).toHaveBeenCalledWith(
      'config_set',
      expect.objectContaining({
        key: 'general.max_history',
        value: 50,
      }),
    );
  });

  it('does not call setConfig when form invalid', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);
    const input = screen.getByLabelText(/max history/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '-1');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
