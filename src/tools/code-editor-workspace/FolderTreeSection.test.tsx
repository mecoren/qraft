/**
 * FolderTreeSection 单元测试 —— 左栏「文件夹」树分组
 *
 * 验证:
 * - 无打开文件夹时整组不渲染(不产生空分组头)
 * - 分组头展示标题与数量徽章,点击可折叠/展开整组(折叠不清缓存)
 * - 目录行点击触发 onToggleDir;未展开目录不拉取子项
 * - 懒加载:展开目录经 fs_read_dir 拉取子项,会话内只拉一次;
 *   加载期间显示「加载中…」占位
 * - 文件行点击触发 onOpenFile;激活文件高亮(aria-current)
 * - 根行关闭按钮触发 onCloseFolder 且不冒泡为展开切换
 * - 读取失败:toast.error 提示且目录节点保留在树中(不剔除)
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderTreeSection, type FolderTreeSectionProps } from './FolderTreeSection';

// mock IPC 封装层:组件经 readDirectory 懒加载目录子项
vi.mock('./fileOps', () => ({
  readDirectory: vi.fn(),
}));

// mock sonner:仅断言 toast.error 被调用,不渲染真实 Toaster
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { readDirectory } from './fileOps';
import { toast } from 'sonner';

const readDirectoryMock = vi.mocked(readDirectory);
const toastErrorMock = vi.mocked(toast.error);

/** 根目录子项(fs_read_dir 返回形态:目录在前、名称不分大小写升序) */
const ROOT_CHILDREN = [
  { name: 'src', path: 'C:\\proj\\src', isDir: true },
  { name: 'README.md', path: 'C:\\proj\\README.md', isDir: false },
];

function baseProps(): FolderTreeSectionProps {
  return {
    folders: [{ rootPath: 'C:\\proj' }],
    expandedDirs: [],
    activeTabPath: null,
    onToggleDir: vi.fn(),
    onCloseFolder: vi.fn(),
    onOpenFile: vi.fn(),
    'data-testid': 'sidebar-folder-tree',
  };
}

function renderTree(props: Partial<FolderTreeSectionProps> = {}) {
  const merged = { ...baseProps(), ...props };
  return render(<FolderTreeSection {...merged} />);
}

beforeEach(() => {
  readDirectoryMock.mockReset();
  toastErrorMock.mockClear();
});

