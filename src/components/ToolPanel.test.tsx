import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolPanel } from './ToolPanel';
import { useToolStateStore } from '@/store/toolStateStore';
import type { ToolMetadata } from '@/types/tool';

const meta: ToolMetadata = {
  id: 'base64_codec',
  name: 'Base64 Codec',
  description: 'encode/decode',
  category: 'encoder',
  icon: 'Binary',
  version: '0.1.0',
  input_schema: {},
  timeout_secs: null,
  streaming_supported: false,
  tags: [],
};

beforeEach(() => {
  useToolStateStore.setState({
    availableTools: [meta],
    currentToolId: 'base64_codec',
    running: false,
    streamingTasks: new Map(),
  });
});

describe('ToolPanel', () => {
  it('renders tool name in header', () => {
    render(<ToolPanel toolId="base64_codec" />);
    expect(screen.getByText(/base64 codec/i)).toBeInTheDocument();
  });

  it('mounts the registered tool component for toolId', () => {
    render(<ToolPanel toolId="base64_codec" />);
    expect(screen.getByText(/base64 codec/i)).toBeInTheDocument();
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
    useToolStateStore.setState({ currentToolId: 'unknown' });
    render(<ToolPanel toolId="unknown" />);
    expect(screen.getByText(/未找到工具/)).toBeInTheDocument();
  });
});
