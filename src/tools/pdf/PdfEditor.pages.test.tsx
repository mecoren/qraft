import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PdfEditorTool } from './PdfEditor';
import { usePdfDocsStore } from './pdfDocsStore';
import type { ToolProps } from '../registry';
import type { ToolMetadata } from '@/types/tool';

/**
 * PdfEditor UI 接线冒烟(不加载 pdfjs):
 * - 空态:合并按钮禁用(docs < 2)
 * - 双文档:合并按钮可用
 * pdfjs 渲染路径(页面提取/转图片/表单)在 jsdom 无 canvas worker,
 * 由 pdfPages/pdfForm 纯逻辑测试覆盖,浏览器实测验证交互链路。
 */

const metadata = {
  id: 'pdf_editor',
  backendId: undefined,
} as unknown as ToolMetadata;

function renderTool(): void {
  render(<PdfEditorTool toolId="pdf_editor" metadata={metadata} {...({} as ToolProps)} />);
}

function resetStore(): void {
  usePdfDocsStore.setState({ docs: [], activeDocId: null });
}

afterEach(() => {
  cleanup();
  resetStore();
});

describe('PdfEditor 页面操作接线', () => {
  it('空态合并按钮禁用', () => {
    renderTool();
    const merge = screen.getByTestId('pdf-merge-all');
    expect(merge).toBeDisabled();
  });

  it('双文档时合并按钮可用', () => {
    usePdfDocsStore.getState().openPdfFromSystem({
      path: 'C:\\a.pdf',
      base64: 'A',
      size: 1,
    });
    usePdfDocsStore.getState().openPdfFromSystem({
      path: 'C:\\b.pdf',
      base64: 'B',
      size: 1,
    });
    renderTool();
    expect(screen.getByTestId('pdf-merge-all')).toBeEnabled();
    // 两个文档 Tab
    expect(screen.getAllByTestId('pdf-doc-tab')).toHaveLength(2);
  });
});
