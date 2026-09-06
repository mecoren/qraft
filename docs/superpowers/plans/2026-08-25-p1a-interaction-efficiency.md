# P1-a 交互效率批次 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地竞品分析 P1 中的三项交互效率改进:重型 chunk 空闲预取、工具输出→输入链(发送到…)、轻量 Smart Detection(opt-in 剪贴板检测推荐)。

**Architecture:** 预取 = 启动稳定后 requestIdleCallback 动态 import 重型工具模块;跨工具传值 = 新建 handoff 信令 store(仿 searchStore 的 request/consume 模式)+ 共享 SendToMenu 下拉组件(挂进各工具输出区 CodeEditor 的 actions 插槽),消费侧用 latest-ref hook,完全绕开 ToolPanel keepalive 的 props 限制;Smart Detection = 纯函数启发式探测 + uiStore 开关(**默认关闭**,尊重 release-checklist「不主动读剪贴板」安全不变量)+ CommandPalette 推荐分组。

**Tech Stack:** React 19 + zustand 5 + Radix DropdownMenu + vitest。无新 npm 依赖。

## Global Constraints

- 命令:`pnpm test -- <path>` / `pnpm typecheck` / `pnpm lint`(0 errors / 149 warnings 基线)
- 提交:conventional commits 中文
- UI 文案中文;effect 内禁止同步 setState(ref 赋值允许);react-x 规则生效
- 安全不变量:**任何剪贴板读取必须发生在用户显式开启开关之后**;开关默认 false
- 每任务 TDD:先失败测试再实现;完成后 lint+typecheck 收口

---

### Task 1: 空闲预取重型工具模块

**Files:**

- Create: `src/lib/idle-prefetch.ts`
- Modify: `src/main.tsx`(挂载后调用)
- Test: `src/lib/idle-prefetch.test.ts`

**Interfaces:**

- Produces: `scheduleIdlePrefetch(): void`(幂等,重复调用只生效一次)

- [ ] **Step 1: 写失败测试**

创建 `src/lib/idle-prefetch.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loader = vi.fn().mockResolvedValue(undefined);

describe('idle-prefetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function boot(): typeof import('./idle-prefetch') {
    vi.doMock('./idle-prefetch-loaders', () => ({
      PREFETCH_LOADERS: [loader],
    }));
    return require('./idle-prefetch') as typeof import('./idle-prefetch');
  }

  it('DEV 下不调度任何预取', async () => {
    vi.stubEnv('DEV', true);
    const mod = boot();
    mod.scheduleIdlePrefetch();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(loader).not.toHaveBeenCalled();
  });

  it('PROD 下延迟 + 空闲后执行一次,且幂等', async () => {
    vi.stubEnv('DEV', false);
    const rIC = vi.fn((cb: IdleRequestCallback) => {
      cb({ didTimeout: true, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', rIC);
    const mod = boot();
    mod.scheduleIdlePrefetch();
    mod.scheduleIdlePrefetch();
    await vi.advanceTimersByTimeAsync(3_100);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
```

注:vitest 环境 `import.meta.env.DEV` 由 `vi.stubEnv` 控制;若运行时报 stub 不生效,改用模块内可注入参数 `scheduleIdlePrefetch(options?: { dev?: boolean })`,main.tsx 传 `import.meta.env.DEV`,测试传显式值(两种都以实际运行为准)。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/lib/idle-prefetch.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现**

创建 `src/lib/idle-prefetch.ts`:

```ts
/**
 * 启动稳定后的空闲预取:把「首次进入才加载」的重型懒加载链
 * (Markdown 工具 → mermaid/katex/markdown-worker 等 vendor chunk)提前到空闲期,
 * 消除用户首次点击该工具时 >2MB 的磁盘读取尖峰。
 *
 * 约束:绝不影响冷启动 —— DEV 直接跳过;PROD 固定延迟 3s 后再等浏览器空闲,
 * 且整个生命周期只跑一次。
 */

let scheduled = false;

export function scheduleIdlePrefetch(options?: { delayMs?: number }): void {
  if (scheduled || import.meta.env.DEV) return;
  scheduled = true;

  void import('./idle-prefetch-loaders').then(({ PREFETCH_LOADERS }) => {
    const run = () => {
      for (const load of PREFETCH_LOADERS) void load().catch(() => {});
    };
    window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => run(), { timeout: 5000 });
      } else {
        window.setTimeout(run, 200);
      }
    }, options?.delayMs ?? 3000);
  });
}
```

