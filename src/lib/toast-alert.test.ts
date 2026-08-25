import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { showAlert, copyTextWithFeedback } from './toast-alert';
import { changeLocale } from '@/i18n';

// toast 顶层是个可调用函数,同时挂载了 error/success/warning 等方法。
// 通过工厂内联定义(vi.mock 会被 hoist,不可引用模块顶层变量)。
vi.mock('sonner', () => {
  const base = vi.fn();
  return {
    toast: Object.assign(base, {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      message: vi.fn(),
      loading: vi.fn(),
      custom: vi.fn(),
      dismiss: vi.fn(),
      promise: vi.fn(),
    }),
  };
});

const t = toast as unknown as ReturnType<typeof vi.fn> & {
  error: ReturnType<typeof vi.fn>;
  success: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  message: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  t.mockReset();
  t.error.mockReset();
  t.success.mockReset();
  t.warning.mockReset();
  t.info.mockReset();
  t.message.mockReset();
});

describe('showAlert', () => {
  it('maps destructive variant to toast.error with title and description', () => {
    showAlert({ variant: 'destructive', title: '出错了', description: '网络中断' });
    expect(t.error).toHaveBeenCalledWith(
      '出错了',
      expect.objectContaining({ description: '网络中断', duration: 4000 }),
    );
  });

  it('maps success variant to toast.success', () => {
    showAlert({ variant: 'success', title: '已保存' });
    expect(t.success).toHaveBeenCalledWith(
      '已保存',
      expect.objectContaining({ description: undefined, duration: 4000 }),
    );
  });

  it('maps warning variant to toast.warning', () => {
    showAlert({ variant: 'warning', title: '注意' });
    expect(t.warning).toHaveBeenCalledWith('注意', expect.any(Object));
  });

  it('maps info / default variant to callable toast', () => {
    showAlert({ variant: 'info', title: '提示' });
    expect(t).toHaveBeenCalledWith('提示', expect.any(Object));

    showAlert({ variant: 'default', title: '默认' });
    expect(t).toHaveBeenCalledWith('默认', expect.any(Object));
  });

  it('honours custom duration', () => {
    showAlert({ variant: 'destructive', title: 'x', duration: 1000 });
    expect(t.error).toHaveBeenCalledWith('x', expect.objectContaining({ duration: 1000 }));
  });
});

describe('copyTextWithFeedback 反馈文案(i18n)', () => {
  beforeEach(() => {
    t.mockReset();
    t.error.mockReset();
    t.success.mockReset();
    changeLocale('zh-CN');
  });

  function stubClipboard(ok: boolean): void {
    // 失败路径须以 reject 呈现(clipboard.ts 对 resolve(false) 视为成功后降级 IPC)
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockImplementation(async () => {
          if (!ok) throw new Error('denied');
          return undefined;
        }),
      },
    });
  }

  it('zh-CN:成功标题与失败标题为中文', async () => {
    stubClipboard(true);
    await copyTextWithFeedback('hello');
    expect(t.success).toHaveBeenCalledWith(
      '已复制到剪贴板',
      expect.objectContaining({ description: 'hello' }),
    );
    stubClipboard(false);
    await copyTextWithFeedback('hello');
    expect(t.error).toHaveBeenCalledWith('复制失败', expect.anything());
  });

  it('en-US:成功标题切换为英文(手动切语言场景),结束恢复 zh 桩', async () => {
    changeLocale('en-US');
    try {
      stubClipboard(true);
      await copyTextWithFeedback('hello');
      expect(t.success).toHaveBeenCalledWith(
        'Copied to clipboard',
        expect.objectContaining({ description: 'hello' }),
      );
    } finally {
      changeLocale('zh-CN');
    }
  });
});
