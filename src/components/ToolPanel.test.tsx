import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToolPanel } from './ToolPanel';
import { useToolStateStore } from '@/store/toolStateStore';

// 工具组件为懒加载(React.lazy),全量测试并行时动态 import + 渲染可能超时,
// 因此所有异步等待统一使用较宽的超时窗口。
const LAZY_TIMEOUT = 5000;

beforeEach(() => {
  // ToolPanel 从静态目录(getCatalogEntry)取元数据并挂载注册表组件,不依赖 store 的工具列表
  useToolStateStore.setState({
    availableTools: [],
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
});

describe('ToolPanel', () => {
  it('mounts the registered tool component for toolId', async () => {
    render(<ToolPanel toolId="base64_codec" />);
    // 注册的 Base64Codec 组件为懒加载,首次访问经 Suspense 加载完成后挂载
    // (其输出编辑器带 data-testid="output")
    expect(await screen.findByTestId('output', {}, { timeout: LAZY_TIMEOUT })).toBeInTheDocument();
    // 未接入占位不应出现
    expect(screen.queryByText(/尚未接入/)).not.toBeInTheDocument();
  });

  it('renders alerts when provided', () => {
    render(
      <ToolPanel
        toolId="base64_codec"
        alerts={[
          { level: 'warning', message: 'large input' },
          { level: 'error', message: 'parse fail' },
        ]}
      />,
    );
    expect(screen.getByText(/large input/i)).toBeInTheDocument();
    expect(screen.getByText(/parse fail/i)).toBeInTheDocument();
  });

  it('renders empty state when toolId not found', () => {
    render(<ToolPanel toolId="unknown" />);
    expect(screen.getByText(/未找到工具/)).toBeInTheDocument();
  });

  it('keeps tool input after switching away and back (keepalive)', async () => {
    const { rerender } = render(<ToolPanel toolId="base64_codec" />);
    // 等待 Base64Codec 懒加载完成,在其输入框输入内容
    const editor = (await screen.findByTestId('input', {}, { timeout: LAZY_TIMEOUT })).querySelector(
      'textarea',
    )!;
    fireEvent.change(editor, { target: { value: 'keep me' } });

    // 切到 json_formatter:当前工作区切换为 JSON 格式化器,Base64 输入被隐藏
    rerender(<ToolPanel toolId="json_formatter" />);
    // 等待 json_formatter 懒加载完成(两个工具的 input 实例均挂载)
    await waitFor(() => expect(screen.getAllByTestId('input').length).toBe(2), {
      timeout: LAZY_TIMEOUT,
    });

    // 切回 base64_codec:两个工具实例常驻(keepalive),Base64 输入内容保留
    rerender(<ToolPanel toolId="base64_codec" />);
    const inputs = screen.getAllByTestId('input');
    expect(inputs.length).toBe(2);
    const values = inputs.map((c) => c.querySelector('textarea')?.value ?? '');
    expect(values).toContain('keep me');
  });
});
