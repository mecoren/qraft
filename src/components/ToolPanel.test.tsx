import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolPanel } from './ToolPanel';
import { useToolStateStore } from '@/store/toolStateStore';

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
  it('renders tool name in header', () => {
    render(<ToolPanel toolId="base64_codec" />);
    // 页头 h1 展示目录中的工具名(Base64文本编码/解码)
    expect(screen.getByRole('heading', { level: 1, name: /base64/i })).toBeInTheDocument();
  });

  it('mounts the registered tool component for toolId', () => {
    render(<ToolPanel toolId="base64_codec" />);
    // 注册的 Base64Codec 组件已挂载(其输出编辑器带 data-testid="output")
    expect(screen.getByTestId('output')).toBeInTheDocument();
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
});