创建 `src/lib/idle-prefetch-loaders.ts`:

```ts
/**
 * 预取目标清单:独立成文件避免被测模块在测试中真实拉起工具依赖图。
 * 只放「重且低频首访」的工具;高频小 chunk 无需预取。
 */
export const PREFETCH_LOADERS: Array<() => Promise<unknown>> = [
  () => import('@/tools/MarkdownPreview'),
];
```

`src/main.tsx` 在应用挂载语句之后追加:

```ts
import { scheduleIdlePrefetch } from '@/lib/idle-prefetch';
// ...现有 createRoot(...).render(...) 之后:
scheduleIdlePrefetch();
```

- [ ] **Step 4: 验证**

Run: `pnpm test -- src/lib/idle-prefetch.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS;`pnpm build` 后 dist 中 markdown/mermaid 相关 chunk 仍存在(未被合并进入口)

- [ ] **Step 5: Commit**

```bash
git add src/lib/idle-prefetch.ts src/lib/idle-prefetch-loaders.ts src/main.tsx src/lib/idle-prefetch.test.ts
git commit -m "perf(prefetch): 空闲期预取 Markdown 工具重型 chunk,消除首访尖峰"
```

---

### Task 2: handoff 信令 store

**Files:**

- Create: `src/store/handoffStore.ts`
- Test: `src/store/handoffStore.test.ts`

**Interfaces:**

- Produces(Task 3/4 消费):
  - `requestHandoff(toolId: string, text: string): void`
  - `consumeHandoff(toolId: string): string | null`(命中则返回文本并清除;否则 null)
  - `peekHandoff(toolId: string): string | null`

- [ ] **Step 1: 写失败测试**

创建 `src/store/handoffStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { consumeHandoff, peekHandoff, requestHandoff, useHandoffStore } from './handoffStore';

