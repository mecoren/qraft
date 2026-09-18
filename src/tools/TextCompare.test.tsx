import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// Mock @/lib/ipc:safeInvoke 默认失败,hydrate 走默认空态(与 JsonFormatter 测试同模式)
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
    safeInvoke: vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'mock', message: 'mocked' } }),
    ),
  };
});

// 补丁下载内容断言(downloadText mock 捕获参数;其余导出原样透传)
vi.mock('@/lib/file-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/file-utils')>();
  return { ...actual, downloadText: vi.fn() };
});

// 导入必须在 mock 声明之后,确保组件拿到的是 mocked 模块
import { TextCompare } from './TextCompare';
import { DEFAULT_COMPARE_OPTIONS, useTextCompareStore } from './textCompareStore';
import { requestHandoff, useHandoffStore } from '@/store/handoffStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { applyDiffBlockCopy, computeLineDiff } from '@/components/text-diff/diff-utils';

describe('TextCompare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHandoffStore.setState({ pending: null });
    // zustand 模块级单例:每个用例重置为「单个空白文档」初始态,避免跨用例污染
    useTextCompareStore.setState({
      docs: [
        {
          id: 'default',
          title: 'compare-1',
          autoTitle: 'compare-1',
          pinned: false,
          original: '',
          modified: '',
        },
      ],
      activeDocId: 'default',
      options: { ...DEFAULT_COMPARE_OPTIONS },
      ready: false,
      userTouched: false,
      error: null,
    });
  });

  const getOriginalEditor = (): HTMLTextAreaElement =>
    screen.getByTestId('diff-original').querySelector('textarea')!;
  const getModifiedEditor = (): HTMLTextAreaElement =>
    screen.getByTestId('diff-modified').querySelector('textarea')!;

  it('默认渲染并排布局:Tab 栏 + 双编辑器 + 统计徽标', () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    expect(screen.getByTestId('doc-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('diff-original')).toBeInTheDocument();
    expect(screen.getByTestId('diff-modified')).toBeInTheDocument();
    expect(screen.queryByTestId('diff-inline')).not.toBeInTheDocument();
    expect(screen.getByTestId('diff-stats')).toHaveTextContent('无差异');
  });

  it('工具栏在并排/行内布局间切换,行内模式隐藏同步滚动按钮', () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    // 并排模式:同步滚动按钮可见,无行内 DiffEditor
    expect(screen.getByTestId('diff-sync-scroll')).toBeInTheDocument();
    expect(screen.queryByTestId('monaco-diff-editor')).not.toBeInTheDocument();

    // 切到行内:并排编辑器卸载,单体 DiffEditor 接管,同步滚动按钮隐藏
    fireEvent.click(screen.getByTestId('diff-inline-toggle'));
    expect(screen.getByTestId('diff-inline')).toBeInTheDocument();
    expect(screen.getByTestId('monaco-diff-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('diff-original')).not.toBeInTheDocument();
    expect(screen.queryByTestId('diff-modified')).not.toBeInTheDocument();
    expect(screen.queryByTestId('diff-sync-scroll')).not.toBeInTheDocument();

    // 切回并排:双编辑器重新挂载
    fireEvent.click(screen.getByTestId('diff-inline-toggle'));
    expect(screen.getByTestId('diff-original')).toBeInTheDocument();
    expect(screen.getByTestId('diff-modified')).toBeInTheDocument();
    expect(screen.queryByTestId('diff-inline')).not.toBeInTheDocument();
  });

  it('行内模式内容与文档同步,修改侧编辑写回当前文档且原始侧只读', () => {
    useTextCompareStore.setState({
      docs: [
        {
          id: 'default',
          title: 'compare-1',
          autoTitle: 'compare-1',
          pinned: false,
          original: 'a\nb',
          modified: 'a\nc',
        },
      ],
      activeDocId: 'default',
    });
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('diff-inline-toggle'));

    expect(screen.getByTestId('monaco-diff-original')).toHaveValue('a\nb');
    expect(screen.getByTestId('monaco-diff-original')).toHaveProperty('readOnly', true);
    expect(screen.getByTestId('monaco-diff-modified')).toHaveValue('a\nc');
    expect(screen.getByTestId('monaco-diff-modified')).toHaveProperty('readOnly', false);

    // 行内模式修改侧可编辑:改动写回当前文档(与并排模式右侧编辑器同源)
    fireEvent.change(screen.getByTestId('monaco-diff-modified'), { target: { value: 'a\nd' } });
    expect(useTextCompareStore.getState().docs[0].modified).toBe('a\nd');
  });

  it('差异统计随内容变化刷新', async () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    // 连续增删段配对后:1 行修改 + 1 行纯新增
    fireEvent.change(getOriginalEditor(), { target: { value: 'a\nb' } });
    fireEvent.change(getModifiedEditor(), { target: { value: 'a\nx\nc' } });
    await waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('+1');
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('~1');
    });
  });

  it('大输入(超同步阈值)统计最终一致:走异步 service 路径不丢结果', async () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    // 单侧 ~40k 字符(超过 DIFF_SYNC_MAX_CHARS=30k),jsdom 无 Worker 时经
    // service 同步降级,验证异步链路下统计徽标最终一致、不清空
    const base = 'x'.repeat(40_000);
    fireEvent.change(getOriginalEditor(), { target: { value: base } });
    fireEvent.change(getModifiedEditor(), { target: { value: `${base}!` } });
    await waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('~1');
    });
  });

  it('行内模式切换 Tab 后编辑写回新激活文档', () => {
    useTextCompareStore.setState({
      docs: [
        {
          id: 'a',
          title: 'compare-1',
          autoTitle: 'compare-1',
          pinned: false,
          original: 'x',
          modified: 'y',
        },
        {
          id: 'b',
          title: 'compare-2',
          autoTitle: 'compare-2',
          pinned: false,
          original: '1',
          modified: '2',
        },
      ],
      activeDocId: 'a',
    });
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('diff-inline-toggle'));

    // 切到第二个 Tab(DiffEditor 不重挂载,onMount 监听不重注册)
    fireEvent.click(screen.getAllByTestId('doc-tab')[1]);
    fireEvent.change(screen.getByTestId('monaco-diff-modified'), { target: { value: 'changed' } });

    const docs = useTextCompareStore.getState().docs;
    expect(docs.find((d) => d.id === 'b')?.modified).toBe('changed');
    expect(docs.find((d) => d.id === 'a')?.modified).toBe('y');
  });

  it('差异统计与操作按钮紧跟「修改后文本」标题展示(VSCode 风格,不贴工具栏右缘)', () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    const header = screen.getByTestId('diff-modified-header');
    expect(header).toContainElement(screen.getByTestId('diff-stats'));
    expect(header).toContainElement(screen.getByTestId('diff-inline-toggle'));
    expect(header).toContainElement(screen.getByTestId('diff-sync-scroll'));
  });

  it('空白忽略默认开启(VSCode 同义):仅空白差异时直接无差异,关闭后显形', async () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    // 开关默认按下
    expect(screen.getByTestId('diff-ignore-ws')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(getOriginalEditor(), { target: { value: 'a   \nb' } });
    fireEvent.change(getModifiedEditor(), { target: { value: 'a\nb' } });
    await waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('无差异');
    });
    // 关闭忽略 → 空白差异显形为修改
    fireEvent.click(screen.getByTestId('diff-ignore-ws'));
    await waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('~1');
    });
  });

  it('重启还原已持久化的比较选项(按钮按下态跟随 store)', () => {
    // hydrate 把 Rust config 的选项写进 store(此处直接置 store 模拟还原后);
    // 开关只读 store,无本地 state,天然跟随
    useTextCompareStore.setState({
      options: { ignoreWhitespace: false, ignoreCase: true, ignoreEol: false },
    });
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    expect(screen.getByTestId('diff-ignore-ws')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('diff-ignore-case')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('diff-ignore-eol')).toHaveAttribute('aria-pressed', 'false');
  });

  it('忽略大小写开关:仅大小写差异时统计归零', async () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    fireEvent.change(getOriginalEditor(), { target: { value: 'Hello\nworld' } });
    fireEvent.change(getModifiedEditor(), { target: { value: 'hello\nWORLD' } });
    await waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('~2');
    });
    fireEvent.click(screen.getByTestId('diff-ignore-case'));
    await waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('无差异');
    });
  });

  it('handoff:接收文本写入当前文档的修改侧', () => {
    useToolStateStore.setState({ currentToolId: 'text_compare' });
    requestHandoff('text_compare', 'from other tool');
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    expect(useTextCompareStore.getState().docs[0]?.modified).toBe('from other tool');
    // 载荷已被消费,不再残留
    expect(useHandoffStore.getState().pending).toBeNull();
    useToolStateStore.setState({ currentToolId: 'text_editor' });
  });

  it('handoff:side=original 时写入修改前侧,修改后侧不受影响', () => {
    useToolStateStore.setState({ currentToolId: 'text_compare' });
    requestHandoff('text_compare', 'left text', 'original');
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    const doc = useTextCompareStore.getState().docs[0];
    expect(doc?.original).toBe('left text');
    expect(doc?.modified).toBe('');
    expect(useHandoffStore.getState().pending).toBeNull();
    useToolStateStore.setState({ currentToolId: 'text_editor' });
  });

  it('忽略换行符开关:仅 CRLF/LF 差异时统计归零', async () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    // 经 store 直写:textarea(浏览器规范)会把 \r\n 归一成 \n,无法在测试里
    // 模拟 CRLF 输入;真实场景来自打开文件/粘贴,值在 store 侧不归一
    useTextCompareStore.getState().setDocContent('default', 'original', 'a\r\nb\r\n');
    useTextCompareStore.getState().setDocContent('default', 'modified', 'a\nb\n');
    await waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('~2');
    });
    fireEvent.click(screen.getByTestId('diff-ignore-eol'));
    await waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('无差异');
    });
  });

  it('交换两侧:内容与来源文件名互换', () => {
    useTextCompareStore.setState({
      docs: [
        {
          id: 'swap-doc',
          title: 't',
          pinned: false,
          original: 'AAA',
          modified: 'BBB',
          originalFileName: 'left.rs',
          modifiedFileName: 'right.rs',
        },
      ],
      activeDocId: 'swap-doc',
      ready: true,
    });
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('diff-swap-sides'));
    const doc = useTextCompareStore.getState().docs[0]!;
    expect(doc.original).toBe('BBB');
    expect(doc.modified).toBe('AAA');
    expect(doc.originalFileName).toBe('right.rs');
    expect(doc.modifiedFileName).toBe('left.rs');
  });

  it('导出补丁:触发 .patch 文件下载,含统一格式头', async () => {
    useTextCompareStore.setState({
      docs: [
        {
          id: 'patch-doc',
          title: 'demo',
          pinned: false,
          original: 'a\nold\n',
          modified: 'a\nnew\n',
          originalFileName: 'left.txt',
          modifiedFileName: 'right.txt',
        },
      ],
      activeDocId: 'patch-doc',
      ready: true,
    });
    // downloadText 已在文件顶部 mock:内容正确性由 buildUnifiedPatch 单测
    // 覆盖,此处验证触发与文件名
    const { downloadText } = await import('@/lib/file-utils');
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('diff-export-patch'));
    expect(downloadText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadText).mock.calls[0]?.[0]).toBe('demo.patch');
  });

  it('导出补丁新鲜时按显示块生成(含 hunk 头与增删行)', async () => {
    useTextCompareStore.setState({
      docs: [
        {
          id: 'fresh-doc',
          title: 't',
          pinned: false,
          original: 'a\nold\nc\n',
          modified: 'a\nnew\nc\n',
        },
      ],
      activeDocId: 'fresh-doc',
      ready: true,
    });
    const { downloadText } = await import('@/lib/file-utils');
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    // 等差异计算就绪(快照新鲜),再导出才走按块生成路径
    await waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('~1');
    });
    fireEvent.click(screen.getByTestId('diff-export-patch'));
    expect(downloadText).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(downloadText).mock.calls[0]?.[1] as string;
    expect(patch).toContain('@@ -1,3 +1,3 @@');
    expect(patch).toContain('-old');
    expect(patch).toContain('+new');
  });

  it('文件装入后:标题显示文件名,语言按扩展名推断', async () => {
    useTextCompareStore.setState({
      docs: [
        {
          id: 'file-doc',
          title: 't',
          pinned: false,
          original: '',
          modified: '',
        },
      ],
      activeDocId: 'file-doc',
      ready: true,
    });
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    // 经 setDocSideFile 写入(等价于打开/拖放文件的落库路径);render 外的
    // store 变更需 act 刷 React 状态
    act(() => {
      useTextCompareStore
        .getState()
        .setDocSideFile('file-doc', 'original', 'fn main() {}', 'main.rs');
    });
    expect(await screen.findByText('main.rs')).toBeInTheDocument();
  });

  it('并排模式差异导航:按钮随差异出现,计数与跳转生效', async () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    // 无差异时导航按钮不出现
    expect(screen.queryByTestId('diff-nav')).not.toBeInTheDocument();
    fireEvent.change(getOriginalEditor(), { target: { value: 'a\nX\nc' } });
    fireEvent.change(getModifiedEditor(), { target: { value: 'a\nY\nc' } });
    await waitFor(() => {
      expect(screen.getByTestId('diff-nav')).toBeInTheDocument();
      expect(screen.getByTestId('diff-nav-count')).toHaveTextContent('1/1');
    });
    // 下一处(循环回绕)仍停留在唯一差异
    fireEvent.click(screen.getByTestId('diff-nav-next'));
    expect(screen.getByTestId('diff-nav-count')).toHaveTextContent('1/1');
  });

  it('并排模式差异导航按块计数:多行单块只占一站', async () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    fireEvent.change(getOriginalEditor(), { target: { value: 'a\nX1\nX2\nb' } });
    fireEvent.change(getModifiedEditor(), { target: { value: 'a\nY1\nY2\nc' } });
    await waitFor(() => {
      expect(screen.getByTestId('diff-nav')).toBeInTheDocument();
      // 两行修改同属一块(旧按行计数会显示 1/2)
      expect(screen.getByTestId('diff-nav-count')).toHaveTextContent('1/1');
    });
  });

  it('只看差异开关:渲染并可切换按下态', async () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    const toggle = screen.getByTestId('diff-hide-unchanged');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('相似度随差异内容出现在统计徽标中', async () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    fireEvent.change(getOriginalEditor(), { target: { value: 'aaaa\nbbbb' } });
    fireEvent.change(getModifiedEditor(), { target: { value: 'aaaa\ncccc' } });
    await waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('相似');
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('%');
    });
  });

  it('不渲染全屏弹窗(已按需求移除)', () => {
    render(<TextCompare toolId="text_compare" metadata={null as never} />);
    expect(screen.queryByTestId('diff-fullscreen')).not.toBeInTheDocument();
  });

  it('复制差异块到对侧:原始侧修改块写回修改侧(受控路径,块拷贝语义)', () => {
    // 与 GutterCopyOverlay → handleCopyBlock 的集成链路等价:
    // 块由 computeLineDiff 产出,写回走 setDocContent(与手输同路径)
    useTextCompareStore.setState({
      docs: [
        {
          id: 'copy-doc',
          title: 't',
          pinned: false,
          original: 'a\nold\nc\n',
          modified: 'a\nnew\nc\n',
        },
      ],
      activeDocId: 'copy-doc',
      ready: true,
    });
    render(<TextCompare toolId="text_compare" metadata={null as never} />);

    // 模拟 overlay 回调:块取自真实差异计算,side='original'
    const r = computeLineDiff('a\nold\nc\n', 'a\nnew\nc\n');
    const block = r.blocks[0]!;
    const nextModified = applyDiffBlockCopy('a\nold\nc\n', 'a\nnew\nc\n', block, 'original');
    useTextCompareStore.getState().setDocContent('copy-doc', 'modified', nextModified);

    const doc = useTextCompareStore.getState().docs[0]!;
    expect(doc.modified).toBe('a\nold\nc\n');
    expect(doc.original).toBe('a\nold\nc\n');
    // 拷贝后两侧一致:界面统计应归零(受控重算)
    return waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('无差异');
    });
  });

  it('复制差异块到对侧:纯删除块从原始侧拷回,修改侧补齐缺失行', () => {
    useTextCompareStore.setState({
      docs: [
        {
          id: 'copy-doc2',
          title: 't',
          pinned: false,
          original: 'a\nb\nc\n',
          modified: 'a\nb\n',
        },
      ],
      activeDocId: 'copy-doc2',
      ready: true,
    });
    render(<TextCompare toolId="text_compare" metadata={null as never} />);

    const r = computeLineDiff('a\nb\nc\n', 'a\nb\n');
    const block = r.blocks[0]!;
    expect(block.modStart).toBeNull();
    const nextModified = applyDiffBlockCopy('a\nb\nc\n', 'a\nb\n', block, 'original');
    useTextCompareStore.getState().setDocContent('copy-doc2', 'modified', nextModified);

    expect(useTextCompareStore.getState().docs[0]!.modified).toBe('a\nb\nc\n');
    return waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('无差异');
    });
  });

  it('反向拷贝:修改侧块写回原始侧', () => {
    useTextCompareStore.setState({
      docs: [
        {
          id: 'copy-doc3',
          title: 't',
          pinned: false,
          original: 'a\nold\nc\n',
          modified: 'a\nnew\nc\n',
        },
      ],
      activeDocId: 'copy-doc3',
      ready: true,
    });
    render(<TextCompare toolId="text_compare" metadata={null as never} />);

    const r = computeLineDiff('a\nold\nc\n', 'a\nnew\nc\n');
    const block = r.blocks[0]!;
    // side='modified':从修改侧取内容写原始侧
    const nextOriginal = applyDiffBlockCopy('a\nnew\nc\n', 'a\nold\nc\n', block, 'modified');
    useTextCompareStore.getState().setDocContent('copy-doc3', 'original', nextOriginal);

    expect(useTextCompareStore.getState().docs[0]!.original).toBe('a\nnew\nc\n');
    return waitFor(() => {
      expect(screen.getByTestId('diff-stats')).toHaveTextContent('无差异');
    });
  });
});
