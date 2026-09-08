import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JsonTreeView } from './JsonTreeView';

// copyTextWithFeedback 经 toast-alert 模块;单测直接 mock 断言调用参数
vi.mock('@/lib/toast-alert', () => ({
  copyTextWithFeedback: vi.fn(),
}));

import { copyTextWithFeedback } from '@/lib/toast-alert';

describe('JsonTreeView 路径拷贝', () => {
  it('copies the JSONPath of a container node via the hover copy button', async () => {
    render(<JsonTreeView value={{ a: { b: 1 } }} data-testid="output-tree" />);
    // $.a 是容器行:复制按钮与展开按钮同行(button 的兄弟节点)
    const aRow = screen.getByText('a');
    const copyBtn = aRow.closest('div')?.querySelector('[data-testid="copy-path"]');
    expect(copyBtn).not.toBeNull();
    fireEvent.click(copyBtn!);
    expect(copyTextWithFeedback).toHaveBeenCalledWith('$.a');
  });

  it('copies array element paths with index syntax', () => {
    render(<JsonTreeView value={{ list: ['x', 'y'] }} />);
    // $.list 属前两层,默认已展开,元素行直接渲染
    const itemRow = screen.getByText('[0]').closest('div')!;
    // copy 按钮在 [0] 行的祖先行上(与元素行同属一行的兄弟)
    const copyBtn = itemRow.querySelector('[data-testid="copy-path"]');
    if (copyBtn === null) {
      // 元素行结构:[label][value] 内层 div → 外层行 div(按钮挂这里)
      const row = itemRow.parentElement!;
      expect(row.querySelector('[data-testid="copy-path"]')).not.toBeNull();
      fireEvent.click(row.querySelector('[data-testid="copy-path"]')!);
    } else {
      fireEvent.click(copyBtn);
    }
    expect(copyTextWithFeedback).toHaveBeenCalledWith('$.list[0]');
  });

  it('copies the root path from the root row', () => {
    render(<JsonTreeView value={{ a: 1 }} />);
    // 根行无文本标签,经 data-path 定位
    const rootRow = document.querySelector('[data-path="$"]');
    expect(rootRow).not.toBeNull();
    const copyBtn = rootRow?.closest('div')?.querySelector('[data-testid="copy-path"]');
    expect(copyBtn).not.toBeNull();
    fireEvent.click(copyBtn!);
    expect(copyTextWithFeedback).toHaveBeenCalledWith('$');
  });
});

describe('JsonTreeView 内容推断预览', () => {
  /** 叶子行 DOM:label/value 在内层 div,chip 与 copy 按钮挂外层行 div */
  function leafRow(key: string): HTMLDivElement {
    return screen.getByText(key).closest('div')!.parentElement as HTMLDivElement;
  }

  it('shows a URL chip for http(s) string leaves', () => {
    render(<JsonTreeView value={{ site: 'https://example.com' }} />);
    expect(leafRow('site').querySelector('[data-inferred="url"]')).not.toBeNull();
  });

  it('shows a color chip for hex colors and renders the swatch background', () => {
    render(<JsonTreeView value={{ bg: '#ff8800' }} />);
    const chip = leafRow('bg').querySelector('[data-inferred="color"]');
    expect(chip).not.toBeNull();
    // 色块以行内样式渲染推断出的颜色(可点击复制原值)
    expect(chip!.querySelector('span')?.style.backgroundColor).toBe('rgb(255, 136, 0)');
  });

  it('shows a date chip for ISO 8601 date-time strings', () => {
    render(<JsonTreeView value={{ created: '2026-09-08T10:30:00Z' } as never} />);
    expect(leafRow('created').querySelector('[data-inferred="date"]')).not.toBeNull();
  });

  it('infers nothing for ordinary strings and numbers', () => {
    render(<JsonTreeView value={{ name: 'hello', count: 42 } as never} />);
    const container = document.querySelector('[data-testid]');
    expect(container?.querySelector('[data-inferred]')).toBeNull();
  });
});