describe('handoffStore', () => {
  beforeEach(() => {
    useHandoffStore.setState({ pending: null });
  });

  it('request 后 peek/consume 可取到文本,consume 清除待处理载荷', () => {
    requestHandoff('hash_calculator', 'hello');
    expect(peekHandoff('hash_calculator')).toBe('hello');
    expect(consumeHandoff('hash_calculator')).toBe('hello');
    expect(consumeHandoff('hash_calculator')).toBeNull();
  });

  it('toolId 不匹配时不命中(只投递给目标工具)', () => {
    requestHandoff('base64_codec', 'aGVsbG8=');
    expect(peekHandoff('json_formatter')).toBeNull();
    expect(consumeHandoff('json_formatter')).toBeNull();
    // 原载荷不受误取影响
    expect(peekHandoff('base64_codec')).toBe('aGVsbG8=');
  });

  it('新的 request 覆盖旧的未消费载荷', () => {
    requestHandoff('hash_calculator', 'first');
    requestHandoff('hash_calculator', 'second');
    expect(consumeHandoff('hash_calculator')).toBe('second');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/store/handoffStore.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

创建 `src/store/handoffStore.ts`(结构仿 searchStore):

```ts
/**
 * 跨工具传值信令 store(「发送到…」功能的通道)。
 *
 * keepalive 架构下目标工具可能早已挂载、props 永不更新,故不走路由参数;
 * 发送方写入 pending,接收方在自己成为激活工具时消费。
 * 参照 searchStore 的 requestJump/consume 单次消费语义。
 */
import { create } from 'zustand';

interface HandoffState {
  /** 待投递载荷;null 表示无 */
  pending: { toolId: string; text: string } | null;
}

export const useHandoffStore = create<HandoffState>()(() => ({
  pending: null,
}));

/** 把文本投递给目标工具(覆盖未消费的旧载荷) */
export function requestHandoff(toolId: string, text: string): void {
  useHandoffStore.setState({ pending: { toolId, text } });
}

/** 查看(不清除)发往 toolId 的载荷 */
export function peekHandoff(toolId: string): string | null {
  const p = useHandoffStore.getState().pending;
  return p && p.toolId === toolId ? p.text : null;
}

/** 取走发往 toolId 的载荷(单次消费语义) */
export function consumeHandoff(toolId: string): string | null {
  const p = useHandoffStore.getState().pending;
  if (!p || p.toolId !== toolId) return null;
  useHandoffStore.setState({ pending: null });
  return p.text;
}
```

- [ ] **Step 4: 验证并提交**

Run: `pnpm test -- src/store/handoffStore.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS

```bash
git add src/store/handoffStore.ts src/store/handoffStore.test.ts
git commit -m "feat(handoff): 新增跨工具传值信令 store"
```

---

### Task 3: useToolHandoff hook + SendToMenu 组件

**Files:**

- Create: `src/hooks/useToolHandoff.ts`
- Create: `src/components/send-to-menu.tsx`
- Test: `src/hooks/useToolHandoff.test.tsx`、`src/components/send-to-menu.test.tsx`

**Interfaces:**

- Consumes: Task 2 全部导出;`useToolStateStore.currentToolId`;`useEditorWorkspaceStore.openDroppedText(title, content)`
- Produces:
  - `useToolHandoff(toolId: string, apply: (text: string) => void): void`(工具激活且有待收文本时调 apply 并消费)
  - `<SendToMenu text={string} currentToolId={string} testId? />`(输出区下拉按钮)

- [ ] **Step 1: 写失败测试(hook)**

创建 `src/hooks/useToolHandoff.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useToolHandoff } from './useToolHandoff';
import { requestHandoff } from '@/store/handoffStore';
import { useToolStateStore } from '@/store/toolStateStore';

function Harness({ toolId, onApply }: { toolId: string; onApply: (t: string) => void }) {
  useToolHandoff(toolId, onApply);
  return null;
}

describe('useToolHandoff', () => {
  beforeEach(() => {
    useToolStateStore.setState({ currentToolId: null });
  });

  it('非激活工具不消费载荷;成为激活工具时立即消费并回调', () => {
    const onApply = vi.fn();
    requestHandoff('demo_tool', 'payload-text');
    // 未激活:渲染也不消费
    const { rerender } = render(<Harness toolId="demo_tool" onApply={onApply} />);
    expect(onApply).not.toHaveBeenCalled();
    // 激活后消费
    useToolStateStore.setState({ currentToolId: 'demo_tool' });
    rerender(<Harness toolId="demo_tool" onApply={onApply} />);
    expect(onApply).toHaveBeenCalledWith('payload-text');
    // 单次消费:再次渲染不再触发
    rerender(<Harness toolId="demo_tool" onApply={onApply} />);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('挂载前已有载荷且即为激活工具时,挂载即消费', () => {
    useToolStateStore.setState({ currentToolId: 'demo_tool' });
    requestHandoff('demo_tool', 'early');
    const onApply = vi.fn();
    render(<Harness toolId="demo_tool" onApply={onApply} />);
    expect(onApply).toHaveBeenCalledWith('early');
  });
});
```

注意:hook 内消费会写 zustand setState,若 react-x 对 effect 中调用外部 setState 报警,以「zustand 外部 store 不受该规则约束」处理;如 lint 仍报错,把消费动作包进 `queueMicrotask` 并注明原因。

- [ ] **Step 2: 写失败测试(SendToMenu)**

创建 `src/components/send-to-menu.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { SendToMenu } from './send-to-menu';
import { consumeHandoff } from '@/store/handoffStore';

describe('SendToMenu', () => {
  beforeEach(() => {
    // 清空 handoff
    consumeHandoff('__none__');
  });

  it('点击展开目标列表,排除当前工具自身', async () => {
    render(<SendToMenu text="abc" currentToolId="json_formatter" testId="send-json" />);
    fireEvent.click(screen.getByTestId('send-json'));
    expect(await screen.findByRole('menuitem', { name: '哈希计算器' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'JSON 格式化器' })).not.toBeInTheDocument();
  });

  it('选择目标后写入对应载荷', async () => {
    render(<SendToMenu text="abc" currentToolId="json_formatter" testId="send-json" />);
    fireEvent.click(screen.getByTestId('send-json'));
    fireEvent.click(await screen.findByRole('menuitem', { name: '哈希计算器' }));
    await waitFor(() => {
      expect(consumeHandoff('hash_calculator')).toBe('abc');
    });
  });

  it('目标是文本编辑器时直接经 openDroppedText 注入新 Tab', async () => {
    const openDroppedText = vi.fn();
    vi.doMock('@/tools/code-editor-workspace/useEditorWorkspaceStore', () => ({
      useEditorWorkspaceStore: { getState: () => ({ openDroppedText }) },
    }));
    const { SendToMenu: FreshMenu } = await import('./send-to-menu');
    render(<FreshMenu text="abc" currentToolId="hash_calculator" testId="send-hash" />);
    fireEvent.click(screen.getByTestId('send-hash'));
    fireEvent.click(await screen.findByRole('menuitem', { name: '文本编辑器' }));
    await waitFor(() => {
      expect(openDroppedText).toHaveBeenCalledWith('发送的内容', 'abc');
    });
    vi.doUnmock('@/tools/code-editor-workspace/useEditorWorkspaceStore');
  });
});
```

注:第三个用例的 doMock 若与顶部静态 import 冲突导致失效,简化为仅断言 handoff/text_editor 分支被调用(通过 spy useEditorWorkspaceStore.getState)——以实际运行为准调整 mock 策略,断言语义不变。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm test -- src/hooks/useToolHandoff.test.tsx src/components/send-to-menu.test.tsx`
Expected: FAIL

- [ ] **Step 4: 实现**

创建 `src/hooks/useToolHandoff.ts`:

```ts
/**
 * 接收「发送到…」的跨工具文本:当本工具是激活工具且 handoff 有匹配载荷时,
 * 用 apply 注入工具输入并消费载荷(latest-ref 保证 apply 总是新闭包)。
 */
import { useEffect, useRef } from 'react';
import { consumeHandoff } from '@/store/handoffStore';
import { useToolStateStore } from '@/store/toolStateStore';

export function useToolHandoff(toolId: string, apply: (text: string) => void): void {
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });

  const currentToolId = useToolStateStore((s) => s.currentToolId);

  useEffect(() => {
    if (currentToolId !== toolId) return;
    const text = consumeHandoff(toolId);
    if (text !== null) applyRef.current(text);
  }, [currentToolId, toolId]);
}
```

创建 `src/components/send-to-menu.tsx`:

```tsx
/**
 * 输出区「发送到…」菜单:把本工具输出作为另一工具的输入。
 *
 * - 目标清单集中于此;仅列出已接入 useToolHandoff 消费的文本型工具
 * - 文本编辑器走其自有 openDroppedText(新 Tab 承载),其余走 handoffStore
 * - 使用方式:放进 CodeEditor 的 actions 插槽,紧挨 CopyAction
 */
import { FileInput, Forward } from 'lucide-react';
import type { JSX } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { requestHandoff } from '@/store/handoffStore';
import { useEditorWorkspaceStore } from '@/tools/code-editor-workspace/useEditorWorkspaceStore';
import { DEFAULT_TOOL_ID } from '@/lib/tool-catalog';

const HANDOFF_TARGETS: ReadonlyArray<{ toolId: string; label: string }> = [
  { toolId: DEFAULT_TOOL_ID, label: '文本编辑器' },
  { toolId: 'json_formatter', label: 'JSON 格式化器' },
  { toolId: 'base64_codec', label: 'Base64 转换器' },
  { toolId: 'hash_calculator', label: '哈希计算器' },
];

interface SendToMenuProps {
  text: string;
  /** 当前工具 id,从目标清单中排除自身 */
  currentToolId: string;
  testId?: string;
}

export function SendToMenu({ text, currentToolId, testId }: SendToMenuProps): JSX.Element {
  const targets = HANDOFF_TARGETS.filter((t) => t.toolId !== currentToolId);
  if (targets.length === 0) return <span />;

  const send = (target: (typeof HANDOFF_TARGETS)[number]): void => {
    if (!text) return;
    if (target.toolId === DEFAULT_TOOL_ID) {
      useEditorWorkspaceStore.getState().openDroppedText('发送的内容', text);
      return;
    }
    requestHandoff(target.toolId, text);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          title="发送到其他工具"
          aria-label="发送到其他工具"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Forward aria-hidden className="size-3.5" />
          发送到
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {targets.map((t) => (
          <DropdownMenuItem key={t.toolId} onSelect={() => send(t)}>
            <FileInput aria-hidden className="size-3.5" />
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 5: 验证**

Run: `pnpm test -- src/hooks/useToolHandoff.test.tsx src/components/send-to-menu.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS(DropdownMenuItem 是否透传 role=menuitem 以 ui/dropdown-menu.tsx 封装为准;若非 menuitem 角色,断言改用 getByText)

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useToolHandoff.ts src/components/send-to-menu.tsx src/hooks/useToolHandoff.test.tsx src/components/send-to-menu.test.tsx
git commit -m "feat(send-to): 跨工具传值 hook 与输出区发送菜单组件"
```

---

### Task 4: 三个工具接入发送与接收

**Files:**

- Modify: `src/tools/JsonFormatter.tsx`、`src/tools/Base64Codec.tsx`、`src/tools/HashCalculator.tsx`(各自输出区 actions 与接收 hook)
- Test: 各自 shortcuts 测试文件追加 1 个「发送」冒烟用例(可选),或新建最小用例

**Interfaces:**

- Consumes: Task 3 的 `useToolHandoff` / `SendToMenu`;各工具已有的输出 state(`output`)与输入 setter(`setDocContent`/`setText`)

- [ ] **Step 1: JsonFormatter**

imports 加:

```ts
import { SendToMenu } from '@/components/send-to-menu';
import { useToolHandoff } from '@/hooks/useToolHandoff';
```

快捷键注册块(`useToolShortcutActions(...)`)之后加:

```ts
// 「发送到…」接收端:成为激活工具时注入当前文档
useToolHandoff(toolId, (incoming) => {
  if (activeDocId) setDocContent(activeDocId, incoming);
});
```

两处输出工具栏(文本视图 :911 区与树视图 :885 区)的 `<CopyAction text={output} testId="output-copy" />` 旁各加:

```tsx
<SendToMenu text={output} currentToolId={toolId} testId="output-send" />
```

- [ ] **Step 2: Base64Codec**

同上加 imports;`useToolShortcutActions` 块之后加:

```ts
// 「发送到…」接收端
useToolHandoff(toolId, (incoming) => setText(incoming));
```

输出区(:686 区)`<CopyAction text={output} testId="output-copy" />` 旁加:

```tsx
{
  output ? <SendToMenu text={output} currentToolId={toolId} testId="output-send" /> : null;
}
```

- [ ] **Step 3: HashCalculator**

同上加 imports;`useToolShortcutActions` 块之后加:

```ts
// 「发送到…」接收端
useToolHandoff(toolId, (incoming) => setText(incoming));
```

输出区 `actions` 片段内 `<CopyAction text={output.text} testId="copy-hash" />` 改为条件包裹:

```tsx
{
  output?.text && (
    <>
      <CopyAction text={output.text} testId="copy-hash" />
      <SendToMenu text={output.text} currentToolId={toolId} testId="output-send" />
    </>
  );
}
```

- [ ] **Step 4: 验证**

Run: `pnpm test -- src/tools/JsonFormatter src/tools/Base64Codec src/tools/HashCalculator && pnpm typecheck && pnpm lint`
Expected: 既有用例全绿(新增节点不破坏既有查询)

- [ ] **Step 5: Commit**

```bash
git add src/tools/JsonFormatter.tsx src/tools/Base64Codec.tsx src/tools/HashCalculator.tsx
git commit -m "feat(send-to): JSON/Base64/哈希 三工具接入输出发送与接收"
```

---

### Task 5: Smart Detection 探测纯函数

**Files:**

- Create: `src/lib/clipboard-detect.ts`
- Test: `src/lib/clipboard-detect.test.ts`

**Interfaces:**

- Produces(Task 6 消费):
  ```ts
  export interface DetectionResult {
    toolId: string;
    reason: string;
  }
  export function detectClipboardTools(raw: string): DetectionResult[];
  ```
- 约定:最多返回 3 条,按置信度排序;空串/>64KB 返回 [];**永不抛错**(JSON.parse 包 try)

- [ ] **Step 1: 写失败测试**

创建 `src/lib/clipboard-detect.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectClipboardTools } from './clipboard-detect';

const idsOf = (s: string) => detectClipboardTools(s).map((r) => r.toolId);

describe('detectClipboardTools', () => {
  it('空串与超长输入返回空数组', () => {
    expect(idsOf('   ')).toEqual([]);
    expect(idsOf('x'.repeat(65_537))).toEqual([]);
  });

  it('识别 JSON 对象与数组', () => {
    expect(idsOf('{"a":1}')).toContain('json_formatter');
    expect(idsOf('[1,2,3]')).toContain('json_formatter');
    expect(idsOf('{not json}')).not.toContain('json_formatter');
  });

  it('识别 JWT 三段结构', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.' + '2bX9ZQ'.repeat(6);
    expect(idsOf(jwt)).toContain('jwt_parser');
  });

  it('识别单行 Base64(长度为 4 的倍数且可解码)', () => {
    expect(idsOf('aGVsbG8gd29ybGQhIQ==')).toContain('base64_codec');
    expect(idsOf('这是普通中文句子!!')).not.toContain('base64_codec');
  });

  it('识别 PEM 证书并置于首位', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    const r = detectClipboardTools(pem);
    expect(r[0]!.toolId).toBe('certificate_decoder');
  });

  it('识别 URL 编码片段', () => {
    expect(idsOf('hello%20world%21')).toContain('url_codec');
  });

  it('结果去重且不超过 3 条', () => {
    // 一个既像 base64 又含 URL 编码的混合串:确保上限逻辑存在
    const mixed = `${'%41%42%43%44%45%46%47%48%49%4A%4B%4C%4D%4E%4F%50'}${'QQ=='.repeat(40)}`;
    expect(detectClipboardTools(mixed).length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/lib/clipboard-detect.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

创建 `src/lib/clipboard-detect.ts`:

```ts
/**
 * 剪贴板内容 → 建议工具 的本地启发式探测(Smart Detection 轻量版)。
 * 纯函数、零网络、零副作用;仅在用户开启开关后被 App 层调用(见 Task 6)。
 */
export interface DetectionResult {
  toolId: string;
  reason: string;
}

const MAX_INPUT_CHARS = 65_536;
const MAX_RESULTS = 3;

function looksLikeJwt(text: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(text);
}

function looksLikeBase64(text: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
  if (text.length < 20 || text.length % 4 !== 0) return false;
  try {
    return atob(text).length >= 8;
  } catch {
    return false;
  }
}

function looksLikeUrlEncoded(text: string): boolean {
  return /%[0-9A-Fa-f]{2}/.test(text) && text.length >= 9;
}

function isProbablyJson(text: string): boolean {
  if (!/^[[{]/.test(text) || !/[\]}]$/.test(text)) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** 对剪贴板原文做类型探测,返回建议工具(置信度降序,至多 3 条) */
export function detectClipboardTools(raw: string): DetectionResult[] {
  if (typeof raw !== 'string') return [];
  const text = raw.trim();
  if (!text || text.length > MAX_INPUT_CHARS) return [];

  const results: DetectionResult[] = [];
  if (/^-----BEGIN CERTIFICATE-----/.test(text)) {
    results.push({ toolId: 'certificate_decoder', reason: 'PEM 证书' });
  }
  if (looksLikeJwt(text)) results.push({ toolId: 'jwt_parser', reason: 'JWT 结构' });
  if (isProbablyJson(text)) results.push({ toolId: 'json_formatter', reason: 'JSON 内容' });
  if (looksLikeBase64(text)) results.push({ toolId: 'base64_codec', reason: 'Base64 编码' });
  if (looksLikeUrlEncoded(text)) results.push({ toolId: 'url_codec', reason: 'URL 编码片段' });
  return results.slice(0, MAX_RESULTS);
}
```

- [ ] **Step 4: 验证并提交**

Run: `pnpm test -- src/lib/clipboard-detect.test.ts && pnpm typecheck && pnpm lint`

```bash
git add src/lib/clipboard-detect.ts src/lib/clipboard-detect.test.ts
git commit -m "feat(smart-detect): 剪贴板类型探测纯函数(JSON/JWT/Base64/PEM/URL)"
```

---

### Task 6: 开关(uiStore)+ App 聚焦探测 + 命令面板推荐组

**Files:**

- Modify: `src/store/uiStore.ts`(state 字段 + partialize)、`src/App.tsx`(探测 effect)、`src/components/CommandPalette.tsx`(推荐 Group)、`src/components/SettingsPanel.tsx`(开关行)
- Test: `src/store/uiStore.smart-detect.test.ts`、`src/components/command-palette.detect.test.tsx`

**设计要点(安全不变量)**:开关默认 **false**;关闭状态下全链路零剪贴板读取;release-checklist.md 第 67 条同步改写为「默认关闭;开启后仅在窗口聚焦时读取本地剪贴板,无任何网络请求」。

- [ ] **Step 1: 写失败测试(store)**

创建 `src/store/uiStore.smart-detect.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

describe('uiStore smartDetectionEnabled', () => {
  beforeEach(() => {
    useUiStore.setState({ smartDetectionEnabled: false });
  });

  it('默认关闭', () => {
    expect(useUiStore.getState().smartDetectionEnabled).toBe(false);
  });

  it('toggleSmartDetection 翻转开关', () => {
    useUiStore.getState().toggleSmartDetection();
    expect(useUiStore.getState().smartDetectionEnabled).toBe(true);
    useUiStore.getState().toggleSmartDetection();
    expect(useUiStore.getState().smartDetectionEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: 实现 store 字段**

`uiStore.ts`:接口(L26 区)加 `smartDetectionEnabled: boolean;` 与 `toggleSmartDetection: () => void;`;初始值(L52 区)加 `smartDetectionEnabled: false,`;action 区加:

```ts
toggleSmartDetection: () =>
  set((s) => ({ smartDetectionEnabled: !s.smartDetectionEnabled })),
```

partialize(L111)返回对象加一行 `smartDetectionEnabled: s.smartDetectionEnabled,`。

- [ ] **Step 3: App 探测 effect + 探测结果 store**

复用 handoffStore 思路但独立轻量:在 `src/store/detectionStore.ts` 新建(3 行状态:`results: DetectionResult[]` + `setResults`),或并入 uiStore(字段 `detectedTools: DetectionResult[]`)。**采用后者减少文件数**:uiStore 加 `detectedTools: DetectionResult[]`(初始 `[]`)与非持久化 setDetectedTools action(partialize 不含它)。

App.tsx 在全局快捷键区之前插入:

```ts
// —— Smart Detection(opt-in):窗口聚焦时本地探测剪贴板,结果进命令面板 ——
const smartDetectionEnabled = useUiStore((s) => s.smartDetectionEnabled);
useEffect(() => {
  if (!smartDetectionEnabled || !('__TAURI_INTERNALS__' in window)) return;
  let cancelled = false;
  const detect = () => {
    void readClipboardText().then((raw) => {
      if (cancelled) return;
      useUiStore.getState().setDetectedTools(detectClipboardTools(raw ?? ''));
    });
  };
  detect();
  window.addEventListener('focus', detect);
  return () => {
    cancelled = true;
    window.removeEventListener('focus', detect);
  };
}, [smartDetectionEnabled]);
```

imports 加:

```ts
import { readClipboardText } from '@/lib/clipboard';
import { detectClipboardTools, type DetectionResult } from '@/lib/clipboard-detect';
```

jsdom 测试环境无 `__TAURI_INTERNALS__` 会短路 —— 这是刻意保守:探测只在桌面壳内运行;web 预览模式不支持此功能(在代码注释中说明)。lib/clipboard 的 navigator 分支在 WebView2 可能静默失败降级 IPC,均兜底空串,符合探测语义。

- [ ] **Step 4: CommandPalette 推荐 Group**

`CommandPalette.tsx` L53(`CommandEmpty` 之后、「工具」Group 之前)插入:

```tsx
{
  detected.length > 0 && (
    <CommandGroup heading="检测到剪贴板内容">
      {detected.map((d) => {
        const entry = TOOL_CATALOG.find((c) => c.id === d.toolId);
        if (!entry) return null;
        return (
          <CommandItem
            key={d.toolId}
            value={`detect-${d.toolId}-${d.reason}`}
            onSelect={() => {
              openTool(d.toolId);
              onOpenChange(false);
            }}
          >
            <entry.icon aria-hidden className="size-4" />
            <span>{entry.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{d.reason}</span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
```

组件顶部加:

```ts
const detected = useUiStore((s) => s.detectedTools);
```

(`openTool`/`onOpenChange` 已在该文件作用域;若命名不同以现文件为准对齐。)

- [ ] **Step 5: SettingsPanel 开关行(通用区块)**

在通用设置的表单 JSX 之后、该 section 结束前,插入受控于 uiStore 的独立 Switch 行(不经 react-hook-form):

```tsx
<div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
  <div>
    <Label>剪贴板智能检测</Label>
    <p className="text-xs text-muted-foreground">
      仅在本机:窗口聚焦时读取剪贴板做本地类型探测,并在 Ctrl+K 面板顶部给出建议。默认关闭。
    </p>
  </div>
  <Switch
    checked={smartDetectionEnabled}
    onCheckedChange={() => toggleSmartDetection()}
    aria-label="剪贴板智能检测开关"
  />
</div>
```

组件函数体内加:

```ts
const smartDetectionEnabled = useUiStore((s) => s.smartDetectionEnabled);
const toggleSmartDetection = useUiStore((s) => s.toggleSmartDetection);
```

(Switch/Label 该文件已 import;useUiStore 需补 import。插入锚点:搜索 `generalSchema` 表单渲染所在的 section 闭合标签之前——实施时以 SettingsPanel 实际结构定位,保持不嵌进 form 元素内部以免触发 form 校验。)

- [ ] **Step 6: palette 测试**

创建 `src/components/command-palette.detect.test.tsx`(仿 CommandPalette 既有测试的挂载方式):

核心用例:`useUiStore.setState({ detectedTools: [{ toolId: 'jwt_parser', reason: 'JWT 结构' }] })` 后打开面板,断言出现文本「检测到剪贴板内容」与「JWT 编解码器」条目;选中后 `openTool` 生效(currentToolId 变为 jwt_parser)。

- [ ] **Step 7: 同步修订安全清单**

`docs/release-checklist.md:67` 该条改为:

```markdown
- [ ] 剪贴板:默认关闭「剪贴板智能检测」;关闭态启动 + 使用 10 个工具过程中无任何剪贴板读取。开启后仅在窗口聚焦时本地探测(Ctrl+K 展示建议),仍无网络上传
```

- [ ] **Step 8: 验证并提交**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 全绿

```bash
git add src/store/uiStore.ts src/App.tsx src/components/CommandPalette.tsx src/components/SettingsPanel.tsx src/store/uiStore.smart-detect.test.ts src/components/command-palette.detect.test.tsx docs/release-checklist.md
git commit -m "feat(smart-detect): opt-in 剪贴板探测与命令面板推荐组(默认关闭)"
```

---

## 明确不在本批(P1-b / 后续立项)

- 5 个纯前端新工具(JSON↔CSV、文本统计、ULID、Basic Auth、IPv4 子网)→ `2026-08-25-p1b-new-tools.md`
- i18n(en/zh)→ 独立策略计划(触及全部文案与目录元数据)
- updater S1 签名修复 → 需密钥/平台范围决策后立项
