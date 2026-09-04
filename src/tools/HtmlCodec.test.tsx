import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HtmlCodec } from './HtmlCodec';
import { decodeHtml, encodeHtml, isReversible } from './html-codec-utils';

vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: (props: {
    'data-testid'?: string;
    value?: string;
    onChange?: (v: string) => void;
  }) => (
    <div data-testid={props['data-testid']}>
      <span>{props.value}</span>
      <textarea
        aria-label="input"
        data-testid={`${props['data-testid']}-textarea`}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
    </div>
  ),
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

// Radix Select 在 jsdom 下需要真实指针事件,简化替身直接暴露原生 select
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children: React.ReactNode }) => (
    <div>
      <div data-testid="select-value">{value}</div>
      <button
        type="button"
        data-testid="select-trigger"
        onClick={() => onValueChange?.(value === 'minimal' ? 'nonAscii' : 'all')}
      >
        cycle
      </button>
      {children}
    </div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-value={value}>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <div />,
}));

describe('html-codec-utils', () => {
  it('minimal 模式只转义 & < > " \'', () => {
    expect(encodeHtml('<a href="x">&\'</a>', 'minimal')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('minimal 模式不转义非 ASCII', () => {
    expect(encodeHtml('你好', 'minimal')).toBe('你好');
  });

  it('nonAscii 模式输出纯 ASCII', () => {
    const out = encodeHtml('中文 & <em>强调</em> 🎉', 'nonAscii');
    // eslint-disable-next-line no-control-regex -- ASCII 区间断言,\x00 仅作区间端点
    expect(out).toMatch(/^[\x00-\x7f]*$/);
    expect(out).toContain('&amp;');
    // roundtrip 还原
    expect(decodeHtml(out)).toBe('中文 & <em>强调</em> 🎉');
  });

  it('all 模式使用命名实体', () => {
    const out = encodeHtml('a—b·c€d', 'all');
    expect(out).toContain('&mdash;');
    expect(out).toContain('&middot;');
    expect(out).toContain('&euro;');
    expect(decodeHtml(out)).toBe('a—b·c€d');
  });

  it('解码命名实体(含 nbsp/copy)', () => {
    expect(decodeHtml('&nbsp;&copy;2024')).toBe('\u00a0\u00a92024');
    expect(decodeHtml('&hellip;')).toBe('…');
  });

  it('解码数字实体(十进制与十六进制)', () => {
    expect(decodeHtml('&#20320;&#x597D;')).toBe('你好');
    expect(decodeHtml('&#65;')).toBe('A');
  });

  it('未知实体原样保留', () => {
    expect(decodeHtml('&unknownentity;')).toBe('&unknownentity;');
  });

  it('分号可省略的宽松解码(&amp → &)', () => {
    expect(decodeHtml('a &amp b')).toBe('a & b');
  });

  it('代理区与越界码点解码为替换字符', () => {
    expect(decodeHtml('&#xD800;')).toBe('\ufffd');
    expect(decodeHtml('&#x110000;')).toBe('\ufffd');
  });

  it('isReversible:三模式 roundtrip', () => {
    const samples = ['plain', '<b>&"\'</b>', '中文 🎉 —– …'];
    for (const mode of ['minimal', 'nonAscii', 'all'] as const) {
      for (const s of samples) {
        // minimal 模式对非 ASCII 原样保留,同样可逆
        expect(isReversible(s, mode)).toBe(true);
      }
    }
  });
});

describe('HtmlCodec 组件', () => {
  it('编码模式切换与级别选择联动', () => {
    render(<HtmlCodec toolId="html_codec" metadata={null as never} />);
    const textarea = screen.getByTestId('html-input-textarea');
    fireEvent.change(textarea, { target: { value: '你好<>&' } });
    // 默认 minimal:非 ASCII 保留
    expect(screen.getByTestId('html-output').querySelector('span')!.textContent).toBe(
      '你好&lt;&gt;&amp;',
    );
  });

  it('解码模式还原实体', () => {
    render(<HtmlCodec toolId="html_codec" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('html-mode-switch'));
    fireEvent.change(screen.getByTestId('html-input-textarea'), {
      target: { value: '&lt;p&gt;你好&lt;/p&gt;' },
    });
    expect(screen.getByTestId('html-output').querySelector('span')!.textContent).toBe(
      '<p>你好</p>',
    );
  });
});
