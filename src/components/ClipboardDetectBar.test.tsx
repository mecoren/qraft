import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClipboardDetectBar } from './ClipboardDetectBar';
import { useUiStore } from '@/store/uiStore';
import { peekHandoff } from '@/store/handoffStore';

describe('ClipboardDetectBar 提示条', () => {
  beforeEach(() => {
    useUiStore.setState({
      detectedTools: [],
      detectedText: '',
      detectDismissed: false,
    });
  });

  it('无探测结果时不渲染', () => {
    const { container } = render(<ClipboardDetectBar />);
    expect(container.querySelector('[data-testid="clipboard-detect-bar"]')).toBeNull();
  });

  it('关闭态不渲染', () => {
    useUiStore.setState({
      detectedTools: [{ toolId: 'jwt_parser', reason: 'chrome.detect.reason_jwt' }],
      detectDismissed: true,
    });
    const { container } = render(<ClipboardDetectBar />);
    expect(container.querySelector('[data-testid="clipboard-detect-bar"]')).toBeNull();
  });

  it('命中时渲染建议 chip(原因 + 工具名)', () => {
    useUiStore.setState({
      detectedTools: [
        { toolId: 'jwt_parser', reason: 'chrome.detect.reason_jwt' },
        { toolId: 'json_formatter', reason: 'chrome.detect.reason_json' },
      ],
    });
    render(<ClipboardDetectBar />);
    const chips = screen.getAllByTestId('detect-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('JWT 结构');
    // catalog 工具名(DOM 内「JWT」与「编码器」分属不同 span,子串无空格)
    expect(chips[0]).toHaveTextContent(/JWT编码器\/解码器/);
  });

  it('点击 chip 写 handoff 并切工具(预填原文)', () => {
    useUiStore.setState({
      detectedTools: [{ toolId: 'timestamp_converter', reason: 'chrome.detect.reason_timestamp' }],
      detectedText: '1726219200',
    });
    render(<ClipboardDetectBar />);
    fireEvent.click(screen.getByTestId('detect-chip'));
    // handoff 已写入目标工具
    expect(peekHandoff('timestamp_converter')).toBe('1726219200');
    // openTool 已切换视图并记录最近使用
    expect(useUiStore.getState().view).toBe('tool');
    expect(useUiStore.getState().recents).toContain('timestamp_converter');
  });

  it('点击关闭按钮置关闭态', () => {
    useUiStore.setState({
      detectedTools: [{ toolId: 'jwt_parser', reason: 'chrome.detect.reason_jwt' }],
    });
    render(<ClipboardDetectBar />);
    fireEvent.click(screen.getByTestId('detect-bar-close'));
    expect(useUiStore.getState().detectDismissed).toBe(true);
    expect(screen.queryByTestId('clipboard-detect-bar')).toBeNull();
  });

  it('目录外的 toolId 条目被过滤不渲染 chip', () => {
    useUiStore.setState({
      detectedTools: [{ toolId: 'not_a_tool', reason: 'x' }],
    });
    render(<ClipboardDetectBar />);
    expect(screen.queryByTestId('clipboard-detect-bar')).toBeNull();
  });

  it('探测结果为空数组时不渲染', () => {
    useUiStore.setState({ detectedTools: [], detectedText: 'abc' });
    const { container } = render(<ClipboardDetectBar />);
    expect(container.querySelector('[data-testid="clipboard-detect-bar"]')).toBeNull();
  });
});
