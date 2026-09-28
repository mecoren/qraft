/**
 * QrcodeTool 组件测试:生成失败不再静默(reject → 预览区失败占位)、
 * 解码结果区「发送到…」菜单接线、空文本不触发生成;
 * 默认停留在读取页,截图粘贴 / 任意落点拖放图片都直接识别
 * (含右侧结果编辑器落点,不被 Monaco 吞掉)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// jsdom 无 canvas:qrcode 库 toDataURL 走 canvas 上下文会失败,统一 mock
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(),
    toString: vi.fn(),
  },
}));

vi.mock('jsqr', () => ({
  default: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { QrcodeTool } from './QrcodeTool';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { toast } from 'sonner';

const toDataURL = QRCode.toDataURL as unknown as ReturnType<typeof vi.fn>;
const jsQRMock = jsQR as unknown as ReturnType<typeof vi.fn>;
const toastSuccess = toast.success as unknown as ReturnType<typeof vi.fn>;
const toastError = toast.error as unknown as ReturnType<typeof vi.fn>;

// jsdom 无 Image 解码:stub 构造器,src 赋值后微任务触发 onload
class StubImage {
  _src = '';
  naturalWidth = 100;
  naturalHeight = 50;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  get src(): string {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    queueMicrotask(() => this.onload?.());
  }
}
vi.stubGlobal('Image', StubImage);

// FileReader stub:readAsDataURL 给固定 data URL
const DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
class StubFileReader {
  result: string | ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(): void {
    this.result = DATA_URL;
    queueMicrotask(() => this.onload?.());
  }
}
vi.stubGlobal('FileReader', StubFileReader);

// canvas stub:jsdom 无 2d context,伪造 drawImage + getImageData 供 jsQR 链路跑通
const fakeCtx = {
  drawImage: vi.fn(),
  getImageData: vi.fn(() => ({
    data: new Uint8ClampedArray(4),
    width: 1,
    height: 1,
  })),
};
HTMLCanvasElement.prototype.getContext = ((_contextId: string, _options?: unknown) =>
  fakeCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext;

/** radix Tabs 在 onMouseDown 时激活 tab,需用 mouseDown 而非 click(Base64Codec.test 同款) */
function switchToScanMode(): void {
  fireEvent.mouseDown(screen.getByTestId('qr-tab-scan'));
}

function switchToGenerateMode(): void {
  fireEvent.mouseDown(screen.getByTestId('qr-tab-generate'));
}

function typeInput(value: string): void {
  const editor = screen.getByTestId('qr-text').querySelector('textarea')!;
  fireEvent.change(editor, { target: { value } });
}

