import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { changeLocale } from '@/i18n';

import {
  TextProcessor,
  chineseSymbolToEnglish,
  chineseToUnicode,
  computeStats,
  escapeText,
  stripWhitespace,
  unicodeToChinese,
  unescapeText,
  urlDecode,
  urlEncode,
  urlEncodeUri,
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
    title,
    actions,
    statusBarRight,
    showCharCount = true,
    showStatusBar = true,
    'data-testid': testId,
  }: {
    value: string;
    onChange?: (v: string) => void;
    readOnly?: boolean;
    title?: string;
    actions?: React.ReactNode;
    statusBarRight?: React.ReactNode;
    showCharCount?: boolean;
    showStatusBar?: boolean;
    'data-testid'?: string;
  }) => (
    <div data-testid={testId}>
      <div>
        {title && <span>{title}</span>}
        {actions}
      </div>
      <textarea
        data-testid={testId ? `${testId}-textarea` : undefined}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly={readOnly}
      />
      {showStatusBar && (
        <div data-testid={testId ? `${testId}-status` : undefined}>
          <span data-testid={testId ? `${testId}-status-pos` : undefined}>
            行 1, 列 {value.length + 1}
          </span>
          {value.length > 0 && (
            <span data-testid={testId ? `${testId}-status-sel` : undefined}>
              (已选择{value.length})
            </span>
          )}
          {statusBarRight ? (
            <span>{statusBarRight}</span>
          ) : (
            showCharCount && (
              <span data-testid={testId ? `${testId}-char-count` : undefined}>
                {Array.from(value).length} 字符
              </span>
            )
          )}
        </div>
      )}
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

// 复制统计测试:拦截 copyTextWithFeedback,避免依赖 jsdom 剪贴板
const { copySpy } = vi.hoisted(() => ({ copySpy: vi.fn() }));
vi.mock('@/lib/toast-alert', () => ({
  copyTextWithFeedback: (text: string) => copySpy(text),
}));

describe('TextProcessor utilities', () => {
  it('escapeText handles common control characters', () => {
    expect(escapeText('a\nb\tc"d\\e')).toBe('a\\nb\\tc\\"d\\\\e');
  });

  it('unescapeText decodes common escape sequences back to raw characters', () => {
    expect(unescapeText('a\\nb\\tc\\"d\\\\e')).toBe('a\nb\tc"d\\e');
  });

  it('unescapeText is the inverse of escapeText (roundtrip)', () => {
    const s = 'a\nb\tc"d\'e\\f\r 你好';
    expect(unescapeText(escapeText(s))).toBe(s);
  });

  it('unescapeText decodes \\uXXXX escapes including surrogate pairs', () => {
    expect(unescapeText('\\u4f60\\u597d')).toBe('你好');
    expect(unescapeText('\\ud83d\\ude00')).toBe('😀');
  });

  it('unescapeText keeps unknown escapes and a trailing lone backslash intact', () => {
    // \d 无法识别 → 原样保留;\u12 位数不足 → 原样保留
    expect(unescapeText('\\d\\u12')).toBe('\\d\\u12');
    expect(unescapeText('abc\\')).toBe('abc\\');
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

  it('urlEncodeUri keeps reserved characters of a full URL (encodeURI semantics)', () => {
    // 整 URL 编码(encodeURI)::/?&= 等保留字符原样,仅编码中文等不安全字符
    const url = 'https://a.com/path?q=你好&x=1';
    const enc = urlEncodeUri(url);
    expect(enc).toContain('https://a.com/path?q=');
    expect(enc).toContain('&x=1');
    expect(enc).not.toContain('你');
    expect(enc).toContain('%E4%BD%A0');
  });

  it('unicodeToChinese decodes \\uXXXX escapes back to characters', () => {
    expect(unicodeToChinese('\\u4f60\\u597d')).toBe('你好');
  });

  it('chineseToUnicode encodes non-ASCII characters to \\uXXXX', () => {
    expect(chineseToUnicode('hi 你好')).toBe('hi \\u4f60\\u597d');
  });

  it('chineseSymbolToEnglish replaces full-width punctuation', () => {
    expect(chineseSymbolToEnglish('你好，世界！今天？')).toBe('你好,世界!今天?');
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

describe('computeStats', () => {
  it('统计字符/去空白字符/单词/行/字节,且按 Unicode 码点计数', () => {
    const s = computeStats('hello 世界\nfoo bar');
    expect(s.chars).toBe(16);
    expect(s.charsNoSpaces).toBe(13);
    expect(s.words).toBe(4);
    expect(s.lines).toBe(2);
    expect(s.bytes).toBe(5 + 1 + 6 + 1 + 3 + 1 + 3);
  });

  it('emoji 按码点计数:chars 与 charsNoSpaces 都只算 1 个', () => {
    const s = computeStats('a 😀 b');
    expect(s.chars).toBe(5);
    expect(s.charsNoSpaces).toBe(3);
  });

  it('空输入返回全零统计', () => {
    expect(computeStats('')).toEqual({
      chars: 0,
      charsNoSpaces: 0,
      words: 0,
      lines: 0,
      bytes: 0,
      sentences: 0,
      paragraphs: 0,
    });
  });
});

describe('TextProcessor component', () => {
  const getInput = (): HTMLTextAreaElement =>
    screen.getByTestId('input').querySelector('textarea')!;

  it('renders two outer ButtonGroup rows with nested subgroups', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    // 两个外层容器:第一排(转换/符号)、第二排(大小写/行重组)
    expect(screen.getByTestId('textproc-button-group-row1')).toBeInTheDocument();
    expect(screen.getByTestId('textproc-button-group-row2')).toBeInTheDocument();
    // 第一排 4 个内层子组
    expect(
      screen.getByTestId('textproc-group-escape-unescape-stripWhitespace'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('textproc-group-urlEncode-urlEncodeUri-urlDecode'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('textproc-group-unicodeToChinese-chineseToUnicode'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('textproc-group-chineseSymbolToEnglish')).toBeInTheDocument();
    // 第二排子组(大小写 / 行重组)
    expect(
      screen.getByTestId(
        'textproc-group-toUpperCase-toLowerCase-capitalizeSentences-capitalizeWords',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('textproc-group-reverseText-uniqueLines-sortLines'),
    ).toBeInTheDocument();
  });

  it('groups related transforms together (same group) and separates different ones', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);

    // 转义 / 去除转义 / 去空格 —— 同组(字符集整理,转义与去除转义互为反操作),应共处
    expect(
      withinGroup('textproc-group-escape-unescape-stripWhitespace', 'textproc-btn-escape'),
    ).toBe(true);
    expect(
      withinGroup('textproc-group-escape-unescape-stripWhitespace', 'textproc-btn-unescape'),
    ).toBe(true);
    expect(
      withinGroup('textproc-group-escape-unescape-stripWhitespace', 'textproc-btn-stripWhitespace'),
    ).toBe(true);

    // URL 编 / 解码 —— 同组(编码 / 整体编码 / 解码)
    expect(
      withinGroup('textproc-group-urlEncode-urlEncodeUri-urlDecode', 'textproc-btn-urlEncode'),
    ).toBe(true);
    expect(
      withinGroup('textproc-group-urlEncode-urlEncodeUri-urlDecode', 'textproc-btn-urlEncodeUri'),
    ).toBe(true);
    expect(
      withinGroup('textproc-group-urlEncode-urlEncodeUri-urlDecode', 'textproc-btn-urlDecode'),
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
      withinGroup('textproc-group-chineseSymbolToEnglish', 'textproc-btn-chineseSymbolToEnglish'),
    ).toBe(true);
  });

  it('does not place unrelated transforms in the same inner group', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    // urlEncode 不应出现在 escape / unescape / stripWhitespace 组
    expect(
      withinGroup('textproc-group-escape-unescape-stripWhitespace', 'textproc-btn-urlEncode'),
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

  it('escape button writes escaped result to output and keeps input intact', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: 'a\nb' } });
    fireEvent.click(screen.getByTestId('textproc-btn-escape'));
    expect(getInput().value).toBe('a\nb');
    const output = screen.getByTestId('output').querySelector('textarea')!.value;
    expect(output).toBe('a\\nb');
  });

  it('unescape button decodes escaped input into the output and keeps input intact', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: 'a\\nb\\"c' } });
    fireEvent.click(screen.getByTestId('textproc-btn-unescape'));
    expect(getInput().value).toBe('a\\nb\\"c');
    expect(screen.getByTestId('output').querySelector('textarea')!.value).toBe('a\nb"c');
  });

  it('stripWhitespace button writes stripped result to output and keeps input intact', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: '  hello\n world\t!  ' } });
    fireEvent.click(screen.getByTestId('textproc-btn-stripWhitespace'));
    expect(getInput().value).toBe('  hello\n world\t!  ');
    expect(screen.getByTestId('output').querySelector('textarea')!.value).toBe('helloworld!');
  });

  it('urlEncode then urlDecode each write their result to output (input unchanged)', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    const original = 'hi 你';
    fireEvent.change(getInput(), { target: { value: original } });
    fireEvent.click(screen.getByTestId('textproc-btn-urlEncode'));
    expect(getInput().value).toBe(original);
    expect(screen.getByTestId('output').querySelector('textarea')!.value).toBe(urlEncode(original));
    fireEvent.click(screen.getByTestId('textproc-btn-urlDecode'));
    expect(getInput().value).toBe(original);
    // urlDecode acts on the input; since the input is not percent-encoded, its
    // result equals the (unchanged) input, so the transform is a no-op and the
    // existing encoded output is left untouched.
    expect(screen.getByTestId('output').querySelector('textarea')!.value).toBe(urlEncode(original));
  });

  it('chineseSymbolToEnglish button replaces punctuation in place', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: '你好，世界。' } });
    fireEvent.click(screen.getByTestId('textproc-btn-chineseSymbolToEnglish'));
    expect(getInput().value).toBe('你好，世界。');
    expect(screen.getByTestId('output').querySelector('textarea')!.value).toBe(
      chineseSymbolToEnglish('你好，世界。'),
    );
  });

  it('chineseToUnicode writes \\uXXXX to output and keeps input intact', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    const original = '你好';
    fireEvent.change(getInput(), { target: { value: original } });
    fireEvent.click(screen.getByTestId('textproc-btn-chineseToUnicode'));
    expect(getInput().value).toBe(original);
    const output = screen.getByTestId('output').querySelector('textarea')!;
    expect(output.value).toBe(chineseToUnicode(original));
    // unicodeToChinese acts on the input; since its result equals the (unchanged)
    // input, the transform is a no-op and the existing output is left untouched.
    fireEvent.click(screen.getByTestId('textproc-btn-unicodeToChinese'));
    expect(output.value).toBe(chineseToUnicode(original));
  });

  it('urlDecode decodes a percent-encoded input into the output', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    const encoded = 'hi%20%E4%BD%A0';
    fireEvent.change(getInput(), { target: { value: encoded } });
    fireEvent.click(screen.getByTestId('textproc-btn-urlDecode'));
    expect(getInput().value).toBe(encoded);
    expect(screen.getByTestId('output').querySelector('textarea')!.value).toBe(urlDecode(encoded));
  });

  it('shows 0-character counts in both status bars when empty', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    // 字符统计由 EditorStats 渲染,位于各编辑器状态栏内(textproc-stat-chars 为纯数字)
    expect(
      within(screen.getByTestId('input-status')).getByTestId('textproc-stat-chars').textContent,
    ).toBe('0');
    expect(
      within(screen.getByTestId('output-status')).getByTestId('textproc-stat-chars').textContent,
    ).toBe('0');
  });

  it('places the char count inside the status bar, not the header', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    const inputStatus = screen.getByTestId('input-status');
    const outputStatus = screen.getByTestId('output-status');
    expect(within(inputStatus).getByTestId('textproc-stat-chars')).toBeInTheDocument();
    expect(within(outputStatus).getByTestId('textproc-stat-chars')).toBeInTheDocument();
  });

  it('updates the input char count as the user types', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: '你好，世界!' } });
    expect(
      within(screen.getByTestId('input-status')).getByTestId('textproc-stat-chars').textContent,
    ).toBe('6');
  });

  it('counts by Unicode code points (emoji is a single char, not two)', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: 'a😀' } });
    expect(
      within(screen.getByTestId('input-status')).getByTestId('textproc-stat-chars').textContent,
    ).toBe('2');
  });

  it('updates the output char count after a transform', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: '你好，世界!' } });
    fireEvent.click(screen.getByTestId('textproc-btn-urlEncode'));
    const encoded = urlEncode('你好，世界!');
    expect(
      within(screen.getByTestId('output-status')).getByTestId('textproc-stat-chars').textContent,
    ).toBe(String(Array.from(encoded).length));
  });

  it('shows the chars-no-spaces metric in both status bars', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: 'hello 世界' } });
    // 'hello 世界' 共 8 个码点,空白 1 个 → 去空白字符 7
    expect(
      within(screen.getByTestId('input-status')).getByTestId('textproc-stat-chars-no-spaces')
        .textContent,
    ).toBe('7');
    // 输出为空时去空白字符为 0
    expect(
      within(screen.getByTestId('output-status')).getByTestId('textproc-stat-chars-no-spaces')
        .textContent,
    ).toBe('0');
  });

  it('copy button writes the stats summary to the clipboard', () => {
    copySpy.mockClear();
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: 'hello world' } });
    fireEvent.click(
      within(screen.getByTestId('input-status')).getByTestId('textproc-stats-copy'),
    );
    expect(copySpy).toHaveBeenCalledTimes(1);
    const summary = copySpy.mock.calls[0][0] as string;
    // 汇总为逐行「标签: 数值」格式
    expect(summary).toContain('字符: 11');
    expect(summary).toContain('去空白字符: 10');
    expect(summary).toContain('单词: 2');
    expect(summary).toContain('行: 1');
    expect(summary).toContain('字节: 11');
    expect(summary).toContain('句子: 0');
    expect(summary).toContain('段落: 1');
  });

  it('output status bar has its own copy button reflecting output stats', () => {
    copySpy.mockClear();
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: 'a b' } });
    fireEvent.click(screen.getByTestId('textproc-btn-stripWhitespace'));
    fireEvent.click(
      within(screen.getByTestId('output-status')).getByTestId('textproc-stats-copy'),
    );
    const summary = copySpy.mock.calls[0][0] as string;
    // 去空格后输出为 'ab':字符 2、去空白字符 2
    expect(summary).toContain('字符: 2');
    expect(summary).toContain('去空白字符: 2');
  });

  it('renders a status bar at the bottom of each editor showing line/column', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    expect(screen.getByTestId('input-status-pos').textContent).toBe('行 1, 列 1');
    expect(screen.getByTestId('output-status-pos').textContent).toBe('行 1, 列 1');
    // 空内容时不应显示「已选择」
    expect(screen.queryByTestId('input-status-sel')).toBeNull();
    expect(screen.queryByTestId('output-status-sel')).toBeNull();
  });

  it('shows the selection count in the status bar when the input is non-empty', () => {
    render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    fireEvent.change(getInput(), { target: { value: 'hello' } });
    // mock 中 mock 的选区长度 = value.length
    expect(screen.getByTestId('input-status-sel').textContent).toBe('(已选择5)');
  });

  it('en-US:按钮/统计/标题文案随语言切换(手动切语言场景),结束恢复 zh 桩', () => {
    changeLocale('en-US');
    // 先卸载再切回 zh 桩,避免异步 languageChanged 在 act 环境外触发告警更新
    const { unmount } = render(<TextProcessor toolId="json_minifier" metadata={null as never} />);
    try {
      expect(screen.getByTestId('textproc-btn-escape').textContent).toBe('Escape');
      expect(
        within(screen.getByTestId('input-status')).getByTestId('textproc-stat-chars').textContent,
      ).toBe('0');
      expect(screen.getByTestId('input-status').textContent).toContain('chars');
    } finally {
      unmount();
      changeLocale('zh-CN');
    }
  });
});
