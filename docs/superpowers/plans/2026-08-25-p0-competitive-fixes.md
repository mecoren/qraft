# P0 竞品分析修复批次 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地竞品分析报告(docs/competitive-analysis-2026-08-25.md)的 P0 五项 + P1 第 11 项:修复幽灵快捷键、e.repeat 守卫、reduced-motion、死代码清理、性能实测基线。

**Architecture:** 快捷键接线复用 namingCaseCommand 的「模块级注册表 + 全局 handler」范式,新增 `lib/tool-actions.ts`(注册表+三个 handler)与 `hooks/useToolShortcutActions.ts`(工具侧 latest-ref 注册 hook),App.tsx 接线,三个高频工具先行接入。性能基线 = criterion bench(Rust)+ Windows 测量脚本。

**Tech Stack:** React 19 + vitest/jsdom(全局 mock 见 src/test/setup.ts)、Rust criterion 0.5、PowerShell 5.1。

## Global Constraints

- 前端命令:`pnpm test` / `pnpm lint` / `pnpm typecheck`;单文件:`pnpm test -- <path>`
- Rust 命令在 `src-tauri/` 下:`cargo test` / `cargo clippy --all-targets` / `cargo bench`
- 提交信息:conventional commits 中文描述(feat:/fix:/perf:/refactor:/test:/docs:)
- UI 文案全部中文;新文件注释风格与邻近文件一致(中文 JSDoc)
- eslint react-x 插件生效:effect 内不得同步 setState(ref 赋值允许)
- 每个任务结束跑 lint + typecheck;涉及测试的任务先看新测试失败(TDD)
- 不引入新 npm 依赖

---

### Task 1: useShortcut 增加 e.repeat 守卫

**Files:**
- Modify: `src/hooks/useShortcut.ts:117-123`(onKey 回调)
- Create: `src/hooks/useShortcut.test.tsx`

**Interfaces:**
- Consumes: 现有 `useShortcut(key, handler, deps)`
- Produces: 行为不变,仅忽略 `KeyboardEvent.repeat === true` 的事件

- [ ] **Step 1: 写失败测试**

创建 `src/hooks/useShortcut.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useShortcut } from './useShortcut';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';

function Harness({ onFire }: { onFire: () => void }) {
  useShortcut('execute_tool', onFire, [onFire]);
  return null;
}

describe('useShortcut', () => {
  beforeEach(() => {
    useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG } });
  });

  function fireKey(init: KeyboardEventInit) {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', init));
    });
  }

  it('匹配组合键时触发一次', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    fireKey({ key: 'Enter', ctrlKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('长按自动重复(e.repeat)不触发,防止快捷键连发', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    fireKey({ key: 'Enter', ctrlKey: true, repeat: true });
    fireKey({ key: 'Enter', ctrlKey: true, repeat: true });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('首次按下(repeat=false)后,同次长按的 repeat 不叠加触发', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    fireKey({ key: 'Enter', ctrlKey: true, repeat: false });
    fireKey({ key: 'Enter', ctrlKey: true, repeat: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/hooks/useShortcut.test.tsx`
Expected: 「长按自动重复」两条 FAIL(handler 被调用),第一条 PASS

- [ ] **Step 3: 最小实现**

`src/hooks/useShortcut.ts` 的 `onKey` 开头加守卫:

```ts
    const onKey = (e: KeyboardEvent) => {
      // 长按产生的自动重复事件全部忽略:现有绑定均为离散动作(开关面板/执行/复制),
      // 连发只会造成误触。若未来出现需要长按连发的绑定,应单独豁免。
      if (e.repeat) return;
      if (matchesShortcut(e, parsed)) {
        e.preventDefault();
        e.stopPropagation();
        handler();
      }
    };
```

并在文件头部用法注释下补一行:`* 所有绑定默认忽略 e.repeat(长按连发)。`

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test -- src/hooks/useShortcut.test.tsx && pnpm typecheck && pnpm lint`
Expected: 全部 PASS,typecheck/lint 无新增错误

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useShortcut.ts src/hooks/useShortcut.test.tsx
git commit -m "fix(shortcut): 忽略长按自动重复事件(e.repeat),防止快捷键连发"
```

---

### Task 2: prefers-reduced-motion 全局适配

**Files:**
- Modify: `src/styles/globals.css`(文件末尾追加)
- Modify: `src/styles/globals.test.ts`(追加守护用例)

**Interfaces:** 纯 CSS;守护测试锁定媒体查询存在

- [ ] **Step 1: 写失败守护测试**

`src/styles/globals.test.ts` describe 块内追加:

```ts
  it('尊重系统减少动态效果偏好(prefers-reduced-motion)', () => {
    const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf-8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/styles/globals.test.ts`
