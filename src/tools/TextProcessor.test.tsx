import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  TextProcessor,
  chineseSymbolToEnglish,
  chineseToUnicode,
  escapeText,
  stripWhitespace,
  unicodeToChinese,
  urlDecode,
  urlEncode,
} from './TextProcessor';

// CodeEditor 内嵌 Monaco,在 jsdom 环境无法加载,替换为简单的 textarea 替身。
// Test environment is jsdom, which can't load the Monaco editor. We stub CodeEditor
// with a minimal textarea so the toolbar (the focus of these tests) still mounts
// and its onChange propagates correctly.
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: ({
    value,
    onChange,
    readOnly,
    'data-testid': testId,
  }: {
    value: string;
    onChange?: (v: string) => void;
    readOnly?: boolean;
    'data-testid'?: string;
  }) => (
    <div data-testid={testId}>
      <textarea
        data-testid={testId ? `${testId}-textarea` : undefined}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly={readOnly}
      />
    </div>
  ),
}));

// Resizable 在 jsdom 下没有 ResizeObserver,直接渲染静态面板以保留 children。
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

describe('TextProcessor utilities', () => {
  it('escapeText handles common control characters', () => {
    expect(escapeText('a\nb\tc"d\\e')).toBe('a\\nb\\tc\\"d\\\\e');
  });

  it('stripWhitespace removes spaces, tabs and newlines', () => {
    expect(stripWhitespace('  a b\nc\td  ')).toBe('abcd');
  });

  it('urlEncode / urlDecode roundtrip', () => {
    const s = '你好，世界!';
    const enc = urlEncode(s);
    expect(enc).not.toContain('你');
    expect(urlDecode(enc)).toBe(s);
  });

  it('unicodeToChinese decodes \\uXXXX escapes back to characters', () => {
    expect(unicodeToChinese('\\u4f60\\u597d')).toBe('你好');
  });

  it('chineseToUnicode encodes non-ASCII characters to \\uXXXX', () => {
    expect(chineseToUnicode('hi 你好')).toBe('hi \\u4f60\\u597d');
  });

  it('chineseSymbolToEnglish replaces full-width punctuation', () => {
    expect(chineseSymbolToEnglish('你好，世界！今天？'))
      .toBe('你好,世界!今天?');
  });
});

/**
 * 用于断言给定的 transform test-id 落在哪个内层 ButtonGroup 容器下,
 * 验证「相同的合并,不同的留间隙」的分组结构正确性。
 */
function withinGroup(groupTestId: string, btnTestId: string): boolean {
  const group = screen.getByTestId(groupTestId);
  return Boolean(group.querySelector(`[data-testid="${btnTestId}"]`));
}

describe('TextProcessor component', () => {
  const getInput = (): HTMLTextAreaElement =>
    screen.getByTestId('input').querySelector('textarea')!;

  it('renders an outer ButtonGroup with 4 nested ButtonGroup subgroups', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    // 外层容器
    expect(screen.getByTestId('textproc-button-group')).toBeInTheDocument();
    // 4 个内层子组
    expect(
      screen.getByTestId('textproc-group-escape-stripWhitespace'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('textproc-group-urlEncode-urlDecode'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('textproc-group-unicodeToChinese-chineseToUnicode'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('textproc-group-chineseSymbolToEnglish'),
    ).toBeInTheDocument();
  });

  it('groups related transforms together (same group) and separates different ones', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);

    // 转义 / 去空格 —— 同组(字符集整理),应共处
    expect(
      withinGroup(
        'textproc-group-escape-stripWhitespace',
        'textproc-btn-escape',
      ),
    ).toBe(true);
    expect(
      withinGroup(
        'textproc-group-escape-stripWhitespace',
        'textproc-btn-stripWhitespace',
      ),
    ).toBe(true);

    // URL 编 / 解码 —— 同组
    expect(
      withinGroup('textproc-group-urlEncode-urlDecode', 'textproc-btn-urlEncode'),
    ).toBe(true);
    expect(
      withinGroup('textproc-group-urlEncode-urlDecode', 'textproc-btn-urlDecode'),
    ).toBe(true);

    // Unicode <-> 中文 —— 同组
    expect(
      withinGroup(
        'textproc-group-unicodeToChinese-chineseToUnicode',
        'textproc-btn-unicodeToChinese',
      ),
    ).toBe(true);
    expect(
      withinGroup(
        'textproc-group-unicodeToChinese-chineseToUnicode',
        'textproc-btn-chineseToUnicode',
      ),
    ).toBe(true);

    // 中文符号转英文 —— 单独成组
    expect(
      withinGroup(
        'textproc-group-chineseSymbolToEnglish',
        'textproc-btn-chineseSymbolToEnglish',
      ),
    ).toBe(true);
  });

  it('does not place unrelated transforms in the same inner group', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    // urlEncode 不应出现在 escape / stripWhitespace 组
    expect(
      withinGroup(
        'textproc-group-escape-stripWhitespace',
        'textproc-btn-urlEncode',
      ),
    ).toBe(false);
    // 中文符号转英文不应与 Unicode <-> 中文 同组
    expect(
      withinGroup(
        'textproc-group-unicodeToChinese-chineseToUnicode',
        'textproc-btn-chineseSymbolToEnglish',
      ),
    ).toBe(false);
  });

  it('disables all buttons while input is empty', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    expect(screen.getByTestId('textproc-btn-escape')).toBeDisabled();
    expect(screen.getByTestId('textproc-btn-urlEncode')).toBeDisabled();
  });

  it('escape button replaces input text with escaped result and mirrors output', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: 'a\nb' } });
    fireEvent.click(screen.getByTestId('textproc-btn-escape'));
    expect(getInput().value).toBe('a\\nb');
    const output = screen
      .getByTestId('output')
      .querySelector('textarea')!.value;
    expect(output).toBe('a\\nb');
  });

  it('stripWhitespace button removes all whitespace from input', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: '  hello\n world\t!  ' } });
    fireEvent.click(screen.getByTestId('textproc-btn-stripWhitespace'));
    expect(getInput().value).toBe('helloworld!');
  });

  it('urlEncode then urlDecode roundtrips input', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    const original = 'hi 你';
    fireEvent.change(getInput(), { target: { value: original } });
    fireEvent.click(screen.getByTestId('textproc-btn-urlEncode'));
    expect(getInput().value).toBe(urlEncode(original));
    fireEvent.click(screen.getByTestId('textproc-btn-urlDecode'));
    expect(getInput().value).toBe(original);
  });

  it('chineseSymbolToEnglish button replaces punctuation in place', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: '你好，世界。' } });
    fireEvent.click(screen.getByTestId('textproc-btn-chineseSymbolToEnglish'));
    expect(getInput().value).toBe(chineseSymbolToEnglish('你好，世界。'));
  });

  it('chineseToUnicode then unicodeToChinese roundtrips input', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    const original = '你好';
    fireEvent.change(getInput(), { target: { value: original } });
    fireEvent.click(screen.getByTestId('textproc-btn-chineseToUnicode'));
    expect(getInput().value).toBe(chineseToUnicode(original));
    fireEvent.click(screen.getByTestId('textproc-btn-unicodeToChinese'));
    expect(getInput().value).toBe(original);
  });
});
