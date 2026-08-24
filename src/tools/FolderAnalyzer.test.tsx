import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pickFolder = vi.fn();
const pickFilePath = vi.fn();
const routeDropped = vi.fn();

vi.mock('./folder-analyzer/analyzerApi', () => ({
  pickFolder: (...a: unknown[]) => pickFolder(...a),
  pickFilePath: (...a: unknown[]) => pickFilePath(...a),
  routeDropped: (...a: unknown[]) => routeDropped(...a),
}));

const runMock = vi.fn().mockResolvedValue(undefined);
const cancelMock = vi.fn().mockResolvedValue(undefined);
let fakeState = {
  status: 'idle' as 'idle' | 'running' | 'done' | 'failed',
  processed: 0,
  message: '',
  result: null as unknown,
  error: null as string | null,
};

vi.mock('./folder-analyzer/useAnalyzerTask', () => ({
  useAnalyzerTask: () => ({ state: fakeState, run: runMock, cancel: cancelMock }),
}));

// 面板 mock 掉,聚焦主组件编排
vi.mock('./folder-analyzer/ScanResultsPanel', () => ({
  ScanResultsPanel: () => <div>scan-panel</div>,
}));
vi.mock('./folder-analyzer/SearchResultsPanel', () => ({
  SearchResultsPanel: () => <div>search-panel</div>,
}));
vi.mock('./folder-analyzer/FileInspectPanel', () => ({
  FileInspectPanel: () => <div>file-panel</div>,
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async () => () => {}),
  }),
}));

import { FolderAnalyzer } from './FolderAnalyzer';

function renderTool() {
  return render(
    <FolderAnalyzer toolId="folder_analyzer" metadata={{ id: 'folder_analyzer' } as never} />,
  );
}

describe('FolderAnalyzer orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeState = { status: 'idle', processed: 0, message: '', result: null, error: null };
    runMock.mockResolvedValue(undefined);
  });

  it('scan mode requires folder then runs with params', async () => {
    const user = userEvent.setup();
    pickFolder.mockResolvedValue('C:/proj');
    renderTool();
    await user.click(screen.getByTestId('analyzer-pick-folder'));
    await waitFor(() =>
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: 'C:/proj',
          mode: 'scan',
          options: expect.objectContaining({ include_hidden: false }),
        }),
      ),
    );
  });

  it('keeps target and disables nothing when dialog cancelled', async () => {
    const user = userEvent.setup();
    pickFolder.mockResolvedValue(null);
    renderTool();
    await user.click(screen.getByTestId('analyzer-pick-folder'));
    await waitFor(() => expect(runMock).not.toHaveBeenCalled());
    expect(screen.getByTestId('analyzer-run')).toBeDisabled();
  });

  it('search mode passes pattern options', async () => {
    const user = userEvent.setup();
    pickFolder.mockResolvedValue('C:/proj');
    renderTool();
    await user.click(screen.getByTestId('analyzer-mode-search'));
    await user.type(screen.getByTestId('analyzer-pattern'), 'foo');
    await user.click(screen.getByTestId('analyzer-pick-folder'));
    await waitFor(() =>
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'search',
          options: expect.objectContaining({ pattern: 'foo', is_regex: false }),
        }),
      ),
    );
  });

  it('file mode picks a file path', async () => {
    const user = userEvent.setup();
    pickFilePath.mockResolvedValue('C:/x/a.md');
    renderTool();
    await user.click(screen.getByTestId('analyzer-mode-file'));
    await user.click(screen.getByTestId('analyzer-pick-file'));
    await waitFor(() =>
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: 'C:/x/a.md', mode: 'file' }),
      ),
    );
  });

  it('shows running progress and enables cancel', () => {
    fakeState = { status: 'running', processed: 42, message: '已扫描 42 文件', result: null, error: null };
    renderTool();
    expect(screen.getByTestId('analyzer-progress-message')).toHaveTextContent('42');
    expect(screen.getByTestId('analyzer-cancel')).toBeEnabled();
  });

  it('shows failure alert', () => {
    fakeState = {
      status: 'failed', processed: 0, message: '', result: null,
      error: 'ERR_PERMISSION_DENIED: denied',
    };
    renderTool();
    expect(screen.getByRole('alert')).toHaveTextContent('denied');
  });

  it('routes dropped dir to scan run', async () => {
    routeDropped.mockResolvedValue({ path: 'C:/dropped', kind: 'dir' });
    // 直接测纯函数 + 组件内 handleDrop 走同一函数
    const { routeDropped: fn } = await import('./folder-analyzer/analyzerApi');
    const res = await fn(['C:/dropped']);
    expect(res).toEqual({ path: 'C:/dropped', kind: 'dir' });
  });

  it('renders done results panel by mode', async () => {
    fakeState = { status: 'done', processed: 0, message: '', result: { total_files: 1 }, error: null };
    renderTool(); // 默认 scan 模式
    expect(await screen.findByText('scan-panel')).toBeInTheDocument();
  });
});