Expected: 新用例 FAIL

- [ ] **Step 3: 实现**

`src/styles/globals.css` 末尾(search-anchor-pulse 之后)追加:

```css
/* ── 无障碍:尊重系统「减少动态效果」偏好(WCAG 2.3.3)───────────────────
 * 系统开启减弱动态效果时,压缩装饰性动画与过渡时长并禁用平滑滚动;
 * 仅影响动效表现,不改变布局与配色。 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 4: 验证**

Run: `pnpm test -- src/styles/globals.test.ts && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/styles/globals.css src/styles/globals.test.ts
git commit -m "feat(a11y): 支持 prefers-reduced-motion 减弱动态效果"
```

---

### Task 3: 删除 SideNav 死代码(U6)

**Files:**
- Delete: `src/components/SideNav.tsx`、`src/components/SideNav.test.tsx`
- Modify: `src/lib/tool-icon.tsx:10`(注释)、`src/App.test.tsx:71`(描述)、`src/integration.smoke.test.tsx`(describe 标题)

前置事实:全库 grep 仅 SideNav 自身测试 import 它;App.test/integration 只用 `getByRole('navigation')`(测的是现行 Sidebar),无组件引用。

- [ ] **Step 1: 再次确认零引用**

Run: `git grep -n "SideNav" -- src | Select-String -NotMatch "SideNav.tsx|SideNav.test"`
Expected: 仅 tool-icon.tsx 注释、App.test 描述、integration describe 标题命中

- [ ] **Step 2: 删除文件并清理引用**

```bash
git rm src/components/SideNav.tsx src/components/SideNav.test.tsx
```

- `src/lib/tool-icon.tsx:10` 注释改为:` * - 该模块供 Sidebar / ToolPanel 复用,避免重复解析逻辑`
- `src/App.test.tsx:71` 改为:``it('renders sidebar with tool groups after mount', async () => {``
- `src/integration.smoke.test.tsx` describe 改为:`describe('smoke: 侧栏显示工具分组', () => {`

- [ ] **Step 3: 全量回归**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 原 803 用例减去 SideNav.test 的用例数后全绿

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(ui): 删除零引用的旧版 SideNav 组件(U6 死代码清理)"
```

---

### Task 4: 工具动作注册表 lib/tool-actions.ts

**Files:**
- Create: `src/lib/tool-actions.ts`
- Test: `src/lib/tool-actions.test.ts`

**Interfaces:**
- Produces(Task 5/6/7-9 消费):
  - `interface ToolShortcutActions { execute?: () => void; clearInput?: () => void; copyOutput?: () => void }`
  - `setToolActions(toolId: string, actions: ToolShortcutActions | null): void`(null = 注销)
  - `executeToolAction(): void` / `clearInputAction(): void` / `copyOutputAction(): void`(供 App.tsx useShortcut 调用)
  - `resetToolActions(): void`(仅供测试隔离)

- [ ] **Step 1: 写失败测试**

创建 `src/lib/tool-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import {
  clearInputAction,
  copyOutputAction,
  executeToolAction,
  resetToolActions,
  setToolActions,
} from './tool-actions';
import { useToolStateStore } from '@/store/toolStateStore';

function setActiveTool(id: string | null): void {
  useToolStateStore.setState({ currentToolId: id });
}

describe('tool-actions 注册表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetToolActions();
    setActiveTool('json_formatter');
  });

  it('激活工具已注册动作时直接执行', () => {
    const exec = vi.fn();
    setToolActions('json_formatter', { execute: exec });
    executeToolAction();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('未提供对应动作时降级为提示且不抛错', () => {
    setToolActions('json_formatter', {});
    executeToolAction();
    expect(toast.info).toHaveBeenCalledWith('当前工具不支持快捷键执行');
    copyOutputAction();
    expect(toast.info).toHaveBeenCalledWith('当前工具暂无可复制的输出');
  });

  it('只响应 currentToolId 对应的注册项(keepalive 多实例并存)', () => {
    const a = vi.fn();
    const b = vi.fn();
    setToolActions('json_formatter', { execute: a });
    setToolActions('hash_calculator', { execute: b });
    setActiveTool('hash_calculator');
    executeToolAction();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('currentToolId 为 null 时安全降级为提示', () => {
    setActiveTool(null);
    expect(() => clearInputAction()).not.toThrow();
    expect(toast.info).toHaveBeenCalled();
  });

  it('注销(null)后不再可用', () => {
    const fn = vi.fn();
    setToolActions('json_formatter', { execute: fn });
    setToolActions('json_formatter', null);
    executeToolAction();
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/lib/tool-actions.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现**

创建 `src/lib/tool-actions.ts`:

```ts
/**
 * 工具操作类全局快捷键(Ctrl+Enter 执行 / Ctrl+L 清空输入 / Ctrl+Shift+C 复制输出)的
 * 「激活工具动作」注册表。
 *
 * 范式与 tools/code-editor-workspace/namingCaseCommand.ts 一致:模块级注册表 +
 * 导出的全局 handler,由 App.tsx 的 useShortcut 调用。
 *
 * keepalive 架构下多个工具实例同时挂载,按 toolId 区分注册项;
 * 只有 toolStateStore.currentToolId 指向的工具会被触发。
 * 工具未注册或未提供某个动作时,降级为 toast 提示而非静默失败。
 */
import { toast } from 'sonner';
import { useToolStateStore } from '@/store/toolStateStore';

/** 工具可暴露给全局快捷键的动作集合,缺省项表示该工具不支持此动作 */
export interface ToolShortcutActions {
  execute?: () => void;
  clearInput?: () => void;
  copyOutput?: () => void;
}

const registered = new Map<string, ToolShortcutActions>();

/** 工具挂载时注册动作;传 null 注销(卸载清理路径) */
export function setToolActions(toolId: string, actions: ToolShortcutActions | null): void {
  if (actions === null) {
    registered.delete(toolId);
  } else {
    registered.set(toolId, actions);
  }
}

/** 清空全部注册项,仅供测试隔离使用 */
export function resetToolActions(): void {
  registered.clear();
}

function resolveActive(): ToolShortcutActions | undefined {
  const id = useToolStateStore.getState().currentToolId;
  return id ? registered.get(id) : undefined;
}

/** Ctrl+Enter:执行当前工具 */
export function executeToolAction(): void {
  const action = resolveActive()?.execute;
  if (!action) {
    toast.info('当前工具不支持快捷键执行');
    return;
  }
  action();
}

/** Ctrl+L:清空当前工具输入 */
export function clearInputAction(): void {
  const action = resolveActive()?.clearInput;
  if (!action) {
    toast.info('当前工具不支持快捷键清空输入');
    return;
  }
  action();
}

/** Ctrl+Shift+C:复制当前工具输出 */
export function copyOutputAction(): void {
  const action = resolveActive()?.copyOutput;
  if (!action) {
    toast.info('当前工具暂无可复制的输出');
    return;
  }
  action();
}
```

- [ ] **Step 4: 验证**

Run: `pnpm test -- src/lib/tool-actions.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tool-actions.ts src/lib/tool-actions.test.ts
git commit -m "feat(shortcut): 新增工具动作注册表(execute/clear/copy 三件套)"
```

---

### Task 5: useToolShortcutActions hook

**Files:**
- Create: `src/hooks/useToolShortcutActions.ts`
- Test: `src/hooks/useToolShortcutActions.test.tsx`

**Interfaces:**
- Consumes: Task 4 的 `setToolActions` / `resetToolActions` / `executeToolAction` / `ToolShortcutActions`
- Produces(Task 7-9 消费): `useToolShortcutActions(toolId: string, actions: ToolShortcutActions): void`

- [ ] **Step 1: 写失败测试**

创建 `src/hooks/useToolShortcutActions.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useToolShortcutActions } from './useToolShortcutActions';
import { executeToolAction, resetToolActions } from '@/lib/tool-actions';
import { useToolStateStore } from '@/store/toolStateStore';

function Harness({ toolId, onExecute }: { toolId: string; onExecute: () => void }) {
  useToolShortcutActions(toolId, { execute: onExecute });
  return null;
}

describe('useToolShortcutActions', () => {
  beforeEach(() => {
    resetToolActions();
    useToolStateStore.setState({ currentToolId: 'demo_tool' });
  });

  it('挂载后注册生效、卸载后注销', () => {
    const onExecute = vi.fn();
    const { unmount } = render(<Harness toolId="demo_tool" onExecute={onExecute} />);
    executeToolAction();
    expect(onExecute).toHaveBeenCalledTimes(1);
    unmount();
    // 卸载后走「不支持」降级路径,不应再命中旧回调
    executeToolAction();
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it('重渲染后始终执行最新闭包(latest-ref)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness toolId="demo_tool" onExecute={first} />);
    rerender(<Harness toolId="demo_tool" onExecute={second} />);
    executeToolAction();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
```

注意:卸载后第二次 `executeToolAction()` 会调 sonner toast —— 本文件需像 HashCalculator.test 一样 mock sonner:

文件顶部补:
```tsx
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/hooks/useToolShortcutActions.test.tsx`
Expected: FAIL(hook 不存在)

- [ ] **Step 3: 实现**

创建 `src/hooks/useToolShortcutActions.ts`:

```ts
/**
 * 把工具实例的动作注册进 lib/tool-actions 全局注册表,
 * 供 Ctrl+Enter / Ctrl+L / Ctrl+Shift+C 触达当前激活工具。
 *
 * actions 经 latest-ref 转发:回调始终读取最新渲染的闭包,
 * 因此调用方无需把 input/output 等 state 列入任何依赖数组。
 */
import { useEffect, useRef } from 'react';
import { setToolActions, type ToolShortcutActions } from '@/lib/tool-actions';

export function useToolShortcutActions(toolId: string, actions: ToolShortcutActions): void {
  const latestRef = useRef<ToolShortcutActions>(actions);

  useEffect(() => {
    latestRef.current = actions;
  });

  useEffect(() => {
    setToolActions(toolId, {
      execute: () => latestRef.current.execute?.(),
      clearInput: () => latestRef.current.clearInput?.(),
      copyOutput: () => latestRef.current.copyOutput?.(),
    });
    return () => setToolActions(toolId, null);
  }, [toolId]);
}
```

- [ ] **Step 4: 验证**

Run: `pnpm test -- src/hooks/useToolShortcutActions.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS(lint 若对 effect 内 ref 赋值报警,属 react-x 规则误报时按仓库既有方式处理,不得静默改语义)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useToolShortcutActions.ts src/hooks/useToolShortcutActions.test.tsx
git commit -m "feat(shortcut): useToolShortcutActions 打通工具与全局注册表"
```

---

### Task 6: App.tsx 全局接线 + 设置页移除 pending 标记

**Files:**
- Modify: `src/App.tsx:145-157`
- Modify: `src/components/SettingsPanel.tsx:65-67`

**Interfaces:**
- Consumes: Task 4 的 `executeToolAction` / `clearInputAction` / `copyOutputAction`

- [ ] **Step 1: App.tsx 接线**

导入区(`cycle_naming_case` 相关 import 附近)加:

```ts
import { clearInputAction, copyOutputAction, executeToolAction } from '@/lib/tool-actions';
```

将 145-147 行注释与快捷键区替换为:

```ts
  // —— 全局快捷键(导航类) ——
  // 工具操作类(execute/clear/copy)经 lib/tool-actions 注册表触达当前激活工具,
  // 由各工具经 useToolShortcutActions 注册(search 除外,仍待与 Monaco 冲突方案)。
  // 切换字符命名风格:作用于当前激活的编辑器实例(编辑器工具打开时生效)。
  useShortcut('cycle_naming_case', () => cycleNamingCaseShortcutHandler(), []);
  useShortcut('toggle_case', () => toggleCaseShortcutHandler(), []);
  useShortcut('execute_tool', () => executeToolAction(), []);
  useShortcut('clear_input', () => clearInputAction(), []);
  useShortcut('copy_output', () => copyOutputAction(), []);
```

(后续 open_command_palette 等行保持不变)

- [ ] **Step 2: SettingsPanel 移除 pending**

删除以下三行的 `, pending: true`(`search` 的保留):

```ts
  { key: 'execute_tool', label: '执行工具', pending: true },
  { key: 'clear_input', label: '清空输入', pending: true },
  { key: 'copy_output', label: '复制输出', pending: true },
```

改为:

```ts
  { key: 'execute_tool', label: '执行工具' },
  { key: 'clear_input', label: '清空输入' },
  { key: 'copy_output', label: '复制输出' },
```

- [ ] **Step 3: 验证**

Run: `pnpm test -- src/components/SettingsPanel && pnpm test -- src/App.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS(SettingsPanel 若有断言 pending 徽标存在的用例,更新其期望为三键无徽标)

- [ ] **Step 4: 手动冒烟(可选)**

Run: `pnpm tauri dev`,打开 JSON 格式化器粘贴 `{"a":1}` 按 Ctrl+Enter/Ctrl+L/Ctrl+Shift+C 观察行为与提示

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/SettingsPanel.tsx
git commit -m "feat(shortcut): 全局接线 Ctrl+Enter/Ctrl+L/Ctrl+Shift+C 并移除设置页未生效标记"
```

---

### Task 7: JsonFormatter 接入(参考实现)

**Files:**
- Modify: `src/tools/JsonFormatter.tsx`(imports + runFormat 定义之后 ~398 行)
- Test: Create `src/tools/json-formatter-shortcuts.test.tsx`

**Interfaces:**
- Consumes: Task 5 `useToolShortcutActions(toolId, actions)`;组件内已有 `runFormat(auto?: boolean)`、`text`(store 当前文档内容)、`output`、`setDocContent`、`activeDocId`

- [ ] **Step 1: 写失败测试**

创建 `src/tools/json-formatter-shortcuts.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { JsonFormatter } from './JsonFormatter';
import { copyTextWithFeedback } from '@/lib/toast-alert';

function textboxes(): HTMLTextAreaElement[] {
  return screen.getAllByRole('textbox') as unknown as HTMLTextAreaElement[];
}

async function type(input: string): Promise<void> {
  const box = textboxes()[0]!;
  fireEvent.change(box, { target: { value: input } });
  await waitFor(() => {
    expect((textboxes()[0] as HTMLTextAreaElement).value).toBe(input);
  });
}

describe('JsonFormatter 全局快捷键', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Ctrl+Enter 立即格式化(不等防抖)', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await type('{"a":1}');
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(textboxes().some((t) => t.value.includes('"a": 1'))).toBe(true);
    });
  });

  it('Ctrl+L 清空当前文档输入', async () => {
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await type('{"a":1}');
    fireEvent.keyDown(window, { key: 'L', ctrlKey: true });
    await waitFor(() => {
      expect(textboxes()[0]!.value).toBe('');
    });
  });

  it('Ctrl+Shift+C 复制输出', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    await type('{"a":1}');
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(textboxes().some((t) => t.value.includes('"a": 1'))).toBe(true);
    });
    fireEvent.keyDown(window, { key: 'C', ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('"a": 1'));
    });
    expect(copyTextWithFeedback).toHaveBeenCalled();
  });
});
```

注:jsdom 下 `navigator.clipboard.writeText` 断言依赖 `lib/toast-alert → lib/clipboard` 链路;若 lib/clipboard 在 jsdom 走 Tauri 分支导致 writeText 未被调用,则只保留 `expect(copyTextWithFeedback).toHaveBeenCalled()` 断言并删掉 clipboard 断言(以实际运行为准,两种都算通过)。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/tools/json-formatter-shortcuts.test.tsx`
Expected: 三条均 FAIL(按键无响应)

