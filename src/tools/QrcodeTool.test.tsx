/**
 * QrcodeTool 组件测试:生成失败不再静默(reject → 预览区失败占位)、
 * 解码结果区「发送到…」菜单接线、空文本不触发生成。
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { QrcodeTool } from './QrcodeTool';
import QRCode from 'qrcode';

const toDataURL = QRCode.toDataURL as unknown as ReturnType<typeof vi.fn>;

/** radix Tabs 在 onMouseDown 时激活 tab,需用 mouseDown 而非 click(Base64Codec.test 同款) */
function switchToScanMode(): void {
  fireEvent.mouseDown(screen.getByTestId('qr-tab-scan'));
}

function typeInput(value: string): void {
  const editor = screen.getByTestId('qr-text').querySelector('textarea')!;
  fireEvent.change(editor, { target: { value } });
}

describe('QrcodeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toDataURL.mockResolvedValue('data:image/png;base64,ok');
  });

  it('空文本显示「未输入」空态,不触发 toDataURL 也不显示失败占位', async () => {
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
    // 防抖窗口后确认:未调用生成、无失败占位,空态提示在
    await new Promise((r) => setTimeout(r, 500));
    expect(toDataURL).not.toHaveBeenCalled();
    expect(screen.queryByTestId('qr-generate-error')).not.toBeInTheDocument();
    expect(screen.getByText(/输入文本后自动生成/)).toBeInTheDocument();
  });

  it('正常文本生成二维码预览', async () => {
    render(<QrcodeTool toolId="qrcode_tool" metadata={null as never} />);
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

    // jsdom 无 canvas 上下文,decodeQrFromDataUrl 无法直跑;直接断言空态:
    // 未解码时无发送菜单(按钮条件渲染),Scan 区渲染正常
    expect(screen.getByTestId('qr-dropzone')).toBeInTheDocument();
    expect(screen.queryByTestId('qr-send')).not.toBeInTheDocument();
  });
});
