import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/ipc', () => {
  class CommandError extends Error {
    readonly code: string;
    readonly details?: unknown;
    constructor(code: string, message: string, details?: unknown) {
      super(message);
      this.name = 'CommandError';
      this.code = code;
      this.details = details;
    }
  }
  return {
    invokeCommand: vi.fn(),
    safeInvoke: vi.fn(async () => ({ ok: true, value: 'task-1' })),
    CommandError,
  };
});

// 统一复制反馈经 sonner 弹出;组件测试不挂载 <Toaster>,改以 mock 断言文案
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// webview 拖放订阅 mock(FolderAnalyzer.test 同款;jsdom 无 __TAURI_INTERNALS__,
// isTauriRuntime()=false 时不触达,该 mock 仅防御性存在)
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async () => () => {}),
  }),
}));

import { HashCalculator } from './HashCalculator';
import { toast } from 'sonner';
import { clearInputAction, copyOutputAction, executeToolAction } from '@/lib/tool-actions';
import { useShortcut } from '@/hooks/useShortcut';
import { useToolStateStore } from '@/store/toolStateStore';

/** 镜像 App.tsx 的快捷键接线(单测不挂载整个 App) */
function ShortcutHarness(): null {
  useShortcut('execute_tool', () => executeToolAction(), []);
  useShortcut('clear_input', () => clearInputAction(), []);
  useShortcut('copy_output', () => copyOutputAction(), []);
  return null;
}

const HASH_OK = {
  text: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  meta: { input_bytes: 5, output_bytes: 64, duration_ms: 0 },
};

describe('HashCalculator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders algorithm select, text input and compute button', () => {
    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);
    expect(screen.getByTestId('input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /计算/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls tool_execute with text + algorithm=sha256 by default', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      meta: { input_bytes: 5, output_bytes: 64, duration_ms: 0 },
    });

    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /计算/ }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'hash_calculator',
        input: { text: 'hello', params: { algorithm: 'sha256' } },
      });
    });
  });

  it('shows error alert when invalid algorithm is used', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError(
        'ERR_INVALID_INPUT',
        "algorithm must be one of md5/sha1/sha256/sha512/blake3, got 'crc32'",
      ),
    );

    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /计算/ }));

    await waitFor(() => {
      expect(screen.getByText(/INVALID_INPUT/i)).toBeInTheDocument();
    });
  });

  it('copies hash result with unified feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(HASH_OK);

    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /计算/ }));

    // 输出编辑器工具栏出现复制按钮(哈希是最典型的待复制内容)
    fireEvent.click(await screen.findByTestId('copy-hash'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
    });
    expect(toast.success).toHaveBeenCalledWith(
      '已复制到剪贴板',
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it('Ctrl+Enter 快捷键触发计算', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(HASH_OK);

    useToolStateStore.setState({ currentToolId: 'hash_calculator' });
    render(
      <>
        <ShortcutHarness />
        <HashCalculator toolId="hash_calculator" metadata={null as never} />
      </>,
    );
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'hash_calculator',
        input: { text: 'hello', params: { algorithm: 'sha256' } },
      });
    });
  });

  it('Ctrl+L 清空输入与输出', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(HASH_OK);

    useToolStateStore.setState({ currentToolId: 'hash_calculator' });
    render(
      <>
        <ShortcutHarness />
        <HashCalculator toolId="hash_calculator" metadata={null as never} />
      </>,
    );
    const editor = screen.getByTestId('input').querySelector('textarea')! as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /计算/ }));
    await screen.findByTestId('copy-hash');

    fireEvent.keyDown(window, { key: 'L', ctrlKey: true });
    await waitFor(() => {
      expect(editor.value).toBe('');
      expect(screen.queryByTestId('copy-hash')).not.toBeInTheDocument();
    });
  });

  it('Ctrl+Shift+C 复制哈希输出', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(HASH_OK);

    useToolStateStore.setState({ currentToolId: 'hash_calculator' });
    render(
      <>
        <ShortcutHarness />
        <HashCalculator toolId="hash_calculator" metadata={null as never} />
      </>,
    );
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /计算/ }));
    await screen.findByTestId('copy-hash');

    fireEvent.keyDown(window, { key: 'C', ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
    });
  });

  // —— 文件哈希模式(流式任务)——

  /** radix Tabs 在 onMouseDown 时激活 tab,需用 mouseDown 而非 click(Base64Codec.test 同款) */
  function switchToFileMode(): void {
    fireEvent.mouseDown(screen.getByTestId('hash-mode-file'));
  }

  it('切到文件模式显示拖放区与选择按钮,默认不触发任何执行', () => {
    const { invokeCommand } = { invokeCommand: undefined };
    void invokeCommand;
    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);

    switchToFileMode();

    expect(screen.getByTestId('hash-file-panel')).toBeInTheDocument();
    expect(screen.getByTestId('hash-dropzone')).toBeInTheDocument();
    expect(screen.getByTestId('hash-open')).toBeInTheDocument();
  });

  it('选择文件后启动流式任务并展示进度与结果', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation((async (
      cmd: string,
    ) => {
      if (cmd === 'fs_pick_file_path') {
        return { path: 'C:/tmp/setup.exe', size: 10485760 };
      }
      if (cmd === 'tool_cancel') return true;
      return HASH_OK;
    }) as never);

    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);
    switchToFileMode();
    fireEvent.click(screen.getByTestId('hash-open'));

    // 启动流式任务:tool_execute_stream 携带路径 + 当前算法
    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('fs_pick_file_path', {});
    });
    const { safeInvoke } = await import('@/lib/ipc');
    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('tool_execute_stream', {
        toolId: 'hash_calculator',
        filePath: 'C:/tmp/setup.exe',
        text: undefined,
        params: { algorithm: 'sha256' },
      });
    });
    // 文件信息区展示路径;任务 running 时显示进度与取消按钮
    expect(await screen.findByTestId('hash-file-info')).toHaveTextContent('setup.exe');
    expect(screen.getByTestId('hash-progress')).toBeInTheDocument();
    expect(screen.getByTestId('hash-cancel')).toBeInTheDocument();
  });

  it('流式任务失败展示内联错误', async () => {
    const { safeInvoke, invokeCommand } = await import('@/lib/ipc');
    (safeInvoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: 'ERR_PERMISSION_DENIED', message: 'path not authorized' },
    });
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'C:/x.bin',
      size: 1,
    });

    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);
    switchToFileMode();
    fireEvent.click(screen.getByTestId('hash-open'));

    expect(await screen.findByTestId('hash-file-error')).toHaveTextContent('ERR_PERMISSION_DENIED');
  });
});
