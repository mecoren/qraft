import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// CodeEditor 内嵌 Monaco,jsdom 无法加载,替换为 textarea 替身。
// 暴露 value/onChange/placeholder/title,保持本工具对编辑器的断言面。
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: (props: {
    value: string;
    onChange?: (v: string) => void;
    placeholder?: string;
    title?: string;
    'data-testid'?: string;
    [key: string]: unknown;
  }) => (
    <div data-testid={props['data-testid'] ?? 'code-editor'}>
      <span data-testid={`${props['data-testid'] ?? 'code-editor'}-title`}>{props.title}</span>
      <textarea
        data-testid={`${props['data-testid'] ?? 'code-editor'}-textarea`}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
    </div>
  ),
}));

// resizable 在 jsdom 下不测量,静态渲染保留 children
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

vi.mock('@/lib/ipc', () => {
  class CommandError extends Error {
    readonly code: string;
    readonly details?: unknown;
    constructor(code: string, message: string, details?: unknown) {
      super(message);
      this.name = 'CommandError';
      this.code = code;
      this.details = details;
    }
  }
  return {
    invokeCommand: vi.fn(),
    CommandError,
  };
});

import { RegexTester } from './RegexTester';
import type { RegexLiveOutput } from './regex-lab/types';

/** 防抖窗口 200ms;测试统一等待 400ms 保证触发 */
const DEBOUNCE_WAIT = 400;

/** 构造一份成功的 regex_live 响应(供多个用例复用) */
function okOutput(overrides: Partial<RegexLiveOutput> = {}): RegexLiveOutput {
  return {
    ok: true,
    compileError: null,
    matches: [
      {
        index: 1,
        text: '123',
        range: [4, 7],
        groups: [{ text: '123', start: 4, end: 7 }],
        namedGroups: [],
      },
    ],
    matchCount: 1,
    truncatedText: false,
    matchesTruncated: false,
    substitutionResult: null,
    explain: [
      {
        token: '\\d+',
        title: 'Quantifier: 1 or more',
        description: 'matches greedily, at least once',
        span: [0, 3],
        children: [
          {
            token: '\\d',
            title: 'Character class: digits',
            description: 'matches any digit (`0-9`)',
            span: [0, 2],
            children: [],
            quantifiable: true,
          },
        ],
        quantifiable: false,
      },
    ],
    groups: [],
    durationMs: 3,
    ...overrides,
  };
}

/** 修改 pattern 输入(顶部 /…/ 输入条) */
function setPattern(value: string) {
  fireEvent.change(screen.getByTestId('pattern'), { target: { value } });
}

/** 修改测试文本编辑器 */
function setTestText(value: string) {
  fireEvent.change(screen.getByTestId('input-textarea'), { target: { value } });
}

/** 等真实防抖触发并完成一轮 regex_live */
async function settleLive() {
  await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
}

