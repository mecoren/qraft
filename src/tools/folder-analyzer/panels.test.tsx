import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

  it('shows truncated warning', () => {
    render(<ScanResultsPanel report={{ ...scanFixture, truncated: true }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/截断/);
  });
});

describe('SearchResultsPanel', () => {
  it('renders grouped matches with line numbers', () => {
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
    render(<SearchResultsPanel report={report} />);
    expect(screen.getByText('C:/p/a.txt')).toBeInTheDocument();
    expect(screen.getByText(/L1/)).toBeInTheDocument();
    expect(screen.getByText(/L4/)).toBeInTheDocument();
  });
});

describe('FileInspectPanel', () => {
  it('renders details for text file', () => {
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
    render(<FileInspectPanel report={r} />);
    expect(screen.getByText('UTF-8')).toBeInTheDocument();
    expect(screen.getByText('你好 世界')).toBeInTheDocument();
  });
});