- [ ] **Step 3: 实现**

`JsonFormatter.tsx`:

imports 区加:

```ts
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { copyTextWithFeedback } from '@/lib/toast-alert';
```

`runFormat` useCallback 结束(:398)之后插入:

```ts
  // 全局快捷键契约:Ctrl+Enter 执行 / Ctrl+L 清空当前文档 / Ctrl+Shift+C 复制输出。
  // 输入为空时不注册 execute(避免空跑);输出非空才注册复制,保证降级提示准确。
  useToolShortcutActions(toolId, {
    execute: text.trim() ? () => void runFormat(false) : undefined,
    clearInput: () => setDocContent(activeDocId, ''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });
```

- [ ] **Step 4: 验证**

Run: `pnpm test -- src/tools/json-formatter-shortcuts.test.tsx src/tools/JsonFormatter.test.tsx && pnpm typecheck && pnpm lint`
Expected: 新旧用例全绿(JsonFormatter.test 若因 textarea 数量假设脆弱而失败,修正选择器而非放宽断言)

- [ ] **Step 5: Commit**

```bash
git add src/tools/JsonFormatter.tsx src/tools/json-formatter-shortcuts.test.tsx
git commit -m "feat(shortcut): JSON 格式化器接入全局快捷键(参考实现)"
```

