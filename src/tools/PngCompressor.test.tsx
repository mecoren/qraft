import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PngCompressor } from './PngCompressor';

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children: React.ReactNode }) => (
    <div data-testid="select-box" data-value={value}>
      <button type="button" data-testid="select-toggle" onClick={() => onValueChange?.('0')}>
        toggle
      </button>
      {children}
    </div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <div />,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// ipc mock:png_compress 返回可控结果
const pngCompressMock = vi.fn();
vi.mock('@/lib/ipc', () => ({
  invokeCommand: (cmd: string, args: { params: Record<string, unknown> }) => {
    if (cmd === 'png_compress') return pngCompressMock(args);
    throw new Error(`unexpected command: ${cmd}`);
  },
}));

// FileReader stub
const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
class StubFileReader {
  result: string | ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  readAsDataURL(): void {
    this.result = DATA_URL;
    queueMicrotask(() => this.onload?.());
  }
}
vi.stubGlobal('FileReader', StubFileReader);

describe('PngCompressor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('初始渲染:拖放区 + 无损默认模式', () => {
    render(<PngCompressor toolId="png_compressor" metadata={null as never} />);
    expect(screen.getByTestId('png-compressor')).toBeInTheDocument();
    expect(screen.getByTestId('pc-dropzone')).toBeInTheDocument();
    expect(screen.getByTestId('pc-compress')).toBeDisabled();
  });

  it('非 PNG 文件被拒绝', () => {
    render(<PngCompressor toolId="png_compressor" metadata={null as never} />);
    const input = screen.getByTestId('pc-file') as HTMLInputElement;
    const jpg = new File([new Uint8Array(4)], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [jpg] } });
    expect(screen.queryByTestId('pc-preview')).not.toBeInTheDocument();
  });

  it('加载 PNG 后启用压缩按钮', async () => {
    render(<PngCompressor toolId="png_compressor" metadata={null as never} />);
    const input = screen.getByTestId('pc-file') as HTMLInputElement;
    const png = new File([new Uint8Array(4)], 'img.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [png] } });
    await waitFor(() => {
      expect(screen.getByTestId('pc-compress')).toBeEnabled();
    });
    expect(screen.getByTestId('pc-original-pane')).toBeInTheDocument();
  });

  it('压缩成功:展示前后对比与下载按钮', async () => {
    pngCompressMock.mockResolvedValue({
      base64: 'iVBORw0KGgo=',
      inputBytes: 1000,
      outputBytes: 400,
      colorsUsed: null,
      durationMs: 12,
    });
    render(<PngCompressor toolId="png_compressor" metadata={null as never} />);
    const input = screen.getByTestId('pc-file') as HTMLInputElement;
    const png = new File([new Uint8Array(4)], 'img.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [png] } });
    await waitFor(() => expect(screen.getByTestId('pc-compress')).toBeEnabled());
    fireEvent.click(screen.getByTestId('pc-compress'));
    await waitFor(() => {
      expect(screen.getByTestId('pc-compressed-preview')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pc-result')).toHaveTextContent(/400/);
    expect(screen.getByTestId('pc-result')).toHaveTextContent(/节省 60%/);
    expect(screen.getByTestId('pc-download')).toBeInTheDocument();
    // 调用参数校验:无损模式传 level
    expect(pngCompressMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ lossless: true, level: 2 }),
      }),
    );
  });

  it('压缩失败:错误 toast,不渲染结果', async () => {
    pngCompressMock.mockRejectedValue(new Error('bad png'));
    render(<PngCompressor toolId="png_compressor" metadata={null as never} />);
    const input = screen.getByTestId('pc-file') as HTMLInputElement;
    const png = new File([new Uint8Array(4)], 'img.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [png] } });
    await waitFor(() => expect(screen.getByTestId('pc-compress')).toBeEnabled());
    fireEvent.click(screen.getByTestId('pc-compress'));
    const { toast } = await import('sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('bad png'));
    });
    expect(screen.queryByTestId('pc-compressed-preview')).not.toBeInTheDocument();
  });
});
