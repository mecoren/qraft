import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { HistoryPanel } from './HistoryPanel';
import { useHistoryStore } from '@/store/historyStore';
import type { HistoryEntry } from '@/types/history';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const entry: HistoryEntry = {
  id: 'h1',
  toolId: 'json_formatter',
  timestamp: '2026-07-25T08:00:00Z',
  inputSummary: { textPreview: '{"a":1}', textBytes: 7, params: {}, redacted: false },
  outputSummary: { textPreview: '{\n  "a": 1\n}', textBytes: 12, redacted: false },
  success: true,
  durationMs: 5,
};

beforeEach(() => {
  invokeMock.mockReset();
  useHistoryStore.setState({ entries: [entry], loading: false, error: null });
});

describe('HistoryPanel', () => {
  it('renders history entries with tool id and preview', () => {
    render(<HistoryPanel onSelect={() => {}} />);
    expect(screen.getByText(/json_formatter/i)).toBeInTheDocument();
    expect(screen.getByText(/\{"a":1\}/i)).toBeInTheDocument();
  });

  it('clicking an entry calls onSelect with entry', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<HistoryPanel onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: /json_formatter/i }));
    expect(onSelect).toHaveBeenCalledWith(entry);
  });

  it('clear button calls history_clear via store', async () => {
    const user = userEvent.setup();
    invokeMock.mockResolvedValueOnce({ success: true, data: true });
    render(<HistoryPanel onSelect={() => {}} />);
    await user.click(screen.getByRole('button', { name: /clear history/i }));
    expect(invokeMock).toHaveBeenCalledWith('history_clear', {});
  });

  it('shows empty state when no entries', () => {
    useHistoryStore.setState({ entries: [] });
    render(<HistoryPanel onSelect={() => {}} />);
    expect(screen.getByText(/no history/i)).toBeInTheDocument();
  });
});
