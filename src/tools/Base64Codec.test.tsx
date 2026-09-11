import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

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
    CommandError,
  };
});

// react-resizable-panels 在 jsdom 下依赖 ResizeObserver 内部布局,渲染静态面板以保留 children
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

import { Base64Codec } from './Base64Codec';

function renderTool() {
  return render(<Base64Codec toolId="base64_codec" metadata={null as never} />);
}

/** 在当前工具内定位输入 CodeEditor 的 textarea */
function inputEditor() {
  return screen.getByTestId('input').querySelector('textarea')!;
}

/** 在当前工具内定位输出 CodeEditor 的 textarea */
function outputEditor() {
  return screen.getByTestId('output').querySelector('textarea')!;
}

/** radix Tabs 在 onMouseDown 时激活 tab,需用 mouseDown 而非 click */
function clickTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }));
}

describe('Base64Codec 统一转换工具', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders direction tabs, mode select and dual editors', () => {
    renderTool();
    expect(screen.getByRole('tab', { name: /编码/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /解码/i })).toBeInTheDocument();
    expect(screen.getByTestId('input')).toBeInTheDocument();
    expect(screen.getByTestId('output')).toBeInTheDocument();
  });

  it('defaults to decode + text and calls tool_execute with text mode', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'hello',
      extra: null,
      meta: { duration_ms: 1, input_bytes: 8, output_bytes: 5 },
      alerts: [],
    });

    renderTool();
    const editor = inputEditor();
    fireEvent.change(editor, { target: { value: 'aGVsbG8=' } });

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'base64_codec',
        input: {
          text: 'aGVsbG8=',
          params: { action: 'decode', mode: 'text', url_safe: false, strict: false },
        },
      });
    });
    expect(outputEditor().value).toBe('hello');
  });

  it('switches to encode direction and encodes with text mode', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'aGVsbG8=',
      extra: null,
      meta: null,
      alerts: [],
    });

    renderTool();
    clickTab(/编码/i);
    fireEvent.change(inputEditor(), { target: { value: 'hello' } });

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'base64_codec',
        input: {
          text: 'hello',
          params: { action: 'encode', mode: 'text', url_safe: false, strict: false },
        },
      });
    });
  });

  it('encodes hex mode with mode param', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'SGVsbG8=',
      extra: null,
      meta: null,
      alerts: [],
    });

    renderTool();
    // 切到编码方向后再选择 Hex 编码模式
    clickTab(/编码/i);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Hex' }));

    fireEvent.change(inputEditor(), { target: { value: '48656c6c6f' } });

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'base64_codec',
        input: {
          text: '48656c6c6f',
          params: { action: 'encode', mode: 'hex', url_safe: false, strict: false },
        },
      });
    });
  });

  it('decodes hex with uppercase switch', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '48656C6C6F',
      extra: null,
      meta: null,
      alerts: [],
    });

    renderTool();
    clickTab(/解码/i);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Hex' }));

    // 打开大写开关
    fireEvent.click(screen.getByRole('switch', { name: /大写/i }));
    fireEvent.change(inputEditor(), { target: { value: 'aGVsbG8=' } });

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'base64_codec',
        input: {
          text: 'aGVsbG8=',
          params: {
            action: 'decode',
            mode: 'hex',
            hex_case: 'upper',
            url_safe: false,
            strict: false,
          },
        },
      });
    });
  });

  it('shows error text in output when invoke fails', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'invalid base64'),
    );

    renderTool();
    fireEvent.change(inputEditor(), { target: { value: '!!!' } });

    await waitFor(() => {
      expect(outputEditor().value).toContain('invalid base64');
    });
  });

  it('renders file dropzone for encode image mode', async () => {
    renderTool();
    clickTab(/编码/i);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: '图片' }));

    expect(screen.getByTestId('b64-dropzone')).toBeInTheDocument();
    expect(screen.getByTestId('b64-file')).toBeInTheDocument();
  });

  it('encodes a file to data url and shows output', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    // 模拟 FileReader.readAsDataURL(仅替换本测试范围内的全局,不调用 unstubAllGlobals
    // 以免恢复 setup.ts 中 stub 的 localStorage 导致 afterEach 崩溃)
    const readAsDataURL = vi.fn();
    class FakeFileReader {
      result = 'data:text/plain;base64,aGVsbG8=';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        readAsDataURL();
        // 异步触发 onload
        queueMicrotask(() => this.onload?.());
      }
    }
    const originalFileReader = globalThis.FileReader;
    vi.stubGlobal('FileReader', FakeFileReader);

    renderTool();
    clickTab(/编码/i);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: '文件' }));

    const input = screen.getByTestId('b64-file') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(readAsDataURL).toHaveBeenCalled();
      expect(outputEditor().value).toBe('data:text/plain;base64,aGVsbG8=');
    });

    // 恢复原 FileReader,避免影响后续测试
    globalThis.FileReader = originalFileReader;
  });

  it('decodes binary and shows image preview', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '',
      extra: { base64: 'iVBORw0KGgo=', mime: 'image/png', bytes: 8 },
      meta: null,
      alerts: [],
    });

    renderTool();
    clickTab(/解码/i);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: '图片' }));

    fireEvent.change(inputEditor(), { target: { value: 'iVBORw0KGgo=' } });

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'base64_codec',
        input: {
          text: 'iVBORw0KGgo=',
          params: { action: 'decode', mode: 'binary', url_safe: false, strict: false },
        },
      });
    });
    const img = await screen.findByTestId('b64-preview');
    // 组件使用 Blob URL(而非 data: URL)做二进制预览,src 为 blob: 形式。
    // Blob URL 在 useEffect 内通过 setTimeout(0) 异步写入,findByTestId 只保证
    // 元素出现、不保证 src 已就绪,故需 waitFor 等待属性到位(避免 null 竞态)。
    await waitFor(() => {
      expect(img.getAttribute('src')).toMatch(/^blob:/);
    });
  });

  it('binary preview must not nest inside a radix scroll-area viewport wrapper', async () => {
    // Radix ScrollArea 的 Viewport 会给内容包一层 display:table 的 div(高度不定),
    // 会打断 h-full / max-h-full 的百分比高度链:图片/视频按原始尺寸渲染被裁、
    // PDF iframe 高度塌缩、提示与下载卡片无法垂直居中(截图反馈的「解码的没显示全」)。
    // 契约:预览主体必须放在普通 overflow 容器内(同 QrcodeTool 生成页签模式)。
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '',
      extra: { base64: 'iVBORw0KGgo=', mime: 'image/png', bytes: 8 },
      meta: null,
      alerts: [],
    });

    renderTool();
    clickTab(/解码/i);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: '图片' }));
    fireEvent.change(inputEditor(), { target: { value: 'iVBORw0KGgo=' } });

    await screen.findByTestId('b64-preview');
    const preview = screen.getByTestId('b64-preview')!;
    const viewport = preview.closest('[data-radix-scroll-area-viewport]');
    expect(viewport).toBeNull();
  });

  it('calls fs_save_bytes when clicking save in binary preview', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '',
      extra: { base64: 'iVBORw0KGgo=', mime: 'image/png', bytes: 8 },
      meta: null,
      alerts: [],
    });

    renderTool();
    clickTab(/解码/i);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: '图片' }));
    fireEvent.change(inputEditor(), { target: { value: 'iVBORw0KGgo=' } });

    const saveBtn = await screen.findByTestId('b64-save');
    // 等待二进制解码完成,另存为按钮可用
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('fs_save_bytes', {
        fileName: 'decoded.png',
        base64: 'iVBORw0KGgo=',
        mime: 'image/png',
      });
    });
  });

  it('switching mode preserves the input text', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'hello',
      extra: null,
      meta: null,
      alerts: [],
    });

    renderTool();
    fireEvent.change(inputEditor(), { target: { value: 'aGVsbG8=' } });

    // 切换到 ASCII 模式后,输入内容应保留(仅清空输出与预览)
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'ASCII' }));

    expect(inputEditor().value).toBe('aGVsbG8=');
  });

  it('auto-runs when switching text mode with non-empty input', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'bG9naW46cGFzcw==',
      extra: null,
      meta: null,
      alerts: [],
    });

    renderTool();
    fireEvent.change(inputEditor(), { target: { value: 'aGVsbG8=' } });

    // 切换到 ASCII 模式后,输入保留且自动触发解码
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'ASCII' }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'base64_codec',
        input: {
          text: 'aGVsbG8=',
          params: { action: 'decode', mode: 'ascii', url_safe: false, strict: false },
        },
      });
    });
  });

  it('auto-runs when switching file decode mode with non-empty input', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '',
      extra: { base64: 'iVBORw0KGgo=', mime: 'image/png', bytes: 8 },
      meta: null,
      alerts: [],
    });

    renderTool();
    clickTab(/解码/i);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: '图片' }));
    fireEvent.change(inputEditor(), { target: { value: 'iVBORw0KGgo=' } });

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'base64_codec',
        input: {
          text: 'iVBORw0KGgo=',
          params: { action: 'decode', mode: 'binary', url_safe: false, strict: false },
        },
      });
    });

    // 切换到音频模式:输入保留,自动再次触发解码
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: '音频' }));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledTimes(2);
      expect(invokeCommand).toHaveBeenLastCalledWith('tool_execute', {
        toolId: 'base64_codec',
        input: {
          text: 'iVBORw0KGgo=',
          params: { action: 'decode', mode: 'binary', url_safe: false, strict: false },
        },
      });
    });
  });

  // —— 严格模式 / 错误定位 chip / MIME 分发 / 宽松回退提示 ——

  it('passes strict param when strict switch is on', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'hello',
      extra: null,
      meta: null,
      alerts: [],
    });

    renderTool();
    // 默认解码方向 + text 模式,打开严格开关
    fireEvent.click(screen.getByRole('switch', { name: /严格模式/i }));
    fireEvent.change(inputEditor(), { target: { value: 'aGVsbG8=' } });

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'base64_codec',
        input: {
          text: 'aGVsbG8=',
          params: { action: 'decode', mode: 'text', url_safe: false, strict: true },
        },
      });
    });
  });

  it('does not show strict switch in encode direction', () => {
    renderTool();
    clickTab(/编码/i);
    expect(screen.queryByRole('switch', { name: /严格模式/i })).toBeNull();
  });

  it('renders error location chip with L:C when decode error carries offset', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    // 8 个空白后跟非法字符 '!':Rust 侧回映原始偏移 [offset=8]
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'invalid base64 symbol 0x21 at index 0 [offset=8]'),
    );

    renderTool();
    fireEvent.change(inputEditor(), { target: { value: '        !abc' } });

    const chip = await screen.findByTestId('error-location');
    // 偏移 8 在单行输入内 → L1:C9(1-based 列)
    expect(chip.textContent).toContain('L1:C9');

    // 点击 chip:jsdom shim 下跳转意图记录到 textarea.__lastGoto
    fireEvent.click(chip);
    const shim = screen.getByTestId('input').querySelector('textarea') as
      (HTMLTextAreaElement & { __lastGoto?: { line: number; column: number } }) | null;
    expect(shim?.__lastGoto).toEqual({ line: 1, column: 9 });
  });

  it('renders no error chip when error lacks offset marker', async () => {
    const { invokeCommand, CommandError } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CommandError('ERR_PARSE_FAILED', 'invalid base64 length 5'),
    );

    renderTool();
    fireEvent.change(inputEditor(), { target: { value: 'aGVsb' } });

    // 长度类错误无 offset 标记,不渲染 chip
    await waitFor(() => {
      expect(outputEditor().value).toContain('invalid base64 length');
    });
    expect(screen.queryByTestId('error-location')).toBeNull();
  });

  it('shows warning alert when backend falls back to latin-1', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'é',
      extra: null,
      meta: null,
      alerts: [
        {
          level: 'warning',
          message: 'decoded bytes are not valid utf8; displayed as latin-1',
        },
      ],
    });

    renderTool();
    fireEvent.change(inputEditor(), { target: { value: '6Q==' } });

    await waitFor(() => {
      expect(screen.getByTestId('output-warning').textContent).toContain('utf8');
    });
    expect(screen.queryByTestId('error-location')).toBeNull();
  });

  it('previews by sniffed mime instead of selected mode', async () => {
    // 选「图片」模式但后端嗅探出 PDF:应渲染 PDF iframe 而非 <img>
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '',
      extra: { base64: 'JVBERi0=', mime: 'application/pdf', bytes: 5 },
      meta: null,
      alerts: [],
    });

    renderTool();
    clickTab(/解码/i);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: '图片' }));
    fireEvent.change(inputEditor(), { target: { value: 'JVBERi0=' } });

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'base64_codec',
        input: {
          text: 'JVBERi0=',
          params: { action: 'decode', mode: 'binary', url_safe: false, strict: false },
        },
      });
    });
    const preview = await screen.findByTestId('b64-preview');
    // PDF 嗅探结果应渲染 iframe(而非裂开的 img)
    expect(preview.tagName).toBe('IFRAME');
  });

  it('falls back to download card for unknown sniffed mime', async () => {
    // 选「音频」模式但嗅探为 octet-stream:渲染下载卡片(含 mime 徽标)
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '',
      extra: { base64: 'aGVsbG8=', mime: 'application/octet-stream', bytes: 5 },
      meta: null,
      alerts: [],
    });

    renderTool();
    clickTab(/解码/i);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: '音频' }));
    fireEvent.change(inputEditor(), { target: { value: 'aGVsbG8=' } });

    const preview = await screen.findByTestId('b64-preview');
    expect(preview.textContent).toContain('decoded.bin');
    expect(preview.textContent).toContain('application/octet-stream');
  });
});