describe('RegexTester(Regex Lab 工作区)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('渲染正则输入条、flags 组、测试文本编辑器与模式页签', () => {
    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    expect(screen.getByTestId('pattern')).toBeInTheDocument();
    expect(screen.getByTestId('flags-group')).toBeInTheDocument();
    expect(screen.getByTestId('input')).toBeInTheDocument();
    // 四个模式页签(匹配/替换/单元测试/工具)
    expect(screen.getByTestId('mode-match')).toBeInTheDocument();
    expect(screen.getByTestId('mode-substitution')).toBeInTheDocument();
    expect(screen.getByTestId('mode-tests')).toBeInTheDocument();
    expect(screen.getByTestId('mode-tools')).toBeInTheDocument();
    // 右侧:解释面板 + 快速参考
    expect(screen.getByTestId('explain-panel')).toBeInTheDocument();
    expect(screen.getByTestId('quick-reference')).toBeInTheDocument();
  });

  it('输入变化后防抖调用 regex_live 一次往返全量参数', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as Mock).mockResolvedValue(okOutput());

    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    setPattern('\\d+');
    await settleLive();

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('regex_live', {
        input: {
          pattern: '\\d+',
          flags: 'g',
          testText: '',
          substitution: '',
        },
      });
    });
  });

  it('展示匹配信息列表(整体匹配 + 分组)', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as Mock).mockResolvedValue(okOutput());

    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    setPattern('\\d+');
    setTestText('abc 123');
    await settleLive();

    await waitFor(() => {
      expect(screen.getByTestId('match-info-list')).toBeInTheDocument();
    });
    // 匹配条目 #1 与分组徽章
    expect(screen.getByTestId('match-item')).toBeInTheDocument();
    expect(screen.getAllByText('123').length).toBeGreaterThan(0);
  });

  it('编译错误时内联展示(不弹 alert)', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as Mock).mockResolvedValue({
      ok: false,
      compileError: {
        column: 8,
        title: 'unclosed group',
        message: 'unclosed group',
      },
      matches: [],
      matchCount: 0,
      truncatedText: false,
      matchesTruncated: false,
      substitutionResult: null,
      explain: [],
      groups: [],
      durationMs: 0,
    });

    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    setPattern('(unclosed');
    setTestText('hello');
    await settleLive();

    await waitFor(() => {
      expect(screen.getByTestId('compile-error')).toBeInTheDocument();
    });
    // 标题与消息均含 "unclosed group"
    expect(screen.getAllByText('unclosed group').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('@8')).toBeInTheDocument();
    // 点击错误条:光标定位到出错偏移并选中该字符
    const input = screen.getByTestId('pattern') as HTMLInputElement;
    fireEvent.click(screen.getByTestId('compile-error'));
    expect(input.selectionStart).toBe(8);
    expect(input.selectionEnd).toBe(9);
  });

  it('flags 点击切换并反映到请求参数', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as Mock).mockResolvedValue(okOutput());

    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    // 默认 g;再点击 i
    fireEvent.click(screen.getByTestId('flag-i'));
    setPattern('a');
    await settleLive();

    await waitFor(() => {
      const call = (invokeCommand as unknown as Mock).mock.calls.find(
        (c) => c[0] === 'regex_live',
      );
      expect(call).toBeDefined();
      expect(call![1].input.flags).toBe('gi');
    });
  });

  it('切换到单元测试页签,添加用例并运行断言', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as Mock).mockResolvedValue(okOutput());

    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('mode-tests'));

    fireEvent.click(screen.getByTestId('add-test-case'));
    expect(screen.getByTestId('test-case-0')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('case-text-0'), {
      target: { value: 'abc123' },
    });

    (invokeCommand as unknown as Mock).mockResolvedValue({
      ok: true,
      compileError: null,
      results: [{ description: 'Case 1', passed: true, reason: '' }],
      passed: 1,
      failed: 0,
    });
    fireEvent.click(screen.getByTestId('run-tests'));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith(
        'regex_tests',
        expect.objectContaining({
          cases: [expect.objectContaining({ text: 'abc123', shouldMatch: true })],
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('test-result-0')).toBeInTheDocument();
    });
  });

  it('工具页签:代码生成器切换语言并生成', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as Mock).mockResolvedValue({
      language: 'rust',
      code: 'use regex::Regex;',
    });

    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    // 生成按钮需 pattern 非空
    setPattern('\\d+');
    fireEvent.click(screen.getByTestId('mode-tools'));
    fireEvent.click(screen.getByTestId('subtool-codegen'));

    // 语言选择按钮
    expect(screen.getByTestId('codegen-lang-rust')).toBeInTheDocument();
    expect(screen.getByTestId('codegen-lang-python')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('codegen-lang-python'));
    fireEvent.click(screen.getByTestId('generate-code'));

    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith(
        'regex_codegen',
        expect.objectContaining({ language: 'python', pattern: '\\d+' }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('codegen-output')).toHaveTextContent('use regex::Regex;');
    });
  });

  it('工具页签:调试器回放步骤', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as Mock).mockResolvedValue({
      ok: true,
      compileError: null,
      matchCount: 1,
      steps: [
        { start: 0, outcome: 'fail', end: null, matchedText: null },
        { start: 2, outcome: 'match', end: 4, matchedText: '12' },
      ],
    });

    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    // 调试按钮需 pattern 与测试文本非空
    setPattern('\\d+');
    setTestText('ab12');
    fireEvent.click(screen.getByTestId('mode-tools'));

    fireEvent.click(screen.getByTestId('run-debugger'));
    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith(
        'regex_debug',
        expect.objectContaining({ pattern: '\\d+', flags: 'g', text: 'ab12' }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('debug-steps')).toBeInTheDocument();
    });
  });

  it('替换页签:模板输入与结果展示', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as Mock).mockResolvedValue(
      okOutput({ substitutionResult: 'a#b' }),
    );

    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('mode-substitution'));
    fireEvent.change(screen.getByTestId('substitution-input'), {
      target: { value: '#' },
    });
    setPattern('\\d+');
    setTestText('a1b');
    await settleLive();

    await waitFor(() => {
      expect(screen.getByTestId('substitution-output')).toHaveTextContent('a#b');
    });
    // 有结果时提供复制按钮
    expect(screen.getByTestId('copy-substitution')).toBeInTheDocument();
  });

  it('截断时状态徽章与匹配面板给出提示', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as Mock).mockResolvedValue(
      okOutput({
        matchCount: 8000,
        matchesTruncated: true,
        truncatedText: true,
      }),
    );

    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    setPattern('a');
    setTestText('aaa');
    await settleLive();

    await waitFor(() => {
      expect(screen.getByTestId('truncated-badge')).toBeInTheDocument();
    });
    // 匹配面板:展示前 N / 总数 提示
    expect(screen.getByTestId('match-list-truncated')).toBeInTheDocument();
  });

  it('匹配列表首屏限 200 条,点击加载更多', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    // 构造 450 条匹配(超过首屏 200,不足后端 5000 截断)
    const manyMatches = Array.from({ length: 450 }, (_, i) => ({
      index: i + 1,
      text: `m${i}`,
      range: [i, i + 2] as [number, number],
      groups: [],
      namedGroups: [],
    }));
    (invokeCommand as unknown as Mock).mockResolvedValue(
      okOutput({ matches: manyMatches, matchCount: 450 }),
    );

    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    setPattern('m\\d');
    setTestText('text');
    await settleLive();

    await waitFor(() => {
      expect(screen.getAllByTestId('match-item').length).toBe(200);
    });
    fireEvent.click(screen.getByTestId('show-more-matches'));
    expect(screen.getAllByTestId('match-item').length).toBe(400);
  });

  it('快速参考点击插入到 pattern 光标位置', () => {
    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    setPattern('ab');
    const input = screen.getByTestId('pattern') as HTMLInputElement;
    // 光标置于 a、b 之间(offset 1)
    input.setSelectionRange(1, 1);
    // 点击量词分类中的 "a{3}" token(通过精确文本定位按钮)
    const buttons = screen.getAllByRole('button');
    const tokenBtn = buttons.find(
      (b) => b.textContent?.includes('a{3}'),
    );
    expect(tokenBtn).toBeDefined();
    fireEvent.click(tokenBtn!);
    // 光标位置插入:a + a{3} + b
    expect((screen.getByTestId('pattern') as HTMLInputElement).value).toBe('aa{3}b');
  });

  it('快速参考可搜索并过滤条目', () => {
    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    // 全量应含多个分类标题(锚点/量词等)
    expect(screen.getByText('锚点')).toBeInTheDocument();
    expect(screen.getByText('量词')).toBeInTheDocument();

    const search = screen.getByTestId('quick-reference-search');
    // 搜"贪婪"只保留量词分类(token 描述含"贪婪",锚点类不含)
    fireEvent.change(search, { target: { value: '贪婪' } });
    expect(screen.queryByText('锚点')).not.toBeInTheDocument();
    expect(screen.getByText('量词')).toBeInTheDocument();

    // 搜不存在的词 → 空态
    fireEvent.change(search, { target: { value: 'zzz不存在的token' } });
    expect(screen.getByText(/没有匹配的条目/)).toBeInTheDocument();
  });

  it('会话状态写入 localStorage 供下次恢复', () => {
    render(<RegexTester toolId="regex_tester" metadata={null as never} />);
    setPattern('\\d{4}');
    fireEvent.click(screen.getByTestId('flag-i'));

    const raw = localStorage.getItem('qraft.regex_lab.session.v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { pattern: string; flags: string };
    expect(parsed.pattern).toBe('\\d{4}');
    expect(parsed.flags).toContain('i');
  });
});