---

### Task 8: Base64Codec 接入

**Files:**
- Modify: `src/tools/Base64Codec.tsx`(imports + 自动执行 effects 之前 ~482 行)
- Test: Create `src/tools/base64-codec-shortcuts.test.tsx`

**Interfaces:**
- Consumes: 组件内已有 `isTextMode` / `isFileDecode` / `runTextExecute(auto?)` / `runBinaryExecute(auto?)` / `setText` / `resetWorkspace` / `output`

- [ ] **Step 1: 写失败测试**

创建 `src/tools/base64-codec-shortcuts.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
  CommandError: class CommandError extends Error {},
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { Base64Codec } from './Base64Codec';

function textboxes(): HTMLTextAreaElement[] {
  return screen.getAllByRole('textbox') as unknown as HTMLTextAreaElement[];
}

describe('Base64Codec 全局快捷键', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Ctrl+Enter 立即解码(decode 默认方向,text 模式)', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'hello',
      meta: { input_bytes: 8, output_bytes: 5, duration_ms: 1 },
    });
    render(<Base64Codec toolId="base64_codec" metadata={null as never} />);
    fireEvent.change(textboxes()[0]!, { target: { value: 'aGVsbG8=' } });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith(
        'tool_execute',
        expect.objectContaining({ toolId: 'base64_codec' }),
      );
      expect(textboxes().some((t) => t.value === 'hello')).toBe(true);
    });
  });

  it('Ctrl+L 清空输入并复位工作区', async () => {
    render(<Base64Codec toolId="base64_codec" metadata={null as never} />);
    fireEvent.change(textboxes()[0]!, { target: { value: 'aGVsbG8=' } });
    fireEvent.keyDown(window, { key: 'L', ctrlKey: true });
    await waitFor(() => {
      expect(textboxes()[0]!.value).toBe('');
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/tools/base64-codec-shortcuts.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现**

`Base64Codec.tsx` imports 加:

```ts
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { copyTextWithFeedback } from '@/lib/toast-alert';
```

`runBinaryExecute` 定义结束后、自动执行 effects 开始前(~482 行)插入:

```ts
  // 全局快捷键契约:text 模式执行编码/解码,file 解码执行二进制解析,
  // file 编码模式(需要文件选择器交互)不注册 execute。清空输入同时复位输出与预览。
  useToolShortcutActions(toolId, {
    execute: isTextMode
      ? () => void runTextExecute(false)
      : isFileDecode
        ? () => void runBinaryExecute(false)
        : undefined,
    clearInput: () => {
      setText('');
      resetWorkspace();
    },
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });
```

- [ ] **Step 4: 验证**

Run: `pnpm test -- src/tools/base64-codec-shortcuts.test.tsx src/tools/Base64Codec.test.tsx && pnpm typecheck && pnpm lint`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/tools/Base64Codec.tsx src/tools/base64-codec-shortcuts.test.tsx
git commit -m "feat(shortcut): Base64 转换器接入全局快捷键"
```

