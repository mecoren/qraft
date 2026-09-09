/**
 * SearchDialog 交互测试 —— 打开/过滤/选择跳转/关闭。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { SearchDialog } from './SearchDialog';
import { useSearchStore } from '@/store/searchStore';
import { useUiStore } from '@/store/uiStore';
import { useEditorWorkspaceStore } from '@/tools/code-editor-workspace/useEditorWorkspaceStore';
import { MATCH_BATCH_SIZE } from '@/lib/editor-text-search';
import type { EditorTab } from '@/tools/code-editor-workspace/schema';

/** 构造最小合法 Tab */
function makeTab(id: string, title: string, content: string): EditorTab {
  return {
    id,
    title,
    path: null,
    language: 'plaintext',
    content,
    savedContent: content,
    pinned: false,
  };
}

function setTabs(tabs: EditorTab[]) {
  useEditorWorkspaceStore.setState({
    workspace: {
      tabs,
      activeTabId: tabs[0]?.id ?? null,
      leftSidebarVisible: true,
      sidebarWidth: 288,
      folders: [],
      expandedDirs: [],
    },
    ready: true,
    userTouched: true,
    error: null,
  });
}

beforeEach(() => {
  useSearchStore.setState({ target: null });
  // uiStore 经 localStorage 持久化,全量运行时可能拿到其他用例写入的
  // recents / detectedTools(工具排序与 Smart Detection 分区随之变化,
  // 影响 cmdk 首项与初始选中),这里复位到确定状态
  useUiStore.setState({ recents: [], detectedTools: [], favorites: [] });
  setTabs([]);
});

/** 打开后默认进入文本模式;功能模式用例需先切到「功能」 */
async function switchToFeature(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: '功能' }));
}

