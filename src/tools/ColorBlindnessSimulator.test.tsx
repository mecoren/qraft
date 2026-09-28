/**
 * ColorBlindnessSimulator 粘贴/拖放测试:根容器统一拦截,
 * 落到结果格也能直接换源图(不只原图象限)。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorBlindnessSimulator } from './ColorBlindnessSimulator';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// FileReader stub:loadFile 只需 data URL 即可展示源图(模拟图需 Image 解码,此处不覆盖)
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

function png(name = 'shot.png'): File {
  return new File([new Uint8Array(4)], name, { type: 'image/png' });
}

describe('ColorBlindnessSimulator', () => {
  it('Ctrl+V 粘贴图片直接换源图', async () => {
    render(<ColorBlindnessSimulator toolId="color_blindness_simulator" metadata={null as never} />);
    fireEvent.paste(screen.getByTestId('color-blindness-simulator'), {
      clipboardData: { files: [png()], items: [], types: ['Files'] } as unknown as DataTransfer,
    });
    const img = await screen.findByAltText('原图');
    expect(img).toHaveAttribute('src', DATA_URL);
  });

  it('拖放到工具根(结果格区域)同样换源图', async () => {
    render(<ColorBlindnessSimulator toolId="color_blindness_simulator" metadata={null as never} />);
    fireEvent.drop(screen.getByTestId('color-blindness-simulator'), {
      dataTransfer: {
        files: [png('drop.png')],
        items: [],
        types: ['Files'],
      } as unknown as DataTransfer,
    });
    const img = await screen.findByAltText('原图');
    expect(img).toHaveAttribute('src', DATA_URL);
  });
});
