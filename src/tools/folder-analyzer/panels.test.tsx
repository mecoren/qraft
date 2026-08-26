import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { changeLocale } from '@/i18n';

// CodeEditor 内嵌 Monaco,jsdom 无法加载:替换为 textarea 替身,
// 暴露 value / language / lineNumbers,供面板断言(与 CodeEditor.test 同策略)
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: ({
    value,
    language,
    lineNumbers = true,
    'data-testid': testId,
  }: {
    value: string;
    language?: string;
    lineNumbers?: boolean;
    'data-testid'?: string;
  }) => (
    <div
      data-testid={testId}
      data-language={language}
      data-line-numbers={String(lineNumbers)}
    >
      <textarea
        data-testid={testId ? `${testId}-textarea` : undefined}
        value={value}
        readOnly
      />
    </div>
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { FileInspectPanel } from './FileInspectPanel';
import { ScanResultsPanel } from './ScanResultsPanel';
import { SearchResultsPanel } from './SearchResultsPanel';
import type { ScanReport, SearchReport, FileInspectReport } from './types';

const scanFixture: ScanReport = {
  root: 'C:/proj',
  total_files: 3,
  total_dirs: 1,
  total_bytes: 2048,
  symlinks_skipped: 0,
  truncated: false,
  cancelled: false,
  elapsed_ms: 12,
  by_category: [{ category: 'code', files: 2, bytes: 1024 }],
  by_extension: [
    { ext: 'ts', files: 2, bytes: 1024 },
    { ext: 'md', files: 1, bytes: 1024 },
  ],
  text_metrics: {
    files_analyzed: 2,
    files_skipped_large: 0,
    files_skipped_binary: 1,
    lines: 10,
    words: 20,
    chars: 100,
    by_extension: [{ ext: 'ts', files: 2, lines: 10, words: 20, chars: 100 }],
  },
  largest_files: [{ path: 'C:/proj/big.ts', bytes: 800 }],
};

describe('ScanResultsPanel', () => {
  const user = userEvent.setup();

  it('renders summary numbers', () => {
    render(<ScanResultsPanel report={scanFixture} />);
    expect(screen.getByTestId('scan-total-files')).toHaveTextContent('3');
    expect(screen.getByTestId('scan-total-size')).toHaveTextContent('2.0 KB');
  });

  it('lists extension stats sorted desc by files', () => {
    render(<ScanResultsPanel report={scanFixture} />);
    const rows = screen.getAllByTestId(/^scan-ext-row-/);
    expect(rows[0]).toHaveTextContent('ts');
  });

  it('switches to category table via shadcn tab', async () => {
    render(<ScanResultsPanel report={scanFixture} />);
    await user.click(screen.getByTestId('scan-tab-category'));
    expect(screen.getByTestId('scan-cat-row-code')).toBeInTheDocument();
  });

  it('switches to text metrics table and largest files table', async () => {
    render(<ScanResultsPanel report={scanFixture} />);
    await user.click(screen.getByTestId('scan-tab-text'));
    expect(screen.getByTestId('scan-text-row-ts')).toBeInTheDocument();
    expect(screen.getByTestId('scan-table-wrap')).toHaveTextContent('覆盖 2 个文本文件');
    await user.click(screen.getByTestId('scan-tab-largest'));
    expect(screen.getByTestId('scan-largest-row')).toHaveTextContent('big.ts');
  });

  it('shows truncated warning', () => {
    render(<ScanResultsPanel report={{ ...scanFixture, truncated: true }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/截断/);
  });

  it('en-US:概览卡与截断提示随语言切换(手动切语言场景),结束恢复 zh 桩', () => {
    changeLocale('en-US');
    // 先卸载再切回 zh 桩,避免异步 languageChanged 在 act 环境外触发告警更新
    const { unmount } = render(
      <ScanResultsPanel report={{ ...scanFixture, truncated: true }} />,
    );
    try {
      expect(screen.getByText('Total files')).toBeInTheDocument();
      expect(screen.getByText('Elapsed')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/truncated/);
    } finally {
      unmount();
      changeLocale('zh-CN');
    }
  });
});

describe('SearchResultsPanel', () => {
  const report: SearchReport = {
    pattern: 'needle',
    is_regex: false,
    case_insensitive: true,
    total_matches: 2,
    files_with_matches: 1,
    files_scanned: 5,
    files_skipped_large: 0,
    truncated: false,
    cancelled: false,
    results: [
      {
        path: 'C:/p/a.txt',
        ext: 'txt',
        match_count: 2,
        matches: [
          { line_number: 1, column: 0, preview: 'needle one' },
          { line_number: 4, column: 7, preview: 'second needle here' },
        ],
      },
    ],
  };

  it('renders summary and composes matches into readonly monaco', () => {
    render(<SearchResultsPanel report={report} />);
    expect(screen.getByTestId('search-summary')).toHaveTextContent('2 处匹配');
    const editor = screen.getByTestId('search-editor-textarea');
    expect(editor).toHaveValue(
      '// C:/p/a.txt · 2 处匹配\nL1:C0  needle one\nL4:C7  second needle here',
    );
    // 合成文本自带行号前缀,编辑器行号应关闭
    expect(screen.getByTestId('search-editor')).toHaveAttribute('data-line-numbers', 'false');
  });
});

describe('FileInspectPanel', () => {
  const r: FileInspectReport = {
    path: 'C:/x/a.md',
    file_name: 'a.md',
    ext: 'md',
    category: 'document',
    magic: null,
    size_bytes: 7,
    is_text: true,
    encoding: 'UTF-8',
    lines: 1,
    words: 2,
    chars: 6,
    sha256: 'ab'.repeat(32),
    preview: ['你好 世界'],
    duration_ms: 1,
  };

  it('renders details with human size and copy button', () => {
    render(<FileInspectPanel report={r} />);
    expect(screen.getByText('UTF-8')).toBeInTheDocument();
    expect(screen.getByText(/7 B/)).toBeInTheDocument();
    expect(screen.getByTestId('inspect-copy-sha')).toBeInTheDocument();
  });

  it('renders preview in readonly monaco with inferred language', () => {
    render(<FileInspectPanel report={r} />);
    const editor = screen.getByTestId('inspect-preview-editor');
    expect(editor).toHaveAttribute('data-language', 'markdown');
    expect(screen.getByTestId('inspect-preview-editor-textarea')).toHaveValue('你好 世界');
  });

  it('hides preview for binary file', () => {
    render(
      <FileInspectPanel
        report={{ ...r, is_text: false, encoding: null, lines: null, words: null, chars: null, preview: [] }}
      />,
    );
    expect(screen.queryByTestId('inspect-preview-editor')).toBeNull();
  });

  it('en-US:字段名与类别随语言切换(手动切语言场景),结束恢复 zh 桩', () => {
    changeLocale('en-US');
    const { unmount } = render(<FileInspectPanel report={r} />);
    try {
      expect(screen.getByText('Path')).toBeInTheDocument();
      expect(screen.getByText('Encoding')).toBeInTheDocument();
      expect(screen.getByText('Document')).toBeInTheDocument();
      expect(screen.getByText('7 B (7 bytes)')).toBeInTheDocument();
    } finally {
      unmount();
      changeLocale('zh-CN');
    }
  });
});
