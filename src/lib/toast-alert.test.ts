import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { showAlert } from './toast-alert';

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