function pngFile(name = 'qr.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

/** 在工具根上模拟 Ctrl+V 粘贴图片(files 路径:资源管理器复制 / 部分截图) */
function pasteImageFiles(file: File): void {
  fireEvent.paste(screen.getByTestId('qrcode-tool'), {
    clipboardData: { files: [file], items: [], types: ['Files'] } as unknown as DataTransfer,
  });
}

/** 在工具根上模拟 Ctrl+V 粘贴截图(items 路径:截图工具 / 浏览器复制图片) */
function pasteImageItems(file: File): void {
  fireEvent.paste(screen.getByTestId('qrcode-tool'), {
    clipboardData: {
      files: [],
      items: [{ type: 'image/png', kind: 'file', getAsFile: () => file }],
      types: ['Files'],
    } as unknown as DataTransfer,
  });
}

/** 在指定落点模拟拖放图片(冒泡到工具根统一识别) */
function dropImage(target: HTMLElement, file: File): void {
  fireEvent.drop(target, {
    dataTransfer: { files: [file], items: [], types: ['Files'] } as unknown as DataTransfer,
  });
}

describe('QrcodeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toDataURL.mockResolvedValue('data:image/png;base64,ok');
    jsQRMock.mockReturnValue({ data: 'hello-qr' });
  });

  it('默认停留在读取模式(无需手动切换即可粘贴/拖放识别)', () => {
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    expect(screen.getByTestId('qr-dropzone')).toBeInTheDocument();
    expect(screen.queryByTestId('qr-text')).not.toBeInTheDocument();
  });

  it('空文本显示「未输入」空态,不触发 toDataURL 也不显示失败占位', async () => {
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    switchToGenerateMode();
    // 防抖窗口后确认:未调用生成、无失败占位,空态提示在
    await new Promise((r) => setTimeout(r, 500));
    expect(toDataURL).not.toHaveBeenCalled();
    expect(screen.queryByTestId('qr-generate-error')).not.toBeInTheDocument();
    expect(screen.getByText(/输入文本后自动生成/)).toBeInTheDocument();
  });

  it('正常文本生成二维码预览', async () => {
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    switchToGenerateMode();
    typeInput('https://example.com');

    await waitFor(() => {
      expect(toDataURL).toHaveBeenCalledWith('https://example.com', {
        width: 280,
        margin: 2,
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('qr-preview')).toHaveAttribute('src', 'data:image/png;base64,ok');
    });
    expect(screen.queryByTestId('qr-generate-error')).not.toBeInTheDocument();
  });

  it('生成失败(超容量)显示显式失败占位,不再静默为空态', async () => {
    toDataURL.mockRejectedValue(new Error('code length overflow'));
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    switchToGenerateMode();
    // ~2953 字节上限的典型触发:输入超长文本
    typeInput('x'.repeat(4000));

    const alert = await screen.findByTestId('qr-generate-error');
    expect(alert).toHaveTextContent(/生成失败/);
    expect(alert).toHaveTextContent(/code length overflow/);
    // 失败时不再渲染图片预览,也不与「未输入」空态混淆
    expect(screen.queryByTestId('qr-preview')).not.toBeInTheDocument();
    expect(screen.queryByText(/输入文本后自动生成/)).not.toBeInTheDocument();
  });

  it('恢复可生成状态后清除失败占位', async () => {
    toDataURL.mockRejectedValueOnce(new Error('code length overflow'));
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    switchToGenerateMode();
    typeInput('x'.repeat(4000));
    await screen.findByTestId('qr-generate-error');

    // 缩短文本重新可生成:失败占位被清除、预览恢复
    typeInput('ok');
    await waitFor(() => {
      expect(screen.queryByTestId('qr-generate-error')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('qr-preview')).toBeInTheDocument();
  });

  it('解码成功后结果区出现发送到菜单', async () => {
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    switchToScanMode();

    // 未解码时无发送菜单(按钮条件渲染),Scan 区渲染正常
    expect(screen.getByTestId('qr-dropzone')).toBeInTheDocument();
    expect(screen.queryByTestId('qr-send')).not.toBeInTheDocument();
  });

  it('Ctrl+V 粘贴图片(files 路径)直接识别并出结果', async () => {
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    pasteImageFiles(pngFile());

    await screen.findByDisplayValue('hello-qr');
    expect(await screen.findByAltText('待识别的二维码图片')).toHaveAttribute('src', DATA_URL);
    expect(toastSuccess).toHaveBeenCalled();
    expect(screen.getByTestId('qr-send')).toBeInTheDocument();
  });

  it('Ctrl+V 粘贴截图(items 路径)在生成页也能切回读取页识别', async () => {
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    switchToGenerateMode();
    expect(screen.getByTestId('qr-text')).toBeInTheDocument();

    pasteImageItems(pngFile('shot.png'));

    // 自动切回读取页:dropzone 重新挂载、解码结果落定
    expect(await screen.findByTestId('qr-dropzone')).toBeInTheDocument();
    await screen.findByDisplayValue('hello-qr');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('拖放到右侧结果编辑器同样识别,不被 Monaco 吞掉', async () => {
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    dropImage(screen.getByTestId('qr-decoded'), pngFile());

    await screen.findByDisplayValue('hello-qr');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('生成页拖入图片自动切到读取页识别', async () => {
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    switchToGenerateMode();
    dropImage(screen.getByTestId('qrcode-tool'), pngFile());

    expect(await screen.findByTestId('qr-dropzone')).toBeInTheDocument();
    await screen.findByDisplayValue('hello-qr');
  });

  it('读取页拖入非图片提示仅支持图片,不清空旧结果', async () => {
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    pasteImageFiles(pngFile());
    await screen.findByDisplayValue('hello-qr');
    vi.clearAllMocks();

    const txt = new File(['x'], 'a.txt', { type: 'text/plain' });
    dropImage(screen.getByTestId('qr-dropzone'), txt);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('仅支持图片文件');
    });
    // 旧识别结果保留,不被错误拖放清空
    expect(screen.getByDisplayValue('hello-qr')).toBeInTheDocument();
  });

  it('纯文本粘贴放行 Monaco,不触发识别也不报错', () => {
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    switchToGenerateMode();
    fireEvent.paste(screen.getByTestId('qrcode-tool'), {
      clipboardData: {
        files: [],
        items: [],
        types: ['text/plain'],
        getData: () => 'hello',
      } as unknown as DataTransfer,
    });

    // 仍停留在生成页,无识别 toast
    expect(screen.getByTestId('qr-text')).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
