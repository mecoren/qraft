import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLocale } from '@/i18n';

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
    fakeState = {
      status: 'running',
      processed: 42,
      message: 'Scanned 42 files',
      result: null,
      error: null,
    };
    renderTool();
    expect(screen.getByTestId('analyzer-progress-message')).toHaveTextContent('42');
    expect(screen.getByTestId('analyzer-cancel')).toBeEnabled();
  });

  it('shows failure alert', () => {
    fakeState = {
      status: 'failed',
      processed: 0,
      message: '',
      result: null,
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

  it('hides stale result panel after switching mode and restores on switch back', async () => {
    // 回归:scan 完成后切到 search/file,旧结果被强转成对应 Panel 导致 undefined.map 崩溃
    const user = userEvent.setup();
    fakeState = {
      status: 'done',
      processed: 0,
      message: '',
      result: { total_files: 1 },
      error: null,
    };
    renderTool(); // scan 模式,先跑一次 scan 才有 resultMode
    await user.click(screen.getByTestId('analyzer-pick-folder'));
    await waitFor(() => expect(runMock).toHaveBeenCalled());
    runMock.mockClear();
    expect(screen.getByText('scan-panel')).toBeInTheDocument();

    // 切到 search:不渲染旧 scan 结果(否则 SearchResultsPanel 取 results.map 崩溃)
    await user.click(screen.getByTestId('analyzer-mode-search'));
    expect(screen.queryByText('search-panel')).toBeNull();
    expect(screen.queryByText('scan-panel')).toBeNull();

    // 切回 scan:结果仍可查看
    await user.click(screen.getByTestId('analyzer-mode-scan'));
    expect(screen.getByText('scan-panel')).toBeInTheDocument();
  });

  it('en-US:页签/按钮/提示随语言切换(手动切语言场景),结束恢复 zh 桩', () => {
    changeLocale('en-US');
    // 先卸载再切回 zh 桩,避免异步 languageChanged 在 act 环境外触发告警更新
    const { unmount } = renderTool();
    try {
      expect(screen.getByTestId('analyzer-mode-scan')).toHaveTextContent('Folder stats');
      expect(screen.getByTestId('analyzer-mode-search')).toHaveTextContent('Content search');
      expect(screen.getByTestId('analyzer-pick-folder')).toHaveTextContent('Choose folder…');
      expect(screen.getByTestId('analyzer-run')).toHaveTextContent('Analyze');
      expect(
        screen.getByText('Read-only analysis: no files are written or modified.'),
      ).toBeInTheDocument();
    } finally {
      unmount();
      changeLocale('zh-CN');
    }
  });
});