---

### Task 9: HashCalculator 接入

**Files:**
- Modify: `src/tools/HashCalculator.tsx`(handleCompute 定义之后)+ `src/tools/HashCalculator.test.tsx`(追加 3 用例)

- [ ] **Step 1: 写失败测试**

`HashCalculator.test.tsx` describe 尾部追加:

```tsx
  it('Ctrl+Enter 快捷键触发计算', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      meta: { input_bytes: 5, output_bytes: 64, duration_ms: 0 },
    });
    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith('tool_execute', {
        toolId: 'hash_calculator',
        input: { text: 'hello', params: { algorithm: 'sha256' } },
      });
    });
  });

  it('Ctrl+L 清空输入与输出', async () => {
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      meta: { input_bytes: 5, output_bytes: 64, duration_ms: 0 },
    });
    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /计算/ }));
    await screen.findByTestId('copy-hash');
    fireEvent.keyDown(window, { key: 'L', ctrlKey: true });
    await waitFor(() => {
      expect(editor.value).toBe('');
      expect(screen.queryByTestId('copy-hash')).not.toBeInTheDocument();
    });
  });

  it('Ctrl+Shift+C 复制哈希输出', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { invokeCommand } = await import('@/lib/ipc');
    (invokeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      meta: { input_bytes: 5, output_bytes: 64, duration_ms: 0 },
    });
    render(<HashCalculator toolId="hash_calculator" metadata={null as never} />);
    const editor = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /计算/ }));
    await screen.findByTestId('copy-hash');
    fireEvent.keyDown(window, { key: 'C', ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
    });
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/tools/HashCalculator.test.tsx`
Expected: 新增三条 FAIL