describe('SearchDialog', () => {
  it('打开时展示搜索输入框与分组结果', async () => {
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await switchToFeature(user);
    expect(screen.getByPlaceholderText(/搜索/)).toBeInTheDocument();
    // 分组标题(工具区块较独特,避免与其他文本冲突)
    expect(screen.getByText('工具区块')).toBeInTheDocument();
    // 全量索引中的代表工具(工具条目 + 区块分组标签均可能出现)
    expect(screen.getAllByText('JSON 格式化器').length).toBeGreaterThan(0);
  });

  it('输入关键字过滤结果', async () => {
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await switchToFeature(user);
    await user.type(screen.getByPlaceholderText(/搜索/), 'base64');
    // 防抖 80ms 后无关结果消失
    await waitFor(() => {
      expect(screen.queryByText('JSON 格式化器')).not.toBeInTheDocument();
    });
    expect(screen.getAllByText('Base64 转换器').length).toBeGreaterThan(0);
  });

  it('无匹配时展示空态提示', async () => {
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await switchToFeature(user);
    await user.type(screen.getByPlaceholderText(/搜索/), '不存在的关键字zzzz');
    // 防抖 80ms + 全量测试并发下可能较慢,放宽等待超时避免 flaky
    expect(
      await screen.findByText(/未找到匹配/, undefined, { timeout: 10000 }),
    ).toBeInTheDocument();
  }, 20000);

  it('点击工具结果触发 requestJump 并关闭', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SearchDialog open onOpenChange={onOpenChange} />);
    await switchToFeature(user);
    await user.type(screen.getByPlaceholderText(/搜索/), 'base64');
    await user.click((await screen.findAllByText('Base64 转换器'))[0]);
    expect(useSearchStore.getState().target).toEqual({ view: 'tool', toolId: 'base64_codec' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('选择设置分区结果携带 settingsMenu', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SearchDialog open onOpenChange={onOpenChange} />);
    await switchToFeature(user);
    await user.type(screen.getByPlaceholderText(/搜索/), '快捷键');
    await waitFor(() => {
      expect(screen.getAllByText('快捷键').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('快捷键')[0]);
    expect(useSearchStore.getState().target).toEqual({
      view: 'settings',
      settingsMenu: 'shortcuts',
      anchor: 'settings:shortcuts',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('键盘 Enter 触发当前高亮结果', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SearchDialog open onOpenChange={onOpenChange} />);
    await switchToFeature(user);
    const input = screen.getByPlaceholderText(/搜索/);
    await user.type(input, 'json');
    // 等待防抖完成、列表过滤稳定:全量列表中的无关结果消失后 items 不再重排,
    // 避免 ArrowDown 选中后因防抖重渲染清空 cmdk 选中态
    await waitFor(() => {
      expect(screen.queryByText('Base64 转换器')).not.toBeInTheDocument();
    });
    await user.keyboard('{ArrowDown}');
    // cmdk 的选中态由 React 异步渲染,等待选中项出现后再 Enter
    await waitFor(() => {
      expect(document.querySelector('[aria-selected="true"]')).not.toBeNull();
    });
    await user.keyboard('{Enter}');
    // cmdk 选中项触发 onSelect → requestJump
    expect(useSearchStore.getState().target).not.toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('打开/输入时不自动高亮第一项,按下 ↓ 才高亮第一项', async () => {
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await switchToFeature(user);
    const input = screen.getByPlaceholderText(/搜索/);
    // 打开即有全量结果,但不应有任何项被高亮(焦点留在搜索框)
    expect(document.querySelector('[aria-selected="true"]')).toBeNull();
    await user.type(input, 'json');
    await waitFor(() => {
      expect(screen.queryByText('Base64 转换器')).not.toBeInTheDocument();
    });
    // 过滤结果稳定后仍不应自动高亮第一项。waitFor 而非同步断言:清高亮
    // 由 QuickPickDialog 的 useEffect(commit 后)驱动,全量并发下 effect
    // 调度与断言间存在时序窗口,同步断言会抢在清理前误判(单测稳定,全量
    // 并发偶发——最终态语义不变:始终无高亮)
    await waitFor(() => {
      expect(document.querySelector('[aria-selected="true"]')).toBeNull();
    });
    // 焦点始终在搜索框
    expect(document.activeElement).toBe(input);
    // 按下 ↓ 后第一项才被高亮
    await user.keyboard('{ArrowDown}');
    const selected = await waitFor(() => {
      const el = document.querySelector('[aria-selected="true"]');
      expect(el).not.toBeNull();
      return el as Element;
    });
    // 第一个 option 才是第一项
    const options = document.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(1);
    expect(selected).toBe(options[0]);
    // 焦点回到搜索框(cmdk 键盘导航不动焦点)
    expect(document.activeElement).toBe(input);
  });

  it('关闭状态不渲染面板', () => {
    render(<SearchDialog open={false} onOpenChange={() => {}} />);
    expect(screen.queryByPlaceholderText(/搜索/)).not.toBeInTheDocument();
  });
});

describe('SearchDialog 文本模式', () => {
  it('默认进入文本模式,切换「功能」后 placeholder 变化', async () => {
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    expect(screen.getByPlaceholderText(/搜索编辑器文本/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '功能' }));
    expect(screen.getByPlaceholderText(/搜索所有功能/)).toBeInTheDocument();
  });

  it('无已打开文件时展示引导文案', () => {
    render(<SearchDialog open onOpenChange={() => {}} />);
    expect(screen.getByText(/请先在文本编辑器中打开文件/)).toBeInTheDocument();
  });

  it('文本模式展示按文件分组的匹配行,匹配片段高亮', async () => {
    setTabs([
      makeTab('tab-a', 'notes.txt', 'hello world\nfind me'),
      makeTab('tab-b', 'code.ts', 'x'),
    ]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    const input = screen.getByPlaceholderText(/搜索编辑器文本/);
    await user.type(input, 'find');
    // 文件名分组出现(分组 heading)
    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    // 匹配行作为 option 出现(行内文本被高亮片段拆分,用 accessible name 聚合匹配)
    expect(screen.getByRole('option', { name: /find me/ })).toBeInTheDocument();
    // 匹配片段使用 mark 高亮
    expect(screen.getAllByText('find', { selector: 'mark' }).length).toBeGreaterThan(0);
    // 无匹配的 tab 不出现在结果
    expect(screen.queryByText('code.ts')).not.toBeInTheDocument();
  });

  it('点击文本结果触发 requestJump(tabId+textQuery) 并关闭', async () => {
    setTabs([makeTab('tab-a', 'notes.txt', 'find me')]);
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SearchDialog open onOpenChange={onOpenChange} />);
    await user.type(screen.getByPlaceholderText(/搜索编辑器文本/), 'find');
    await user.click(await screen.findByRole('option', { name: /find me/ }));
    expect(useSearchStore.getState().target).toMatchObject({
      view: 'tool',
      toolId: 'text_editor',
      tabId: 'tab-a',
      textQuery: 'find',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('海量命中时截断展示并提示(徽标显示 前 X / Y 行)', async () => {
    const lines = Array.from({ length: MATCH_BATCH_SIZE + 10 }, (_, i) => `find line ${i}`);
    setTabs([makeTab('big', 'big.txt', lines.join('\n'))]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await user.type(screen.getByPlaceholderText(/搜索编辑器文本/), 'find');
    // 分组徽标展示「前 上限 / 总数 行」
    expect(
      await screen.findByText(`前 ${MATCH_BATCH_SIZE} / ${lines.length} 行`),
    ).toBeInTheDocument();
    // 底部截断提示
    expect(screen.getByText(/命中结果过多,仅显示部分匹配行/)).toBeInTheDocument();
    // 渲染的 option 数不超过收集上限
    expect(screen.getAllByRole('option').length).toBe(MATCH_BATCH_SIZE);
  }, 20000);

  it('点击底部提示加载下一批匹配行', async () => {
    const lines = Array.from({ length: MATCH_BATCH_SIZE + 10 }, (_, i) => `find line ${i}`);
    setTabs([makeTab('big', 'big.txt', lines.join('\n'))]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await user.type(screen.getByPlaceholderText(/搜索编辑器文本/), 'find');
    expect(await screen.findByRole('option', { name: /find line 49/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /点击加载后续 50 行/ }));

    expect(await screen.findByRole('option', { name: /find line 59/ })).toBeInTheDocument();
    expect(screen.getByText(`已加载 ${lines.length} / ${lines.length} 条结果`)).toBeInTheDocument();
    expect(screen.getByText(`${lines.length} 行`)).toBeInTheDocument();
    expect(screen.queryByText(/命中结果过多/)).not.toBeInTheDocument();
  }, 20000);

  it('多次点击继续追加后续匹配行', async () => {
    const lines = Array.from({ length: MATCH_BATCH_SIZE * 2 + 5 }, (_, i) => `find line ${i}`);
    setTabs([makeTab('big', 'big.txt', lines.join('\n'))]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await user.type(screen.getByPlaceholderText(/搜索编辑器文本/), 'find');

    await user.click(await screen.findByRole('button', { name: /点击加载后续 50 行/ }));
    expect(await screen.findByRole('option', { name: /find line 99/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /命中结果过多/ }));
    expect(await screen.findByRole('option', { name: /find line 104/ })).toBeInTheDocument();
  }, 20000);

  it('超过旧全局上限后仍可通过点击无限继续加载', async () => {
    const lines = Array.from({ length: 350 }, (_, i) => `find line ${i}`);
    setTabs([makeTab('huge', 'huge.txt', lines.join('\n'))]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await user.type(screen.getByPlaceholderText(/搜索编辑器文本/), 'find');

    for (let i = 0; i < 3; i++) {
      await user.click(await screen.findByRole('button', { name: /点击加载后续 50 行/ }));
    }

    expect(await screen.findByRole('option', { name: /find line 199/ })).toBeInTheDocument();
    expect(screen.getByText('已加载 200 / 350 条结果')).toBeInTheDocument();
  }, 30000);
});

describe('SearchDialog 文本模式匹配选项(Aa/整词/正则)', () => {
  /** 打开面板并输入查询,等待防抖出结果 */
  async function typeQuery(user: UserEvent, q: string) {
    await user.type(screen.getByPlaceholderText(/搜索编辑器文本/), q);
  }

  it('默认关闭三枚切换钮,点击后进入激活态(aria-pressed)', async () => {
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    const caseBtn = screen.getByRole('button', { name: '区分大小写' });
    const wordBtn = screen.getByRole('button', { name: '整词匹配' });
    const regexBtn = screen.getByRole('button', { name: '正则表达式' });
    expect(caseBtn).toHaveAttribute('aria-pressed', 'false');
    expect(wordBtn).toHaveAttribute('aria-pressed', 'false');
    expect(regexBtn).toHaveAttribute('aria-pressed', 'false');

    await user.click(caseBtn);
    await user.click(wordBtn);
    await user.click(regexBtn);
    expect(caseBtn).toHaveAttribute('aria-pressed', 'true');
    expect(wordBtn).toHaveAttribute('aria-pressed', 'true');
    expect(regexBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('caseSensitive:开启后仅同大小写命中,再点一次恢复默认', async () => {
    setTabs([makeTab('tab-a', 'notes.txt', 'Hello world\nhello again')]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await typeQuery(user, 'hello');
    // 默认大小写不敏感:两行均命中
    expect(await screen.findByRole('option', { name: /hello again/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Hello world/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '区分大小写' }));
    // 开启后仅小写行命中;Hello world 行消失
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Hello world/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: /hello again/ })).toBeInTheDocument();

    // 再次点击恢复默认(两行回来)
    await user.click(screen.getByRole('button', { name: '区分大小写' }));
    expect(await screen.findByRole('option', { name: /Hello world/ })).toBeInTheDocument();
  });

  it('wholeWord:子串命中被排除,词边界命中保留', async () => {
    setTabs([makeTab('tab-a', 'notes.txt', 'foo bar\nfoobar\nfoo.')]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await typeQuery(user, 'foo');
    // 默认三行全命中
    expect((await screen.findAllByRole('option')).length).toBe(3);

    await user.click(screen.getByRole('button', { name: '整词匹配' }));
    // foobar 行被排除,foo bar 与 foo. 保留
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /foobar/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: /foo bar/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /foo\./ })).toBeInTheDocument();
  });

  it('regex:按正则匹配且行内 <mark> 区间为实际命中长度', async () => {
    setTabs([makeTab('tab-a', 'notes.txt', 'v1.2.3\nno match')]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await typeQuery(user, 'v\\d+');
    // 默认子串模式:查询含反斜杠无命中
    expect(await waitFor(() => screen.queryByRole('option'))).toBeNull();

    await user.click(screen.getByRole('button', { name: '正则表达式' }));
    // 正则模式:v1 命中,mark 内容为实际命中片段
    const opt = await screen.findByRole('option', { name: /v1\.2\.3/ });
    expect(opt).toBeInTheDocument();
    const mark = opt.querySelector('mark');
    expect(mark?.textContent).toBe('v1');
  });

  it('切换到功能模式再切回文本模式,匹配选项复位', async () => {
    setTabs([makeTab('tab-a', 'notes.txt', 'Hello world\nhello again')]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: '区分大小写' }));
    expect(screen.getByRole('button', { name: '区分大小写' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: '功能' }));
    // 功能模式不显示切换钮
    expect(screen.queryByRole('button', { name: '区分大小写' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '文本' }));
    // 切回文本模式:选项已复位为关
    expect(screen.getByRole('button', { name: '区分大小写' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('点击结果时 requestJump 携带匹配选项(编辑器高亮同口径)', async () => {
    setTabs([makeTab('tab-a', 'notes.txt', 'hello world\nHello there')]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await typeQuery(user, 'hello');
    // 默认不区分大小写:两行均命中
    expect(await screen.findByRole('option', { name: /hello world/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '区分大小写' }));
    // 大小写敏感:仅小写 hello world 行保留,Hello there 行消失
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Hello there/ })).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('option', { name: /hello world/ }));
    expect(useSearchStore.getState().target).toEqual({
      view: 'tool',
      toolId: 'text_editor',
      tabId: 'tab-a',
      textQuery: 'hello',
      textSearchOptions: { caseSensitive: true },
    });
  });
});

describe('SearchDialog 正则模式非法输入提示', () => {
  it('非法正则显示专门提示,与「未找到匹配」区分', async () => {
    setTabs([makeTab('tab-a', 'notes.txt', 'hello')]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    // [ 需以键盘描述符转义输入,避免 userEvent 把它当作修饰符标签解析
    await user.type(screen.getByPlaceholderText(/搜索编辑器文本/), 'x{[}unclosed');
    // 子串模式下「[unclosed」就是普通文本,无命中 → 未找到提示
    expect(
      await screen.findByText(/未找到匹配/, undefined, { timeout: 10000 }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '正则表达式' }));
    // 正则模式下同一查询为非法正则 → 专门提示
    expect(await screen.findByText(/正则表达式无效/)).toBeInTheDocument();
    expect(screen.queryByText(/未找到匹配/)).not.toBeInTheDocument();
  }, 20000);

  it('正则钮在查询非法时描红,修好后恢复', async () => {
    setTabs([makeTab('tab-a', 'notes.txt', 'v1.2.3')]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    const regexBtn = screen.getByRole('button', { name: '正则表达式' });
    await user.click(regexBtn);
    await user.type(screen.getByPlaceholderText(/搜索编辑器文本/), '(');
    // 防抖后正则钮描红(text-destructive)
    await waitFor(() => {
      expect(regexBtn.className).toContain('text-destructive');
    });
    // 补全右括号 → 合法,描红消失且出现命中
    await user.type(screen.getByPlaceholderText(/搜索编辑器文本/), ')');
    await waitFor(() => {
      expect(regexBtn.className).not.toContain('text-destructive');
    });
  }, 20000);
});
