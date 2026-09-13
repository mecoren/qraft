import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImageMetadata } from './ImageMetadata';
import { parseImageMetadata } from './image-metadata-utils';

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

vi.mock('@/components/copy-action', () => ({
  CopyAction: (props: { text?: string; testId?: string }) => (
    <button type="button" data-testid={props.testId}>
      copy
    </button>
  ),
}));

// —— 夹具:1x1 红 PNG(独立于 utils 测试的最小体积,UI 只关心渲染流程) ——
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

/** FileReader.readAsDataURL mock:可配置返回内容(默认小 PNG) */
function mockFileReaderAsDataUrl(resultB64 = TINY_PNG_B64) {
  vi.stubGlobal(
    'FileReader',
    class {
      onload: (() => void) | null = null;
      result: string | null = null;
      readAsDataURL(_file: Blob) {
        this.result = `data:application/octet-stream;base64,${resultB64}`;
        this.onload?.();
      }
    },
  );
}

function makeFile(name = 'a.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

describe('ImageMetadata', () => {
  it('初始渲染:预览空态 + 结果空态,不白屏', () => {
    render(<ImageMetadata toolId="image_metadata" metadata={{} as never} />);
    expect(screen.getByTestId('image-metadata')).toBeInTheDocument();
    expect(screen.getByTestId('im-dropzone')).toBeInTheDocument();
    expect(screen.getByTestId('im-output')).toBeInTheDocument();
  });

  it('选择文件后渲染预览与解析结果', async () => {
    mockFileReaderAsDataUrl();
    render(<ImageMetadata toolId="image_metadata" metadata={{} as never} />);
    const input = screen.getByTestId('im-file');
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await waitFor(() => {
      expect(screen.getByTestId('im-preview')).toBeInTheDocument();
    });
    // 结构段渲染 + 尺寸字段值(1x1 PNG;测试 locale 固定 zh-CN,标签为「尺寸」)
    await waitFor(() => {
      expect(screen.getByTestId('im-section-structure')).toBeInTheDocument();
      expect(screen.getByTestId('im-field-尺寸').textContent).toContain('1 × 1');
    });
  });

  it('非图片字节显示错误卡', async () => {
    // mock 返回非图片字节(纯文本 base64)→ 解析器报「不是受支持的图片格式」
    mockFileReaderAsDataUrl(btoa('not an image at all, just plain text bytes'));
    render(<ImageMetadata toolId="image_metadata" metadata={{} as never} />);
    const input = screen.getByTestId('im-file');
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([1, 2, 3])], 'a.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => {
      expect(screen.getByTestId('im-error')).toBeInTheDocument();
    });
  });

  it('解析库对夹具的真实输出与 UI 字段一致', () => {
    const bin = atob(TINY_PNG_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const r = parseImageMetadata(bytes);
    expect(r.error).toBeUndefined();
    expect(r.format).toBe('png');
  });
});