- [ ] **Step 3: 实现**

`HashCalculator.tsx`:imports 加:

```ts
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { copyTextWithFeedback } from '@/lib/toast-alert';
```

`handleCompute` 函数定义之后插入:

```ts
  // 全局快捷键契约:与主按钮同一套 loading/空输入防护;清空同时复位输出与错误
  useToolShortcutActions(toolId, {
    execute: loading || !text ? undefined : () => void handleCompute(),
    clearInput: () => {
      setText('');
      setOutput(null);
      setError(null);
    },
    copyOutput: output?.text ? () => void copyTextWithFeedback(output.text) : undefined,
  });
```

- [ ] **Step 4: 验证**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 全仓测试全绿(收口验证)

- [ ] **Step 5: Commit**

```bash
git add src/tools/HashCalculator.tsx src/tools/HashCalculator.test.tsx
git commit -m "feat(shortcut): 哈希计算器接入全局快捷键"
```

---

### Task 10: Rust criterion 基准(json_formatter)

**Files:**
- Modify: `src-tauri/Cargo.toml`([dev-dependencies] 与 [[bench]])
- Create: `src-tauri/benches/json_formatter.rs`
- Create: `docs/performance-baseline.md`

关键事实:lib 名 `qraft_lib`(Cargo.toml [lib]);`core/test_utils.rs` 是 `#![cfg(test)]`,bench 不可用 → bench 文件内自建 NoopSink;`ToolContext { cancel_token, config: serde_json::Value, history_sink: Arc<dyn HistorySink> }`;`HistorySink::write(&self, HistoryEntry) -> Result<(), ToolError>`(async_trait);`Tool::execute(&self, ToolInput, &ToolContext)` async。

