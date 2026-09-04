import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GzipCodec } from './GzipCodec';
import {
  base64ToBytesLoose,
  bytesToBase64,
  gunzipToText,
  gzipText,
  isGzipBase64,
  isGzipBytes,
} from './gzip-utils';

// CodeEditor 内嵌 Monaco,jsdom 无法加载,替换为轻量替身
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: (props: {
    'data-testid'?: string;
    value?: string;
    onChange?: (v: string) => void;
    title?: string;
  }) => (
    <div data-testid={props['data-testid']}>
      <span>{props.value}</span>
      <textarea
        aria-label={props.title}
        data-testid={`${props['data-testid']}-textarea`}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
    </div>
  ),
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

// Node 22 原生提供 CompressionStream / DecompressionStream / Response;
// 但 jsdom 的 Blob 缺 .stream() 实现,直接在原型上补齐:
// 通过 Node 原生 Blob 读出字节,再用 ReadableStream 手工构造。
if (typeof Blob !== 'undefined' && typeof Blob.prototype.stream !== 'function') {
  Blob.prototype.stream = function (): ReadableStream<Uint8Array<ArrayBuffer>> {
    const nodeBlob = this as unknown as { arrayBuffer(): Promise<ArrayBuffer> };
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      async start(controller) {
        controller.enqueue(new Uint8Array(await nodeBlob.arrayBuffer()));
        controller.close();
      },
    });
  };
}

describe('gzip-utils', () => {
  it('文本压缩→解压 roundtrip 还原', async () => {
    const text = 'hello world hello world hello gzip';
    const gz = await gzipText(text);
    expect(isGzipBytes(gz)).toBe(true);
    const back = await gunzipToText(gz);
    expect(back).toBe(text);
  });

  it('中文文本 roundtrip 保真', async () => {
    const text = '你好,gzip 压缩测试!🎉';
    const back = await gunzipToText(await gzipText(text));
    expect(back).toBe(text);
  });

  it('base64 宽容解析:URL-safe / 空白 / 缺 padding', () => {
    const bytes = new Uint8Array([1, 2, 250, 255]);
    const std = bytesToBase64(bytes);
    const urlSafe = std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect([...base64ToBytesLoose(urlSafe)]).toEqual([...bytes]);
    expect([...base64ToBytesLoose(`  ${std} \n`)]).toEqual([...bytes]);
  });

  it('isGzipBase64 识别 gzip 数据', async () => {
    const gz = await gzipText('abc');
    expect(isGzipBase64(bytesToBase64(gz))).toBe(true);
    expect(isGzipBase64('aGVsbG8=')).toBe(false); // "hello" 明文 base64
    expect(isGzipBase64('!!!invalid')).toBe(false);
  });

  it('非法输入 gunzip 抛错', async () => {
    await expect(gunzipToText(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(Error);
  });
});

describe('GzipCodec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('压缩模式:文本输入产出 base64 输出与压缩率', async () => {
    render(<GzipCodec toolId="gzip_codec" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('gzip-input-textarea'), {
      target: { value: 'hello world hello world hello world' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('gzip-ratio')).toBeInTheDocument();
    });
    // 输出为非空 base64
    const out = screen.getByTestId('gzip-output').querySelector('span')!.textContent!;
    expect(out.length).toBeGreaterThan(0);
    expect(isGzipBase64(out)).toBe(true);
  });

  it('解压模式:粘贴压缩产物还原文本', async () => {
    const gz = await gzipText('roundtrip text');
    const b64 = bytesToBase64(gz);
    render(<GzipCodec toolId="gzip_codec" metadata={null as never} />);
    // 切到解压
    fireEvent.click(screen.getByTestId('gzip-mode-switch'));
    fireEvent.change(screen.getByTestId('gzip-input-textarea'), { target: { value: b64 } });
    await waitFor(() => {
      expect(screen.getByTestId('gzip-output')).toHaveTextContent('roundtrip text');
    });
  });

  it('解压模式:非法 base64 显示错误', async () => {
    render(<GzipCodec toolId="gzip_codec" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('gzip-mode-switch'));
    fireEvent.change(screen.getByTestId('gzip-input-textarea'), { target: { value: '!!!' } });
    await waitFor(() => {
      expect(screen.getByTestId('gzip-output')).toHaveTextContent(/解压失败/);
    });
  });

  it('文件模式:选择文件后压缩产出可下载结果', async () => {
    const { GzipCodec: Comp } = await import('./GzipCodec');
    const { getByTestId } = render(<Comp toolId="gzip_codec" metadata={null as never} />);
    const input = getByTestId('gzip-file') as HTMLInputElement;
    const file = new File(['file content to compress'], 'note.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(getByTestId('gzip-download')).toBeInTheDocument();
    });
    expect(getByTestId('gzip-download')).toHaveTextContent('note.txt.gz');
  });
});
