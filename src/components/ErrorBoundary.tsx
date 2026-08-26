import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { t as translate } from '@/i18n';
import { showAlert } from '@/lib/toast-alert';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
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
    // 通过全局 alert 提示,确保用户可见
    showAlert({
      variant: 'destructive',
      title: translate('chrome.error_boundary.title'),
      description: error.message,
    });
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
      showAlert({ variant: 'success', title: translate('chrome.error_boundary.copied') });
    } catch {
      showAlert({ variant: 'destructive', title: translate('chrome.toast.copy_failed') });
    }
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }
    return (
      <Alert variant="destructive" className="m-4">
        <AlertCircle aria-hidden className="size-4" />
        <AlertTitle>{translate('chrome.error_boundary.heading')}</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
        <div className="col-start-2 mt-2 flex gap-2">
          <Button variant="secondary" size="sm" onClick={this.reset}>
            {translate('chrome.error_boundary.retry')}
          </Button>
          <Button variant="outline" size="sm" onClick={this.handleCopy}>
            Copy error
          </Button>
        </div>
      </Alert>
    );
  }
}