- [ ] **Step 1: Cargo.toml 配置**

`[dev-dependencies]` 替换为:

```toml
[dev-dependencies]
tempfile = "3.10"
criterion = { version = "0.5", default-features = false, features = ["cargo_bench_support"] }

[[bench]]
name = "json_formatter"
harness = false
```

- [ ] **Step 2: 编写基准**

创建 `src-tauri/benches/json_formatter.rs`:

```rust
//! JSON 格式化基准(criterion)
//!
//! - `json_format_small`:小输入,走 `Tool::execute` 全链路(含 spawn_blocking 开销)
//! - `json_format_1mb`:1MB 输入,PRD「10MB JSON <500ms」目标的中间档参照
//!
//! 运行:cargo bench --bench json_formatter(结果写入 target/criterion)

use std::sync::Arc;

use criterion::{criterion_group, criterion_main, Criterion};
use tokio_util::sync::CancellationToken;

use qraft_lib::core::context::{HistoryEntry, HistorySink, ToolContext};
use qraft_lib::core::error::ToolError;
use qraft_lib::core::input::ToolInput;
use qraft_lib::core::tool::Tool;
use qraft_lib::tools::json_formatter::JsonFormatter;

struct NoopSink;

#[async_trait::async_trait]
impl HistorySink for NoopSink {
    async fn write(&self, _entry: HistoryEntry) -> Result<(), ToolError> {
        Ok(())
    }
}

fn bench_context() -> ToolContext {
    ToolContext {
        cancel_token: CancellationToken::new(),
        config: serde_json::Value::Object(serde_json::Map::new()),
        history_sink: Arc::new(NoopSink),
    }
}

/// 生成分嵌套对象数组 JSON,体积约等于 target_bytes(确定性,便于跨次对比)
fn nested_json(target_bytes: usize) -> String {
    let mut out = String::with_capacity(target_bytes + 16);
    out.push_str("{\"items\":[");
    let mut i = 0usize;
    while out.len() < target_bytes {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"id\":{i},\"name\":\"item-{i}\",\"tags\":[\"alpha\",\"beta\"],\"score\":0.{i:03}}}"
        ));
        i += 1;
    }
    out.push_str("]}");
    out
}

fn bench_json_formatter(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().expect("failed to build tokio runtime");
    let ctx = bench_context();
    let tool = JsonFormatter::new();

    let small = ToolInput {
        text: Some(r#"{"a":1,"b":[1,2,3],"c":{"d":"e"}}"#.to_string()),
        ..Default::default()
    };
    let large = ToolInput {
        text: Some(nested_json(1024 * 1024)),
        ..Default::default()
    };

    c.bench_function("json_format_small", |b| {
        b.iter(|| {
            let outcome = rt.block_on(tool.execute(small.clone(), &ctx));
            debug_assert!(outcome.is_ok(), "small json should format ok");
        })
    });

    c.bench_function("json_format_1mb", |b| {
        b.iter(|| {
            let outcome = rt.block_on(tool.execute(large.clone(), &ctx));
            debug_assert!(outcome.is_ok(), "large json should format ok");
        })
    });
}

criterion_group!(benches, bench_json_formatter);
criterion_main!(benches);
```

- [ ] **Step 3: 编译检查**

Run(workdir `src-tauri`): `cargo bench --no-run`
Expected: 编译通过;若 `qraft_lib::core::...` 可见性报错,核对 core 各模块 pub 声明(只修可见性,不改运行时代码)

- [ ] **Step 4: 运行并记录基线**

Run(workdir `src-tauri`): `cargo bench --bench json_formatter`
记录两行 mean/median 数值。

创建 `docs/performance-baseline.md`:

```markdown
# 性能基线

> 口径:本机 release(cargo bench 默认 profile)。每次优化/回归在此追加记录。

## Rust 工具执行(criterion)

| 日期 | 场景 | mean | 机器 |
|---|---|---|---|
| 2026-08-25 | json_format_small | <填入> | <CPU/RAM/OS> |
| 2026-08-25 | json_format_1mb | <填入> | 同上 |

## 应用级(冷启动/内存)

| 日期 | 平台 | 冷启动(到主窗口) | 主进程峰值 WorkingSet | WebView2 子进程合计 | 脚本 |
|---|---|---|---|---|---|
| <填入> | Windows | <填入> ms | <填入> MB | <填入> MB | scripts/perf-baseline.ps1 |

目标对照(prd/01-project-overview.md):冷启动<500ms · 小输入<50ms · 10MB JSON<500ms · 空闲内存<150MB · 安装包<30MB
```

