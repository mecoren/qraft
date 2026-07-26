import { Component, type ErrorInfo, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  /** 自定义 fallback,默认使用内置 UI */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * React 错误边界:捕获子树渲染错误,展示友好界面并 toast 通知。
 * 注意:错误边界不捕获事件回调与异步错误,那些场景需手动 try/catch + toast。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 同时通过 toast 全局提示,确保用户可见
    toast.error(`渲染错误: ${error.message}`);
    // 控制台保留完整堆栈便于调试
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  handleCopy = async (): Promise<void> => {
    const err = this.state.error;
    if (!err) return;
    const text = `${err.name}: ${err.message}\n${err.stack ?? ''}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('错误已复制到剪贴板');
    } catch {
      toast.error('复制失败');
    }
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }
    return (
      <div
        role="alert"
        className="flex flex-col gap-4 p-6 m-4 rounded-lg border border-destructive/50 bg-destructive/10 text-foreground"
      >
        <h2 className="text-lg font-semibold">渲染出错</h2>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={this.reset}>
            重试
          </Button>
          <Button variant="outline" size="sm" onClick={this.handleCopy}>
            Copy error
          </Button>
        </div>
      </div>
    );
  }
}
