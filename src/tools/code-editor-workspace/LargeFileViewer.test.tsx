/**
 * LargeFileViewer 单元测试 —— 虚拟滚动渲染 + 窗口缓存 + 锚点选取
 *
 * mock fileOps.readFileLines 返回受控行窗口,验证:
 * - 可视区行渲染(命中的窗口显示内容,未命中的为空占位)
 * - 扫描中/失败/就绪三态渲染
 * - goto 跳转(滚动位置)
 * - 复制选中(空选区提示)
 *
 * anchorForLine 纯函数直接覆盖:校准点选取边界。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import { anchorForLine, type LinesWindowResult } from './fileOps';
import { LargeFileViewer } from './LargeFileViewer';
import type { EditorTab } from './schema';

// mock IPC(行窗口读取受控)
vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
  listen: vi.fn(async () => () => {}),
  safeInvoke: vi.fn(),
}));

import { invokeCommand } from '@/lib/ipc';
const invokeMock = invokeCommand as unknown as ReturnType<typeof vi.fn>;

// mock 剪贴板
vi.mock('@/lib/clipboard', () => ({
  writeClipboardText: vi.fn(async () => true),
}));

// toast 断言需 act 包裹(sonner 内部有 transition)
const toastSpy = vi.spyOn(toast, 'info').mockImplementation(() => ({}) as never);
const toastSuccessSpy = vi.spyOn(toast, 'success').mockImplementation(() => ({}) as never);

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

function makeInfo() {
  return {
    size: 2214590991,
    encoding: 'utf-8',
    eol: 'lf',
    lineCount: 33722759,
    calibration: [
      [1, 0],
      [10_000_000, 600_000_000],
      [20_000_000, 1_300_000_000],
    ] as Array<[number, number]>,
  };
}

function windowFor(startLine: number, count = 5): LinesWindowResult {
  return {
    startLine,
    count,
    lines: Array.from({ length: count }, (_, i) => `line-${startLine + i}`),
    nextOffset: startLine * 65,
    nextLine: startLine + count,
    truncated: false,
  };
}

describe('anchorForLine(校准点选取)', () => {
  it('返回不超过目标行的最大校准点', () => {
    const calibration = makeInfo().calibration;
    // 目标行在第 1 与第 2 个校准点之间:选第 1 个
    expect(anchorForLine(calibration, 5_000_000)).toEqual({ offset: 0, line: 1 });
    // 目标行恰在校准点上:选该点
    expect(anchorForLine(calibration, 10_000_000)).toEqual({
      offset: 600_000_000,
      line: 10_000_000,
    });
    // 目标行超过最后一个点:选最后一点
    expect(anchorForLine(calibration, 33_000_000)).toEqual({
      offset: 1_300_000_000,
      line: 20_000_000,
    });
  });

  it('空校准点回退首行锚点 (0, 1)', () => {
    expect(anchorForLine([], 100)).toEqual({ offset: 0, line: 1 });
  });
});

describe('LargeFileViewer', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastSpy.mockClear();
    toastSuccessSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('扫描中:渲染进度占位(percent 展示)', () => {
    render(<LargeFileViewer tab={makeLargeTab({ largeFileProgress: 42 })} data-testid="lv" />);
    expect(screen.getByTestId('lv-progress')).toBeTruthy();
    expect(screen.getByTestId('lv-progress').textContent).toContain('42');
  });

  it('扫描失败:渲染错误占位', () => {
    render(
      <LargeFileViewer
        tab={makeLargeTab({ largeFileError: 'disk offline', largeFileProgress: null })}
        data-testid="lv"
      />,
    );
    expect(screen.getByTestId('lv-error')).toBeTruthy();
    expect(screen.getByTestId('lv-error').textContent).toContain('disk offline');
  });

  it('就绪:渲染可视区行,未加载窗口显示空占位', async () => {
    // 可视区从第 1 行起:窗口 1 命中返回内容
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'fs_read_file_lines') {
        const target = args.targetLine as number;
        return Promise.resolve(windowFor(target, 3));
      }
      return Promise.resolve({});
    });

    render(<LargeFileViewer tab={makeLargeTab({ largeFileInfo: makeInfo() })} data-testid="lv" />);

    // 窗口请求到达后端(锚点为校准点首项 (0,1))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'fs_read_file_lines',
        expect.objectContaining({ anchorOffset: 0, anchorLine: 1, targetLine: 1 }),
      );
    });
    // 窗口加载完成后:前 3 行显示内容
    await waitFor(() => {
      expect(screen.getAllByTestId('lv-line')[0].textContent).toContain('line-1');
    });
  });

  it('复制选中:空选区提示,不写剪贴板', async () => {
    render(<LargeFileViewer tab={makeLargeTab({ largeFileInfo: makeInfo() })} data-testid="lv" />);
    fireEvent.click(screen.getByTestId('lv-copy'));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('选中'));
    });
  });

  it('转到行弹窗可打开(搜索框可定位)', async () => {
    render(<LargeFileViewer tab={makeLargeTab({ largeFileInfo: makeInfo() })} data-testid="lv" />);
    fireEvent.click(screen.getByTestId('lv-goto'));
    await waitFor(() => {
      expect(screen.getByTestId('lv-goto-pick-search')).toBeTruthy();
    });
  });

  it('超长行截断:窗口 truncated 标记在截断行展示截断徽章', async () => {
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'fs_read_file_lines') {
        const target = args.targetLine as number;
        return Promise.resolve({
          ...windowFor(target, 2),
          lines: ['short', 'x'.repeat(100)],
          truncated: true,
        });
      }
      return Promise.resolve({});
    });

    render(
      <LargeFileViewer
        tab={makeLargeTab({
          largeFileInfo: {
            size: 1000,
            encoding: 'utf-8',
            eol: 'lf',
            lineCount: 50,
            calibration: [[1, 0]] as Array<[number, number]>,
          },
        })}
        data-testid="lv"
      />,
    );
    // 窗口落地后:第 2 行(被截断的末行)带「已截断」标记。
    // 用小文件(不触发行分组)保证一单元一行
    await waitFor(() => {
      const lines = screen.getAllByTestId('lv-line');
      expect(lines[1].textContent).toContain('已截断');
    });
  });

  it('行分组:超大行数(2 亿行)时单元合并渲染,gutter 标注行号段', async () => {
    // 2 亿行 × 19px ≈ 38 亿px,超过 MAX_SCROLL_PX(16M)→ 分组(32 行/单元)
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'fs_read_file_lines') {
        const target = args.targetLine as number;
        return Promise.resolve(windowFor(target, 3));
      }
      return Promise.resolve({});
    });

    render(
      <LargeFileViewer
        tab={makeLargeTab({
          largeFileInfo: {
            size: 20 * 1024 * 1024 * 1024,
            encoding: 'utf-8',
            eol: 'lf',
            lineCount: 200_000_000,
            calibration: [[1, 0]] as Array<[number, number]>,
          },
        })}
        data-testid="lv"
      />,
    );
    // 首单元:行 1,组 32 行,gutter 标「1+32」且展示组首行内容
    await waitFor(() => {
      const first = screen.getAllByTestId('lv-line')[0];
      expect(first.textContent).toContain('1+32');
      expect(first.textContent).toContain('line-1');
    });
  });
});
