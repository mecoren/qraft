/**
 * FileHistoryDialog 交互测试 —— 历史版本列表展示、选中与动作分发。
 *
 * 组件为纯展示(数据由宿主加载),测试聚焦:
 * - 列表渲染(时间 / 版次 / 大小)与空态 / 加载态
 * - 默认选中最新版;点击行切换选中
 * - 「对比当前 / 恢复内容」携带选中快照 id 分发回调
 * - 无快照时三动作禁用;「清空历史」始终可达(有快照时)
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileHistoryDialog, type FileHistoryDialogProps } from './FileHistoryDialog';
import type { FileSnapshotMeta } from './fileOps';

const snapshots: FileSnapshotMeta[] = [
  { id: '2000', savedAtMs: 2_000, originalBytes: 128 },
  { id: '1000', savedAtMs: 1_000, originalBytes: 64 },
];

function setup(props: Partial<FileHistoryDialogProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onCompare: vi.fn(),
    onRestore: vi.fn(),
    onClear: vi.fn(),
    onCancel: vi.fn(),
  };
  const utils = render(
    <FileHistoryDialog
      open
      fileName="notes.txt"
      snapshots={snapshots}
      loading={false}
      selectedId="2000"
      {...handlers}
      {...props}
    />,
  );
  return { handlers, ...utils };
}

describe('FileHistoryDialog', () => {
  it('渲染版本列表:时间、版次与大小', () => {
    setup();

    expect(screen.getByTestId('file-history-item-2000')).toBeInTheDocument();
    expect(screen.getByTestId('file-history-item-1000')).toBeInTheDocument();
    // 版次:新 → 旧,最新为第 2 版
    expect(screen.getByText('第 2 版')).toBeInTheDocument();
    expect(screen.getByText('第 1 版')).toBeInTheDocument();
    expect(screen.getByText('大小 128 B')).toBeInTheDocument();
    expect(screen.getByText('大小 64 B')).toBeInTheDocument();
  });

  it('loading 态显示加载文案且不渲染列表', () => {
    setup({ loading: true, snapshots: [], selectedId: null });

    expect(screen.getByText('正在加载历史…')).toBeInTheDocument();
    expect(screen.queryByTestId('file-history-item-2000')).not.toBeInTheDocument();
  });

  it('空快照显示空态文案,三个动作禁用但清空仍可点', () => {
    setup({ snapshots: [], selectedId: null });

    expect(screen.getByText(/暂无历史版本/)).toBeInTheDocument();
    expect(screen.getByTestId('file-history-compare')).toBeDisabled();
    expect(screen.getByTestId('file-history-restore')).toBeDisabled();
    expect(screen.getByTestId('file-history-clear')).toBeDisabled();
  });

  it('打开且未选中时自动选中最新版(以最新快照 id 分发 onSelect)', () => {
    const { handlers } = setup({ selectedId: null });

    expect(handlers.onSelect).toHaveBeenCalledWith('2000');
  });

  it('点击行切换选中', async () => {
    const user = userEvent.setup();
    const { handlers } = setup();

    await user.click(screen.getByTestId('file-history-item-1000'));
    expect(handlers.onSelect).toHaveBeenCalledWith('1000');
  });

  it('「对比当前」携带选中快照 id 分发', async () => {
    const user = userEvent.setup();
    const { handlers } = setup();

    await user.click(screen.getByTestId('file-history-compare'));
    expect(handlers.onCompare).toHaveBeenCalledWith('2000');
  });

  it('「恢复内容」携带选中快照 id 分发', async () => {
    const user = userEvent.setup();
    const { handlers } = setup();

    await user.click(screen.getByTestId('file-history-restore'));
    expect(handlers.onRestore).toHaveBeenCalledWith('2000');
  });

  it('「清空历史」二段确认:首次点击仅进入确认态,再次点击才执行', async () => {
    const user = userEvent.setup();
    const { handlers } = setup();

    const clearBtn = screen.getByTestId('file-history-clear');
    expect(clearBtn).toHaveTextContent('清空历史');
    await user.click(clearBtn);
    // 第一次:不执行,按钮变为确认文案
    expect(handlers.onClear).not.toHaveBeenCalled();
    expect(clearBtn).toHaveTextContent('确认清空?');

    await user.click(clearBtn);
    expect(handlers.onClear).toHaveBeenCalledTimes(1);
  });

  it('「取消」分发 onCancel', async () => {
    const user = userEvent.setup();
    const { handlers } = setup();

    await user.click(screen.getByTestId('file-history-cancel'));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });
});