- [ ] **Step 5: clippy 收口**

Run(workdir `src-tauri`): `cargo clippy --all-targets`
Expected: 无 deny 级告警(bench 文件同样受检)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/benches/json_formatter.rs docs/performance-baseline.md
git commit -m "perf(bench): 建立 json_formatter criterion 基准并记录首批数据"
```

---

### Task 11: Windows 性能测量脚本 + 发布清单挂钩

**Files:**
- Create: `scripts/perf-baseline.ps1`
- Modify: `docs/release-checklist.md`(性能验证小节)

- [ ] **Step 1: 编写脚本**

创建 `scripts/perf-baseline.ps1`:

```powershell
#Requires -Version 5.1
<#
.SYNOPSIS
  Windows 性能基线:冷启动时间与内存占用(qraft.exe)。
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/perf-baseline.ps1 -ExePath "src-tauri\target\release\qraft.exe"
.NOTES
  冷启动 = 进程 Start 到 MainWindowHandle 非零(含 WebView2 初始化的主进程侧等待)。
  内存 = qraft.exe WorkingSet;WebView2 渲染子进程(msedgewebview2)按启动时间归因,
  单独列出作参考值。macOS/Linux 口径见 docs/release-checklist.md 手动步骤。
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,
  [int]$Samples = 10,
  [int]$IntervalMs = 300
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ExePath)) {
  throw "找不到目标可执行文件: $ExePath"
}

Write-Host '== 冷启动 =='
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $ExePath -PassThru
try {
  $ready = $false
  while ($sw.ElapsedMilliseconds -lt 15000) {
    $proc.Refresh()
    if ($proc.HasExited) { throw "进程提前退出(code=$($proc.ExitCode))" }
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { $ready = $true; break }
    Start-Sleep -Milliseconds 20
  }
  if (-not $ready) {
    Write-Warning '15s 内未检测到主窗口句柄,本次冷启动数据无效'
  } else {
    Write-Host ('冷启动(到主窗口): {0} ms' -f $sw.ElapsedMilliseconds)
  }

  Write-Host ('== 内存({0} 次采样 / {1}ms)==' -f $Samples, $IntervalMs)
  $peak = [uint64]0
  for ($i = 1; $i -le $Samples; $i++) {
    Start-Sleep -Milliseconds $IntervalMs
    $proc.Refresh()
    if ($proc.WorkingSet64 -gt $peak) { $peak = $proc.WorkingSet64 }
    Write-Host ('  #{0}: {1:N1} MB' -f $i, ($proc.WorkingSet64 / 1MB))
  }
  Write-Host ('主进程峰值 WorkingSet: {0:N1} MB' -f ($peak / 1MB))

  $startAt = $proc.StartTime
  Start-Sleep -Milliseconds 500
  $children = @(Get-Process -Name 'msedgewebview2' -ErrorAction SilentlyContinue |
    Where-Object { $_.StartTime -ge $startAt })
  $childSum = ($children | Measure-Object -Property WorkingSet64 -Sum).Sum
  Write-Host ('WebView2 子进程(参考值): {0} 个,合计 {1:N1} MB' -f $children.Count, (($childSum ?? 0) / 1MB))
}
finally {
  if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}
```

注:PS5.1 无 `??` 运算符 —— 若脚本校验报语法错,将 `($childSum ?? 0)` 改为 `$(if ($null -eq $childSum) { 0 } else { $childSum })`。

- [ ] **Step 2: 冒烟验证脚本**

Run: 先确保有 release 产物(`pnpm tauri build` 或既有 dist),然后:
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/perf-baseline.ps1 -ExePath "<产物路径>" -Samples 5`
Expected: 输出冷启动 ms 与内存采样,无异常抛出

- [ ] **Step 3: 挂钩发布清单**

`docs/release-checklist.md` 的性能验证小节追加一条:

```markdown
- [ ] Windows 基线:`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/perf-baseline.ps1 -ExePath "<安装产物>"`,数值回填 `docs/performance-baseline.md`
```

- [ ] **Step 4: Commit**

```bash
git add scripts/perf-baseline.ps1 docs/release-checklist.md
git commit -m "perf(script): Windows 冷启动/内存基线测量脚本并挂钩发布清单"
```

---

## 后续(P1,不在本计划内)

Smart Detection 剪贴板感知、工具输出→输入链、i18n、6 个高频新工具、updater S1、重型 chunk 预取 —— 每项单独立计划。
