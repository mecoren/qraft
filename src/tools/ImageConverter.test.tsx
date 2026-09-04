import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImageConverter } from './ImageConverter';

// Select 简化替身:容器带 data-testid
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, children }: { value?: string; children: React.ReactNode }) => (
    <div data-testid="select-box" data-value={value}>
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

// canvas stub:jsdom 无 2d context(需 canvas 包),伪造 ctx + toDataURL
const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
const origGetContext = HTMLCanvasElement.prototype.getContext;
const fakeCtx = {
  imageSmoothingEnabled: false,
  imageSmoothingQuality: 'high',
  fillStyle: '',
  fillRect: vi.fn(),
  drawImage: vi.fn(),
} as unknown as CanvasRenderingContext2D;
HTMLCanvasElement.prototype.getContext = ((
  _contextId: string,
  _options?: unknown,
) => fakeCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toDataURL = function toDataURLStub(): string {
  return DATA_URL;
};

describe('ImageConverter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('初始渲染空拖放区与配置区', () => {
    render(<ImageConverter toolId="image_converter" metadata={null as never} />);
    expect(screen.getByTestId('image-converter')).toBeInTheDocument();
    expect(screen.getByTestId('ic-dropzone')).toBeInTheDocument();
    // 默认目标格式 select 值为 image/png
    expect(screen.getByTestId('select-box')).toHaveAttribute('data-value', 'image/png');
  });

  it('加载图片后展示预览与信息', async () => {
    render(<ImageConverter toolId="image_converter" metadata={null as never} />);
    const input = screen.getByTestId('ic-file') as HTMLInputElement;
    const file = new File([new Uint8Array(10)], 'test.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByTestId('ic-preview')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ic-info')).toHaveTextContent('test.png · 100×50');
  });

  it('缩放滑杆改变输出尺寸显示', async () => {
    render(<ImageConverter toolId="image_converter" metadata={null as never} />);
    const input = screen.getByTestId('ic-file') as HTMLInputElement;
    const file = new File([new Uint8Array(10)], 'test.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByTestId('ic-out-size')).toHaveTextContent('100×50');
    });
    fireEvent.change(screen.getByTestId('ic-scale'), { target: { value: '50' } });
    expect(screen.getByTestId('ic-scale-value')).toHaveTextContent('50%');
    await waitFor(() => {
      expect(screen.getByTestId('ic-out-size')).toHaveTextContent('50×25');
    });
  });

  it('PNG 模式无质量滑杆与背景设置', () => {
    render(<ImageConverter toolId="image_converter" metadata={null as never} />);
    expect(screen.queryByTestId('ic-quality')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ic-bg-switch')).not.toBeInTheDocument();
  });

  it('加载后产出输出预览', async () => {
    render(<ImageConverter toolId="image_converter" metadata={null as never} />);
    const input = screen.getByTestId('ic-file') as HTMLInputElement;
    const file = new File([new Uint8Array(10)], 'test.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(
      () => {
        expect(screen.getByTestId('ic-output-preview')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});

// 恢复被覆盖的原型(避免影响其他用例)
afterAll(() => {
  HTMLCanvasElement.prototype.toDataURL = origToDataURL;
  HTMLCanvasElement.prototype.getContext = origGetContext;
});
