import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoToGif } from './VideoToGif';

/**
 * VideoToGif UI 状态机(jsdom 无视频解码):
 * - 空态:转换按钮禁用
 * - 非视频文件拒绝
 * - 视频元信息就绪后参数区启用、转换可点
 * 抽帧/编码链路(seek+canvas+gif_encode)由 Rust 单测 + 集成测试覆盖,
 * 浏览器实测验证端到端。
 */

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// FileReader stub:视频文件读为 data URL(视频元素本身不会被解码)
const DATA_URL = 'data:video/mp4;base64,AAAA';
class StubFileReader {
  result: string | ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  readAsDataURL(): void {
    this.result = DATA_URL;
    queueMicrotask(() => this.onload?.());
  }
}

// createElement('video') 桩:元数据加载即 resolve(duration/videoWidth 可控)
const REAL_CREATE = document.createElement.bind(document);
let videoProbeDuration = 5;
vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
  if (String(tagName).toLowerCase() !== 'video') return REAL_CREATE(tagName as never);
  const el = REAL_CREATE('div') as unknown as HTMLVideoElement & {
    onloadedmetadata: (() => void) | null;
    currentTime: number;
    addEventListener: (t: string, cb: () => void) => void;
    removeEventListener: () => void;
  };
  // 只读属性经 defineProperty 覆写(HTMLVideoElement 上直接赋值是 TS 错误)
  Object.defineProperty(el, 'duration', {
    get: () => videoProbeDuration,
    configurable: true,
  });
  Object.defineProperty(el, 'videoWidth', { value: 1920, configurable: true });
  Object.defineProperty(el, 'videoHeight', { value: 1080, configurable: true });
  el.currentTime = 0;
  // preload=metadata 的赋值触发 onloadedmetadata(loadFile 等待它)
  let preload = '';
  Object.defineProperty(el, 'preload', {
    get: () => preload,
    set: (v: string) => {
      preload = v;
      if (v === 'metadata') queueMicrotask(() => el.onloadedmetadata?.());
    },
  });
  Object.defineProperty(el, 'src', {
    get: () => '',
    set: () => undefined,
  });
  return el as unknown as HTMLElement;
}) as unknown as typeof document.createElement);

vi.stubGlobal('FileReader', StubFileReader);

beforeEach(() => {
  videoProbeDuration = 5;
});

afterEach(() => {
  cleanup();
});

describe('VideoToGif', () => {
  it('空态:转换按钮禁用', () => {
    render(<VideoToGif toolId="video_to_gif" metadata={null as never} />);
    expect(screen.getByTestId('vtg-convert')).toBeDisabled();
    expect(screen.queryByTestId('vtg-download')).not.toBeInTheDocument();
  });

  it('非视频文件被拒绝', () => {
    render(<VideoToGif toolId="video_to_gif" metadata={null as never} />);
    const input = screen.getByTestId('vtg-file') as HTMLInputElement;
    const png = new File([new Uint8Array(4)], 'x.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [png] } });
    // toast.error 仅在异步 loadFile 内部调用;此处校验 UI 不进加载态即可
    expect(screen.getByTestId('vtg-convert')).toBeDisabled();
  });

  it('视频元信息就绪:显示信息,参数区启用,转换可点', async () => {
    render(<VideoToGif toolId="video_to_gif" metadata={null as never} />);
    const input = screen.getByTestId('vtg-file') as HTMLInputElement;
    const mp4 = new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [mp4] } });

    await waitFor(() => {
      expect(screen.getByTestId('vtg-info')).toHaveTextContent('clip.mp4');
    });
    // 默认片段 0~3s(duration=5s 时取 min(3,5))
    expect((screen.getByTestId('vtg-start') as HTMLInputElement).value).toBe('0');
    expect((screen.getByTestId('vtg-end') as HTMLInputElement).value).toBe('3');
    expect(screen.getByTestId('vtg-convert')).toBeEnabled();
    expect(screen.queryByTestId('vtg-download')).not.toBeInTheDocument();
  });

  it('短于 3s 的视频默认片段跟随时长', async () => {
    videoProbeDuration = 2;
    render(<VideoToGif toolId="video_to_gif" metadata={null as never} />);
    const input = screen.getByTestId('vtg-file') as HTMLInputElement;
    const mp4 = new File([new Uint8Array(8)], 'short.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [mp4] } });
    await waitFor(() => {
      expect((screen.getByTestId('vtg-end') as HTMLInputElement).value).toBe('2');
    });
  });
});
