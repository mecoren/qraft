import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
  Toaster: () => null,
}));

const toastSpy = toast.error as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  toastSpy.mockReset();
});

function Boom({ should }: { should: boolean }) {
  if (should) throw new Error('boom!');
  return <div data-testid="ok">ok</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <Boom should={false} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('ok')).toBeInTheDocument();
  });

  it('renders fallback UI when child throws', () => {
    // 抑制 React 的 console.error 噪音
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom should={true} />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/boom!/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('shows toast.error on error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom should={true} />
      </ErrorBoundary>
    );
    expect(toastSpy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('copy error button writes to clipboard', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    // 模拟 navigator.clipboard(jsdom 中 clipboard 是只读 getter,需用 defineProperty 覆盖)
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    render(
      <ErrorBoundary>
        <Boom should={true} />
      </ErrorBoundary>
    );
    await user.click(screen.getByRole('button', { name: /copy error/i }));
    expect(writeText).toHaveBeenCalled();
    spy.mockRestore();
  });
});