describe('FolderTreeSection 渲染', () => {
  it('无打开文件夹时整组不渲染', () => {
    const { container } = renderTree({ folders: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('渲染分组头、数量徽章与根节点', async () => {
    readDirectoryMock.mockResolvedValue(ROOT_CHILDREN);
    renderTree({ expandedDirs: ['C:\\proj'] });

    expect(screen.getByText('文件夹')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-folder-tree-folder-count')).toHaveTextContent('1');
    // 根节点以末段名称显示(用 testid 定位:行内还嵌套 role=button 的关闭键)
    expect(screen.getByTestId('sidebar-folder-tree-node-proj')).toBeInTheDocument();
    // 展开的根自动补载子项
    await waitFor(() => expect(screen.getByText('src')).toBeInTheDocument());
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('未展开的目录不显示子项,也不发起读取', () => {
    renderTree({ expandedDirs: [] });
    expect(screen.getByText('proj')).toBeInTheDocument();
    expect(screen.queryByText('src')).not.toBeInTheDocument();
    expect(readDirectoryMock).not.toHaveBeenCalled();
  });
});

describe('FolderTreeSection 展开/折叠交互', () => {
  it('点击目录行触发 onToggleDir(传入目录绝对路径)', async () => {
    const onToggleDir = vi.fn();
    const user = userEvent.setup();
    renderTree({ onToggleDir });

    await user.click(screen.getByText('proj'));
    expect(onToggleDir).toHaveBeenCalledWith('C:\\proj');
  });

  it('分组头点击折叠整组,再点恢复;折叠不重新拉取子项', async () => {
    readDirectoryMock.mockResolvedValue(ROOT_CHILDREN);
    const user = userEvent.setup();
    const { rerender } = renderTree({ expandedDirs: ['C:\\proj'] });

    await waitFor(() => expect(screen.getByText('src')).toBeInTheDocument());
    expect(readDirectoryMock).toHaveBeenCalledTimes(1);

    // 折叠整组:子树从 DOM 移除,分组仍存在(标题可见)
    await user.click(screen.getByTestId('sidebar-folder-tree-folder-header'));
    expect(screen.queryByText('src')).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar-folder-tree-folder-section')).toBeInTheDocument();

    // 再点恢复:loadedRef 命中缓存,不重复 IPC
    await user.click(screen.getByTestId('sidebar-folder-tree-folder-header'));
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(readDirectoryMock).toHaveBeenCalledTimes(1);

    rerender(<FolderTreeSection {...baseProps()} expandedDirs={['C:\\proj']} />);
    expect(readDirectoryMock).toHaveBeenCalledTimes(1);
  });

  it('懒加载:同一目录会话内只调用一次 readDirectory', async () => {
    readDirectoryMock.mockResolvedValue(ROOT_CHILDREN);
    const props = baseProps();
    const { rerender } = render(<FolderTreeSection {...props} expandedDirs={['C:\\proj']} />);

    await waitFor(() => expect(screen.getByText('src')).toBeInTheDocument());
    rerender(<FolderTreeSection {...props} expandedDirs={['C:\\proj']} />);
    await waitFor(() => expect(readDirectoryMock).toHaveBeenCalledTimes(1));
  });

  it('加载期间显示「加载中…」占位', async () => {
    readDirectoryMock.mockReturnValue(new Promise(() => {}));
    renderTree({ expandedDirs: ['C:\\proj'] });
    expect(await screen.findByText(/加载中/)).toBeInTheDocument();
  });

  it('读取失败:toast.error 提示且根节点保留在树中(可重试)', async () => {
    readDirectoryMock.mockRejectedValue(new Error('path not authorized'));
    const view = renderTree({ expandedDirs: ['C:\\proj'] });

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('path not authorized'));
    // 失败不做剔除:根节点仍在
    expect(screen.getByText('proj')).toBeInTheDocument();

    // 重试路径:父层再次展开会传入新的 expandedDirs 引用,
    // effect 重新执行;失败时已清除「已加载」标记 → 允许重新发起读取
    readDirectoryMock.mockResolvedValue(ROOT_CHILDREN);
    view.rerender(<FolderTreeSection {...baseProps()} expandedDirs={['C:\\proj']} />);
    await waitFor(() => expect(screen.getByText('src')).toBeInTheDocument());
    expect(readDirectoryMock).toHaveBeenCalledTimes(2);
  });
});

describe('FolderTreeSection 文件与文件夹动作', () => {
  it('点击文件行触发 onOpenFile(传入文件绝对路径)', async () => {
    readDirectoryMock.mockResolvedValue(ROOT_CHILDREN);
    const onOpenFile = vi.fn();
    const user = userEvent.setup();
    renderTree({ expandedDirs: ['C:\\proj'], onOpenFile });

    await waitFor(() => expect(screen.getByText('README.md')).toBeInTheDocument());
    await user.click(screen.getByText('README.md'));
    expect(onOpenFile).toHaveBeenCalledWith('C:\\proj\\README.md');
  });

  it('激活文件高亮:activeTabPath 匹配的文件行带 aria-current', async () => {
    readDirectoryMock.mockResolvedValue(ROOT_CHILDREN);
    renderTree({
      expandedDirs: ['C:\\proj'],
      activeTabPath: 'C:\\proj\\README.md',
    });

    const row = await screen.findByTestId('sidebar-folder-tree-node-README.md');
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('根行关闭按钮触发 onCloseFolder,且不冒泡为展开切换', async () => {
    const onToggleDir = vi.fn();
    const onCloseFolder = vi.fn();
    const user = userEvent.setup();
    renderTree({ onToggleDir, onCloseFolder });

    const closeBtn = screen.getByTestId('sidebar-folder-tree-close-proj');
    await user.click(closeBtn);
    expect(onCloseFolder).toHaveBeenCalledWith('C:\\proj');
    expect(onToggleDir).not.toHaveBeenCalled();
  });
});

describe('FolderTreeSection 高度策略(fillHeight)', () => {
  it('默认(下方有对比差异):内容自适应,section 带 max-h 封顶语义与底部分隔线', () => {
    renderTree({ fillHeight: false });

    const section = screen.getByTestId('sidebar-folder-tree-folder-section');
    expect(section.className).toContain('flex-initial');
    // 分隔线仅在自适应模式保留(撑满模式下方无分组无需分隔)
    expect(section.className).toContain('border-b');
    const scroll = screen.getByTestId('sidebar-folder-tree-tree-scroll');
    expect(scroll.className).toContain('max-h-64');
    expect(scroll.className).not.toContain('flex-1');
  });

  it('fillHeight=true(下方无对比差异):去掉限高并撑满剩余空间', () => {
    renderTree({ fillHeight: true });

    const section = screen.getByTestId('sidebar-folder-tree-folder-section');
    expect(section.className).toContain('flex-1');
    expect(section.className).not.toContain('border-b');
    const scroll = screen.getByTestId('sidebar-folder-tree-tree-scroll');
    expect(scroll.className).toContain('flex-1');
    expect(scroll.className).not.toContain('max-h-64');
  });
});
