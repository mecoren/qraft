/**
 * useLargeFileScan 单元测试 —— 索引扫描触发与「关闭 Tab 即取消」
 *
 * mock fileOps(扫描 / 取消受控),验证:
 * - 缺元数据的 largeFile Tab 带 scanId 发起 `fs_large_file_info`,完成写回 store
 * - Tab 在扫描期间被关闭 → 按同一 scanId 取消,不再等读盘结束
 * - 已有元数据 / 非大文件 Tab 不触发扫描;切换 Tab 不取消
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { DEFAULT_WORKSPACE, type EditorTab, type LargeFileMeta } from './schema';
import { cancelLargeFileScan, largeFileInfo } from './fileOps';
import { useLargeFileScan } from './useLargeFileScan';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';

vi.mock('./fileOps', () => ({
  largeFileInfo: vi.fn(),
  cancelLargeFileScan: vi.fn(async () => {}),
  newLargeFileScanId: vi.fn(() => 'scan-1'),
}));

vi.mock('@/lib/ipc', () => ({
  safeInvoke: vi.fn(async () => ({ ok: true, value: null })),
  invokeCommand: vi.fn(),
  listen: vi.fn(async () => () => {}),
}));

const infoMock = largeFileInfo as unknown as ReturnType<typeof vi.fn>;
const cancelMock = cancelLargeFileScan as unknown as ReturnType<typeof vi.fn>;

const META: LargeFileMeta = {
  size: 30 * 1024 * 1024,
  encoding: 'utf-8',
  eol: 'lf',
  lineCount: 1000,
  calibration: [{ line: 1, offset: 0 }],
};

function makeLargeTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 'tab-large',
    title: 'huge.log',
    path: 'C:\\logs\\huge.log',
    language: 'plaintext',
    languageAuto: false,
    content: '',
    savedContent: '',
    pinned: false,
    largeFile: true,
    ...overrides,
  };
}

function setTabs(tabs: EditorTab[]): void {
  useEditorWorkspaceStore.setState({
    workspace: { ...DEFAULT_WORKSPACE, tabs, activeTabId: tabs[0]?.id ?? null },
  });
}

beforeEach(() => {
  infoMock.mockReset();
  cancelMock.mockReset();
  useEditorWorkspaceStore.setState({
    workspace: { ...DEFAULT_WORKSPACE, tabs: [], activeTabId: null },
    ready: false,
    userTouched: false,
    error: null,
    recentlyClosed: [],
  });
});

describe('useLargeFileScan', () => {
  it('缺元数据的 largeFile Tab 带 scanId 发起扫描并写回 store', async () => {
    const tab = makeLargeTab();
    setTabs([tab]);
    infoMock.mockResolvedValue(META);

    renderHook(() => useLargeFileScan(tab));

    await waitFor(() => expect(infoMock).toHaveBeenCalledWith(tab.path, 'scan-1'));
    await waitFor(() =>
      expect(useEditorWorkspaceStore.getState().workspace.tabs[0]?.largeFileInfo).toEqual(META),
    );
    // 扫描已完成:不需要取消
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('扫描期间关闭 Tab → 按同一 scanId 取消任务', async () => {
    const tab = makeLargeTab();
    setTabs([tab]);
    // 永不完成:模拟 10GB 索引仍在读盘时用户关掉 Tab
    infoMock.mockReturnValue(new Promise(() => {}));

    const { rerender } = renderHook(
      (props: { active: EditorTab | null }) => useLargeFileScan(props.active),
      { initialProps: { active: tab } },
    );
    await waitFor(() => expect(infoMock).toHaveBeenCalledTimes(1));

    // store 变更会驱动 hook 重渲染,须包在 act 内
    act(() => {
      setTabs([]);
    });
    rerender({ active: null });

    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith('scan-1'));
  });

  it('切换激活 Tab 不取消其它 Tab 的在飞扫描', async () => {
    const scanning = makeLargeTab({ id: 'tab-a', path: 'C:\\logs\\a.log' });
    const other = makeLargeTab({ id: 'tab-b', path: 'C:\\logs\\b.log' });
    setTabs([scanning, other]);
    infoMock.mockReturnValue(new Promise(() => {}));

    const { rerender } = renderHook(
      (props: { active: EditorTab | null }) => useLargeFileScan(props.active),
      { initialProps: { active: scanning } },
    );
    await waitFor(() => expect(infoMock).toHaveBeenCalledTimes(1));

    rerender({ active: other });
    await waitFor(() => expect(infoMock).toHaveBeenCalledTimes(2));
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('已有元数据或非大文件 Tab 不触发扫描', async () => {
    const scanned = makeLargeTab({ largeFileInfo: META });
    const normal = makeLargeTab({ id: 'tab-plain', largeFile: false });
    setTabs([scanned, normal]);

    const { rerender } = renderHook(
      (props: { active: EditorTab | null }) => useLargeFileScan(props.active),
      { initialProps: { active: scanned } },
    );
    rerender({ active: normal });
    rerender({ active: null });

    expect(infoMock).not.toHaveBeenCalled();
  });
});
