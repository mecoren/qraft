# 04 - React UI 脚手架实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 React 19 + shadcn/ui 的 UI 脚手架,包含设计系统、App shell、状态管理、IPC 客户端、通用组件(SideNav/CommandPalette/ToolPanel/HistoryPanel/SettingsPanel),为子计划 05 的具体工具 UI 提供承载框架。

**Architecture:** React 19 + Zustand(全局状态)+ React Hook Form + Zod(表单)+ shadcn/ui(组件)+ Tailwind(样式)。UI 通过 `lib/ipc.ts` 调用 Tauri Command,通过 `listen` 订阅事件更新 store。所有业务逻辑在 Rust 层,UI 仅负责输入收集与结果展示。

**Tech Stack:** React 19 + TypeScript 5.5 + Vite 5 + shadcn/ui + Radix UI + Tailwind CSS 3.4 + Zustand 5 + React Hook Form 7 + Zod 3 + cmdk + @tanstack/react-virtual + react-resizable-panels + Sonner + Vitest + @testing-library/react

**Depends on:** 01-project-bootstrap.md(前端构建配置)、03-tauri-shell-layer.md(IPC Command 已就绪)

---

## 目录

- [Task 1: 安装前端依赖](#task-1-安装前端依赖)
- [Task 2: Tailwind + 设计 Token 配置](#task-2-tailwind--设计-token-配置)
- [Task 3: cn 工具函数 + shadcn 基础组件](#task-3-cn-工具函数--shadcn-基础组件)
- [Task 4: TypeScript 类型定义(镜像 Rust)](#task-4-typescript-类型定义镜像-rust)
- [Task 5: lib/ipc.ts — Tauri invoke 封装](#task-5-libipcts--tauri-invoke-封装)
- [Task 6: store/configStore.ts — 配置状态](#task-6-storeconfigstorets--配置状态)
- [Task 7: store/historyStore.ts — 历史状态](#task-7-storehistorystorets--历史状态)
- [Task 8: store/toolStateStore.ts — 工具运行时状态](#task-8-storetoolstatestorets--工具运行时状态)
- [Task 9: hooks/useTool.ts — 工具执行 Hook](#task-9-hooksusetoolts--工具执行-hook)
- [Task 10: hooks/useClipboard.ts — 剪贴板 Hook](#task-10-hooksuseclipboardts--剪贴板-hook)
- [Task 11: components/ErrorBoundary.tsx](#task-11-componentserrorboundarytsx)
- [Task 12: components/SideNav.tsx — 侧边导航](#task-12-componentssidenavtsx--侧边导航)
- [Task 13: components/CommandPalette.tsx — 命令面板(Ctrl+K)](#task-13-componentscommandpalettetsx--命令面板ctrlk)
- [Task 14: components/ToolPanel.tsx — 工具面板(分栏)](#task-14-componentstoolpaneltsx--工具面板分栏)
- [Task 15: components/HistoryPanel.tsx — 历史记录面板](#task-15-componentshistorypaneltsx--历史记录面板)
- [Task 16: components/SettingsPanel.tsx — 设置面板](#task-16-componentssettingspaneltsx--设置面板)
- [Task 17: App.tsx — 应用根组件](#task-17-apptsx--应用根组件)
- [Task 18: main.tsx — React 入口](#task-18-maintsx--react-入口)
- [Task 19: 集成冒烟测试](#task-19-集成冒烟测试)

---

## 测试基础设施约定

所有 Vitest 测试遵循以下约定:

1. **Mock Tauri API**:在 `src/test/setup.ts` 中全局 mock `@tauri-apps/api/core` 与 `@tauri-apps/api/event`,避免 jsdom 环境调用真实 IPC
2. **路径别名**:测试中通过 `@/` 别名引用 `src/` 下文件(`vitest.config.ts` 配置 resolve.alias)
3. **每个测试文件命名**:`<file>.test.ts(x)`,与被测文件同目录
4. **每个 Task 至少 3 个测试**:渲染(或基础调用)、交互(或正常路径)、边界(或错误路径)
5. **运行单个测试**:`pnpm test -- <pattern>`,运行全部:`pnpm test`

---

## Task 1: 安装前端依赖

**目标:** 安装 React 19 + 全部 UI 与开发依赖,并配置 Vitest 测试基础设施。

### Step 1: 添加生产依赖

- [x] 执行以下命令安装生产依赖:

```bash
pnpm add react@^19 react-dom@^19 react-router-dom@^7 zustand@^5 react-hook-form@^7 zod@^3 @tauri-apps/api@^2 @tauri-apps/plugin-dialog@^2 @tauri-apps/plugin-clipboard-manager@^2 @tauri-apps/plugin-shell@^2 lucide-react@^0.400 clsx tailwind-merge sonner@^1.5 cmdk@^1 @tanstack/react-virtual@^3 react-resizable-panels@^2 date-fns@^3
```

### Step 2: 添加开发依赖

- [x] 执行以下命令安装开发依赖:

```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @types/react @types/react-dom @vitejs/plugin-react
```

### Step 3: 配置 Vitest

- [x] 创建 `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [x] 创建 `src/test/setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// 每个测试后清理 DOM,避免状态泄漏
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Mock @tauri-apps/api/core 的 invoke,避免 jsdom 调用真实 IPC
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/api/event 的 listen,返回空 unlisten
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
```

- [x] 在 `package.json` 中补充脚本(若 01 未添加):

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

### Step 4: 验证安装

- [x] 运行 `pnpm install` 应无错误:

```bash
pnpm install
```

预期输出包含 `Lockfile up to date` 或 `Done`,无 `ERR_PNPM` 错误。

- [x] 运行 `pnpm typecheck` 应通过(此时无源码,仅验证 TS 配置):

```bash
pnpm typecheck
```

### Step 5: 提交

- [x] 提交本次变更:

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/test/setup.ts
git commit -m "chore(ui): install React 19 + shadcn/ui deps and configure vitest"
```

---

## Task 2: Tailwind + 设计 Token 配置

**目标:** 按 `15-ui-design-system.md` §3.2 配置 Tailwind darkMode、CSS 变量与字体,为暗色主题就绪。

### Step 1: 写最小验证测试

- [x] 创建 `src/styles/globals.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('globals.css design tokens', () => {
  it('contains :root with light tokens', () => {
    const css = readFileSync(
      resolve(__dirname, 'globals.css'),
      'utf-8'
    );
    expect(css).toContain(':root');
    expect(css).toMatch(/--background:\s*0 0% 100%/);
    expect(css).toMatch(/--foreground:\s*222\.2 84% 4\.9%/);
  });

  it('contains .dark with dark tokens', () => {
    const css = readFileSync(
      resolve(__dirname, 'globals.css'),
      'utf-8'
    );
    expect(css).toContain('.dark');
    expect(css).toMatch(/--background:\s*222\.2 84% 4\.9%/);
    expect(css).toMatch(/--foreground:\s*210 40% 98%/);
  });

  it('defines radius and font tokens', () => {
    const css = readFileSync(
      resolve(__dirname, 'globals.css'),
      'utf-8'
    );
    expect(css).toMatch(/--radius:\s*0\.5rem/);
    expect(css).toMatch(/--font-sans:/);
    expect(css).toMatch(/--font-mono:/);
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/styles/globals.test.ts
```

预期:3 个测试全部失败,因 `src/styles/globals.css` 不存在或缺少 token 定义。

### Step 3: 写实现

- [x] 修改 `tailwind.config.ts`(若 01 已创建基础版本,在其上扩展):

```typescript
import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        sm: 'var(--font-size-sm)',
        base: 'var(--font-size-base)',
        lg: 'var(--font-size-lg)',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [x] 创建 `src/styles/globals.css`(若已存在则覆盖,严格按 `15-ui-design-system.md` §3.2 token 表):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* 背景 */
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;

    /* 卡片 */
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;

    /* 弹出层 */
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;

    /* 主色 */
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;

    /* 次要色 */
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;

    /* 静音色 */
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;

    /* 强调色 */
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;

    /* 危险色 */
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;

    /* 边框 */
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;

    /* 圆角 */
    --radius: 0.5rem;

    /* 间距 */
    --space-1: 0.25rem;
    --space-2: 0.5rem;
    --space-3: 0.75rem;
    --space-4: 1rem;
    --space-6: 1.5rem;
    --space-8: 2rem;

    /* 字体 */
    --font-sans: 'Inter', system-ui, sans-serif;
    --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
    --font-size-sm: 0.875rem;
    --font-size-base: 1rem;
    --font-size-lg: 1.125rem;
  }

  .dark {
    /* 背景 */
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;

    /* 卡片 */
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;

    /* 弹出层 */
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;

    /* 主色 */
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;

    /* 次要色 */
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;

    /* 静音色 */
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;

    /* 强调色 */
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;

    /* 危险色 */
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;

    /* 边框 */
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 224.3 76.3% 48%;
  }
}

@layer base {
  * {
    border-color: hsl(var(--border));
  }
  body {
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: var(--font-sans);
    font-size: var(--font-size-base);
  }
  code, pre, .font-mono {
    font-family: var(--font-mono);
  }
}
```

- [x] 修改 `index.html`,在 `<html>` 标签上加 `class="dark"`(MVP 仅暗色,见 `15-ui-design-system.md` §3.3):

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Qraft</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/styles/globals.test.ts
```

预期:3 个测试全部通过。

### Step 5: 提交

- [x] 提交:

```bash
git add tailwind.config.ts src/styles/globals.css index.html
git commit -m "feat(ui): configure tailwind design tokens and dark theme per PRD 15"
```

---

## Task 3: cn 工具函数 + shadcn 基础组件

**目标:** 创建 `cn` 工具,通过 shadcn CLI 安装 MVP 所需的全部基础组件。

### Step 1: 写验证测试

- [x] 创建 `src/lib/utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn utility', () => {
  it('merges plain class strings', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('dedupes conflicting tailwind classes via tailwind-merge', () => {
    // tailwind-merge 应保留后者
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('handles conditional and falsy inputs via clsx', () => {
    expect(cn('base', false && 'hidden', { 'text-red': true }, undefined))
      .toBe('base text-red');
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/lib/utils.test.ts
```

预期:`Cannot find module '@/lib/utils'`,3 个测试失败。

### Step 3: 写实现

- [x] 创建 `src/lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 class 名称,先用 clsx 处理条件与数组,再用 tailwind-merge
 * 消解冲突的 Tailwind class(如 px-2 与 px-4 仅保留 px-4)。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [x] 创建 `components.json`(shadcn 配置文件,供 CLI 识别路径别名):

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/styles/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [x] 通过 shadcn CLI 安装基础组件:

```bash
pnpm dlx shadcn@latest add button input textarea label dialog dropdown-menu select switch tabs tooltip scroll-area separator card badge progress sonner command popover
```

预期:每个组件在 `src/components/ui/<name>.tsx` 生成,内部使用 `cn` 与 Tailwind 变量。

### Step 4: 验证组件可渲染

- [x] 创建临时验证页面 `src/ScaffoldProbe.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ScaffoldProbe() {
  return (
    <div className="p-4 flex flex-col gap-2">
      <Button>Probe Button</Button>
      <Input placeholder="Probe Input" />
    </div>
  );
}
```

- [x] 创建 `src/ScaffoldProbe.test.tsx` 验证渲染:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScaffoldProbe } from './ScaffoldProbe';

describe('ScaffoldProbe', () => {
  it('renders button with probe label', () => {
    render(<ScaffoldProbe />);
    expect(screen.getByRole('button', { name: /probe button/i }))
      .toBeInTheDocument();
  });

  it('renders input with placeholder', () => {
    render(<ScaffoldProbe />);
    expect(screen.getByPlaceholderText(/probe input/i))
      .toBeInTheDocument();
  });

  it('applies font-sans to body via globals', () => {
    render(<ScaffoldProbe />);
    // jsdom 不应用 CSS,只断言元素存在即可,视觉验证留给手动 dev
    expect(screen.getByText(/probe button/i)).toBeInTheDocument();
  });
});
```

- [x] 运行:

```bash
pnpm test -- src/lib/utils.test.ts src/ScaffoldProbe.test.ts
```

预期:全部测试通过。

### Step 5: 提交

- [x] 删除临时探针文件:

```bash
rm src/ScaffoldProbe.tsx src/ScaffoldProbe.test.tsx
```

- [x] 提交:

```bash
git add src/lib/utils.ts src/lib/utils.test.ts components.json src/components/ui
git commit -m "feat(ui): add cn util and shadcn base components"
```

---

## Task 4: TypeScript 类型定义(镜像 Rust)

**目标:** 在 `src/types/` 镜像 Rust 侧数据结构,作为前后端契约的前端单一来源。

### Step 1: 写类型检查测试

- [x] 创建 `src/types/types.test.ts`:

```typescript
import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  ToolMetadata,
  ToolCategory,
  ToolInput,
  ToolOutput,
  ToolError,
  StreamEvent,
  ToolContext,
} from './tool';
import type {
  UserConfig,
  GeneralConfig,
  ThemeConfig,
  ThemeMode,
  ShortcutBinding,
} from './config';
import type { HistoryEntry } from './history';
import type { CommandResponse, ErrorInfo } from './ipc';

describe('tool types', () => {
  it('ToolInput allows text-only payload', () => {
    const input: ToolInput = { text: 'hello' };
    expectTypeOf(input).toMatchTypeOf<ToolInput>();
    expect(input.text).toBe('hello');
  });

  it('ToolOutput alerts are optional', () => {
    const out: ToolOutput = { text: 'result' };
    expectTypeOf(out).toMatchTypeOf<ToolOutput>();
    expect(out.alerts).toBeUndefined();
  });

  it('ToolCategory includes formatter/encoder', () => {
    const c: ToolCategory = 'formatter';
    expect(['formatter', 'encoder', 'hash', 'generator', 'parser', 'converter'])
      .toContain(c);
  });
});

describe('config types', () => {
  it('ThemeMode has dark/light/system', () => {
    const m: ThemeMode = 'dark';
    expect(m).toBe('dark');
  });

  it('ShortcutBinding has all 10 keys', () => {
    const s: ShortcutBinding = {
      open_command_palette: 'Ctrl+K',
      toggle_sidebar: 'Ctrl+B',
      execute_tool: 'Ctrl+Enter',
      clear_input: 'Ctrl+L',
      copy_output: 'Ctrl+Shift+C',
      toggle_settings: 'Ctrl+,',
      switch_tool: 'Ctrl+P',
      open_history: 'Ctrl+H',
      search: 'Ctrl+F',
      close_panel: 'Esc',
    };
    expect(Object.keys(s)).toHaveLength(10);
  });
});

describe('ipc types', () => {
  it('CommandResponse success carries data', () => {
    const r: CommandResponse<string> = { success: true, data: 'ok' };
    expect(r.data).toBe('ok');
  });

  it('CommandResponse failure carries error', () => {
    const r: CommandResponse<string> = {
      success: false,
      error: { code: 'ERR_PARSE_FAILED', message: 'bad' },
    };
    expect(r.error?.code).toBe('ERR_PARSE_FAILED');
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/types/types.test.ts
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/types/tool.ts`(镜像 `08-data-model.md` §3.1 与 `05-rust-core-engine.md` 的 ToolMetadata):

```typescript
/** 工具分类,与 Rust 侧 ToolCategory enum 对齐 */
export type ToolCategory =
  | 'formatter'
  | 'encoder'
  | 'hash'
  | 'generator'
  | 'parser'
  | 'converter';

/** 工具元数据,UI 只读视角 */
export interface ToolMetadata {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  /** lucide-react 图标名 */
  icon: string;
  version: string;
  keywords: string[];
  /** 输入参数 JSON Schema,用于动态渲染表单 */
  inputSchema?: unknown;
  /** 是否支持流式执行 */
  streaming?: boolean;
  deprecated?: boolean;
}

/** 工具输入,镜像 Rust ToolInput */
export interface ToolInput {
  text?: string;
  filePath?: string;
  params?: Record<string, unknown>;
}

/** 工具输出元信息 */
export interface OutputMeta {
  durationMs: number;
  inputBytes: number;
  outputBytes: number;
}

/** 警告级别,镜像 AlertLevel */
export type AlertLevel = 'info' | 'warning' | 'error';

export interface Alert {
  level: AlertLevel;
  message: string;
}

/** 工具输出,镜像 Rust ToolOutput */
export interface ToolOutput {
  text: string;
  extra?: unknown;
  meta?: OutputMeta;
  alerts?: Alert[];
}

/** 工具错误,镜像 ToolError */
export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
}

/** 流式事件类型 */
export type StreamEvent =
  | { type: 'progress'; taskId: string; processed: number; total: number }
  | { type: 'chunk'; taskId: string; text: string }
  | { type: 'completed'; taskId: string; output: ToolOutput }
  | { type: 'failed'; taskId: string; error: ToolError };

/** 工具运行时上下文(UI 视角,仅暴露给 UI 需要的字段) */
export interface ToolContext {
  toolId: string;
  /** 是否已取消 */
  cancelled: boolean;
}
```

- [x] 创建 `src/types/config.ts`(镜像 `08-data-model.md` §3.2):

```typescript
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeConfig {
  mode: ThemeMode;
  accentColor: string;
}

export interface GeneralConfig {
  language: string;
  fontSize: number;
  maxHistory: number;
  confirmOnClear: boolean;
}

/** 快捷键绑定,与 15-ui-design-system.md §3.6 一一对应 */
export interface ShortcutBinding {
  open_command_palette: string;
  toggle_sidebar: string;
  execute_tool: string;
  clear_input: string;
  copy_output: string;
  toggle_settings: string;
  switch_tool: string;
  open_history: string;
  search: string;
  close_panel: string;
}

export interface ToolPref {
  layout?: 'split' | 'stack' | 'full-input' | 'full-output';
  values?: Record<string, unknown>;
}

export interface Favorite {
  toolId: string;
  group?: string;
  sortOrder: number;
}

export interface UserConfig {
  version: number;
  general: GeneralConfig;
  theme: ThemeConfig;
  shortcuts: ShortcutBinding;
  toolPrefs: Record<string, ToolPref>;
  favorites: Favorite[];
}

/** 快捷键默认值 */
export const DEFAULT_SHORTCUTS: ShortcutBinding = {
  open_command_palette: 'Ctrl+K',
  toggle_sidebar: 'Ctrl+B',
  execute_tool: 'Ctrl+Enter',
  clear_input: 'Ctrl+L',
  copy_output: 'Ctrl+Shift+C',
  toggle_settings: 'Ctrl+,',
  switch_tool: 'Ctrl+P',
  open_history: 'Ctrl+H',
  search: 'Ctrl+F',
  close_panel: 'Esc',
};

export const DEFAULT_USER_CONFIG: UserConfig = {
  version: 1,
  general: {
    language: 'en',
    fontSize: 14,
    maxHistory: 100,
    confirmOnClear: true,
  },
  theme: {
    mode: 'dark',
    accentColor: '#3b82f6',
  },
  shortcuts: DEFAULT_SHORTCUTS,
  toolPrefs: {},
  favorites: [],
};
```

- [x] 创建 `src/types/history.ts`(镜像 `08-data-model.md` §3.3):

```typescript
export interface InputSummary {
  textPreview: string;
  textBytes: number;
  params: unknown;
  redacted: boolean;
}

export interface OutputSummary {
  textPreview: string;
  textBytes: number;
  redacted: boolean;
}

export interface HistoryEntry {
  id: string;
  toolId: string;
  timestamp: string; // ISO 8601
  inputSummary: InputSummary;
  outputSummary: OutputSummary;
  success: boolean;
  error?: string;
  durationMs: number;
}
```

- [x] 创建 `src/types/ipc.ts`(镜像 `09-interface-design.md` §3.2):

```typescript
/** 错误信息,镜像 Rust CommandError */
export interface ErrorInfo {
  code: string;
  message: string;
  details?: unknown;
}

/** 响应元信息 */
export interface ResponseMeta {
  durationMs: number;
  version: string;
}

/** 统一响应包络,镜像 Rust CommandResponse<T> */
export interface CommandResponse<T> {
  success: boolean;
  data?: T;
  error?: ErrorInfo;
  meta?: ResponseMeta;
}

/** 事件 payload 类型 */
export interface ConfigChangedPayload {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ToolProgressPayload {
  taskId: string;
  processed: number;
  total: number;
}

export interface ToolChunkPayload {
  taskId: string;
  text: string;
}

export interface ToolCompletedPayload {
  taskId: string;
  output: import('./tool').ToolOutput;
}

export interface ToolFailedPayload {
  taskId: string;
  error: import('./tool').ToolError;
}
```

- [x] 创建 `src/types/index.ts` 统一 re-export:

```typescript
export * from './tool';
export * from './config';
export * from './history';
export * from './ipc';
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/types/types.test.ts
pnpm typecheck
```

预期:测试全部通过,`tsc --noEmit` 无错误。

### Step 5: 提交

- [x] 提交:

```bash
git add src/types
git commit -m "feat(ui): add TS types mirroring Rust data model and IPC contract"
```

---

## Task 5: lib/ipc.ts — Tauri invoke 封装

**目标:** 封装 Tauri `invoke`/`listen`,统一处理 `CommandResponse` 解包与错误转换。

### Step 1: 写失败测试

- [x] 创建 `src/lib/ipc.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  safeInvoke,
  unwrapResponse,
  listen,
  AppError,
} from './ipc';
import type { CommandResponse } from '@/types/ipc';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
});

describe('unwrapResponse', () => {
  it('returns ok with data when success is true', () => {
    const resp: CommandResponse<string> = { success: true, data: 'hello' };
    const r = unwrapResponse(resp);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('hello');
  });

  it('returns error when success is false', () => {
    const resp: CommandResponse<string> = {
      success: false,
      error: { code: 'ERR_PARSE_FAILED', message: 'bad' },
    };
    const r = unwrapResponse(resp);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ERR_PARSE_FAILED');
  });

  it('returns ERR_INTERNAL when success true but data missing', () => {
    const resp: CommandResponse<string> = { success: true };
    const r = unwrapResponse(resp);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ERR_INTERNAL');
  });
});

describe('safeInvoke', () => {
  it('returns value when invoke resolves with success response', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: 42 });
    const r = await safeInvoke<number>('config_get', { key: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
    expect(invokeMock).toHaveBeenCalledWith('config_get', { key: 'x' });
  });

  it('returns error when response.success is false', async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_TOOL_NOT_FOUND', message: 'no such tool' },
    });
    const r = await safeInvoke<unknown>('tool_metadata', { toolId: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe('no such tool');
  });

  it('returns ERR_INTERNAL when invoke throws', async () => {
    invokeMock.mockRejectedValueOnce(new Error('network down'));
    const r = await safeInvoke<unknown>('tool_list');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ERR_INTERNAL');
      expect(r.error.message).toContain('network down');
    }
  });
});

describe('AppError', () => {
  it('is instance of Error with code', () => {
    const e = new AppError('ERR_X', 'msg');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('ERR_X');
    expect(e.message).toBe('msg');
    expect(e.name).toBe('AppError');
  });
});

describe('listen', () => {
  it('delegates to @tauri-apps/api/event listen', async () => {
    const { listen: apiListen } = await import('@tauri-apps/api/event');
    const spy = apiListen as unknown as ReturnType<typeof vi.fn>;
    spy.mockResolvedValueOnce(() => {});
    const handler = () => {};
    await listen('config_changed', handler);
    expect(spy).toHaveBeenCalledWith('config_changed', handler);
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/lib/ipc.test.ts
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/lib/ipc.ts`:

```typescript
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CommandResponse, ErrorInfo } from '@/types/ipc';

/** Result 类型,用 ok 字段区分成功/失败以避免 throw */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** 应用错误,继承 Error 便于在需要时 throw;字段与 ErrorInfo 一致 */
export class AppError extends Error implements ErrorInfo {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

/** 内部默认错误,用于响应包络异常时 */
const INTERNAL_ERROR: ErrorInfo = {
  code: 'ERR_INTERNAL',
  message: 'Unexpected IPC response',
};

/**
 * 解包 CommandResponse,失败返回 ErrorInfo。
 * 当 success=true 但 data 缺失时视为 ERR_INTERNAL。
 */
export function unwrapResponse<T>(
  resp: CommandResponse<T>
): Result<T, ErrorInfo> {
  if (resp.success && resp.data !== undefined) {
    return { ok: true, value: resp.data };
  }
  return { ok: false, error: resp.error ?? INTERNAL_ERROR };
}

/** 原始 invoke 透传,不做解包,供特殊场景使用 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

/**
 * 安全 invoke,自动解包 CommandResponse。
 * 任何异常(包括 IPC 抛错、响应缺失 error 字段)统一转 ErrorInfo。
 */
export async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<Result<T, ErrorInfo>> {
  try {
    const resp = await tauriInvoke<CommandResponse<T>>(cmd, args);
    return unwrapResponse(resp);
  } catch (e) {
    return {
      ok: false,
      error: {
        code: 'ERR_INTERNAL',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

/** listen 透传,统一类型签名 */
export async function listen<T>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  return tauriListen<T>(event, (e) => handler(e.payload));
}
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/lib/ipc.test.ts
```

预期:全部测试通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/lib/ipc.ts src/lib/ipc.test.ts
git commit -m "feat(ui): add safeInvoke and unwrapResponse for CommandResponse"
```

---

## Task 6: store/configStore.ts — 配置状态

**目标:** 用 Zustand 管理用户配置,封装 `config_get_all`/`config_set`/`config_reset`,订阅 `config_changed` 事件。

### Step 1: 写失败测试

- [x] 创建 `src/store/configStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useConfigStore } from './configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';
import type { CommandResponse, ConfigChangedPayload } from '@/types/ipc';
import type { UserConfig } from '@/types/config';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  // 重置 store 至初始状态
  useConfigStore.setState({
    config: null,
    loading: false,
    error: null,
  });
});

describe('configStore.loadConfig', () => {
  it('sets config from config_get_all success response', async () => {
    const cfg: UserConfig = { ...DEFAULT_USER_CONFIG, version: 7 };
    invokeMock.mockResolvedValueOnce({
      success: true,
      data: cfg,
    } satisfies CommandResponse<UserConfig>);

    await useConfigStore.getState().loadConfig();

    expect(useConfigStore.getState().config?.version).toBe(7);
    expect(useConfigStore.getState().loading).toBe(false);
    expect(useConfigStore.getState().error).toBeNull();
  });

  it('sets error message when response.success is false', async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_CONFIG_IO', message: 'disk full' },
    } satisfies CommandResponse<UserConfig>);

    await useConfigStore.getState().loadConfig();

    expect(useConfigStore.getState().config).toBeNull();
    expect(useConfigStore.getState().error).toBe('disk full');
  });

  it('sets error when invoke throws', async () => {
    invokeMock.mockRejectedValueOnce(new Error('tauri down'));
    await useConfigStore.getState().loadConfig();
    expect(useConfigStore.getState().error).toContain('tauri down');
  });
});

describe('configStore.setConfig', () => {
  it('calls config_set with key and value', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: true });
    await useConfigStore.getState().setConfig('theme.mode', 'dark');
    expect(invokeMock).toHaveBeenCalledWith('config_set', {
      key: 'theme.mode',
      value: 'dark',
    });
  });

  it('optimistically updates nested config when loaded', async () => {
    useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG } });
    invokeMock.mockResolvedValueOnce({ success: true, data: true });
    await useConfigStore.getState().setConfig('general.fontSize', 18);
    expect(useConfigStore.getState().config?.general.fontSize).toBe(18);
  });

  it('returns error info on failure without throwing', async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_CONFIG_IO', message: 'read only' },
    });
    const r = await useConfigStore.getState().setConfig('x', 1);
    expect(r.ok).toBe(false);
  });
});

describe('configStore.applyConfigChanged', () => {
  it('updates nested key via dot path', () => {
    useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG } });
    const p: ConfigChangedPayload = {
      key: 'theme.mode',
      oldValue: 'dark',
      newValue: 'light',
    };
    useConfigStore.getState().applyConfigChanged(p);
    expect(useConfigStore.getState().config?.theme.mode).toBe('light');
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/store/configStore.test.ts
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/store/configStore.ts`:

```typescript
import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import type { UserConfig } from '@/types/config';
import type { ConfigChangedPayload, ErrorInfo } from '@/types/ipc';

interface ConfigState {
  config: UserConfig | null;
  loading: boolean;
  error: string | null;

  loadConfig: () => Promise<void>;
  setConfig: (key: string, value: unknown) => Promise<{ ok: true } | { ok: false; error: ErrorInfo }>;
  resetConfig: (key: string) => Promise<{ ok: true } | { ok: false; error: ErrorInfo }>;
  applyConfigChanged: (payload: ConfigChangedPayload) => void;
}

/**
 * 通过点分路径设置嵌套字段,例如 "theme.mode" → config.theme.mode = value
 * 仅支持对象层级,不支持数组索引。
 */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const next = cursor[k];
    cursor[k] = { ...(next as object) };
    cursor = cursor[k] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  loading: false,
  error: null,

  loadConfig: async () => {
    set({ loading: true, error: null });
    const r = await safeInvoke<UserConfig>('config_get_all');
    if (r.ok) {
      set({ config: r.value, loading: false });
    } else {
      set({ loading: false, error: r.error.message });
    }
  },

  setConfig: async (key, value) => {
    // 乐观更新:先改本地,再持久化
    const current = get().config;
    if (current) {
      const next: UserConfig = {
        ...current,
        general: { ...current.general },
        theme: { ...current.theme },
        shortcuts: { ...current.shortcuts },
        toolPrefs: { ...current.toolPrefs },
        favorites: [...current.favorites],
      };
      setByPath(next as unknown as Record<string, unknown>, key, value);
      set({ config: next });
    }
    const r = await safeInvoke<boolean>('config_set', { key, value });
    return r;
  },

  resetConfig: async (key) => {
    const r = await safeInvoke<boolean>('config_reset', { key });
    if (r.ok) {
      // 重置后重新拉取全量配置,避免本地与默认值不一致
      await get().loadConfig();
    }
    return r;
  },

  applyConfigChanged: (payload) => {
    const current = get().config;
    if (!current) return;
    const next: UserConfig = {
      ...current,
      general: { ...current.general },
      theme: { ...current.theme },
      shortcuts: { ...current.shortcuts },
      toolPrefs: { ...current.toolPrefs },
      favorites: [...current.favorites],
    };
    setByPath(next as unknown as Record<string, unknown>, payload.key, payload.newValue);
    set({ config: next });
  },
}));
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/store/configStore.test.ts
```

预期:全部测试通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/store/configStore.ts src/store/configStore.test.ts
git commit -m "feat(ui): add configStore with optimistic update and config_changed subscription"
```

---

## Task 7: store/historyStore.ts — 历史状态

**目标:** 管理历史记录列表,封装 `history_list`/`history_clear`,订阅 `history_added` 事件追加。

### Step 1: 写失败测试

- [x] 创建 `src/store/historyStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useHistoryStore } from './historyStore';
import type { HistoryEntry } from '@/types/history';
import type { CommandResponse } from '@/types/ipc';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const sampleEntry: HistoryEntry = {
  id: 'h1',
  toolId: 'json_formatter',
  timestamp: '2026-07-25T08:00:00Z',
  inputSummary: { textPreview: '{}', textBytes: 2, params: {}, redacted: false },
  outputSummary: { textPreview: '{}', textBytes: 2, redacted: false },
  success: true,
  durationMs: 5,
};

beforeEach(() => {
  invokeMock.mockReset();
  useHistoryStore.setState({ entries: [], loading: false, error: null });
});

describe('historyStore.loadHistory', () => {
  it('loads entries with default limit 100', async () => {
    invokeMock.mockResolvedValueOnce({
      success: true,
      data: [sampleEntry],
    } satisfies CommandResponse<HistoryEntry[]>);
    await useHistoryStore.getState().loadHistory();
    expect(invokeMock).toHaveBeenCalledWith('history_list', { limit: 100 });
    expect(useHistoryStore.getState().entries).toHaveLength(1);
  });

  it('respects custom limit argument', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: [] });
    await useHistoryStore.getState().loadHistory(20);
    expect(invokeMock).toHaveBeenCalledWith('history_list', { limit: 20 });
  });

  it('sets error when invoke fails', async () => {
    invokeMock.mockRejectedValueOnce(new Error('boom'));
    await useHistoryStore.getState().loadHistory();
    expect(useHistoryStore.getState().error).toContain('boom');
    expect(useHistoryStore.getState().entries).toEqual([]);
  });
});

describe('historyStore.clearHistory', () => {
  it('calls history_clear and empties entries on success', async () => {
    useHistoryStore.setState({ entries: [sampleEntry] });
    invokeMock.mockResolvedValueOnce({ success: true, data: true });
    await useHistoryStore.getState().clearHistory();
    expect(invokeMock).toHaveBeenCalledWith('history_clear', {});
    expect(useHistoryStore.getState().entries).toEqual([]);
  });

  it('keeps entries on failure and sets error', async () => {
    useHistoryStore.setState({ entries: [sampleEntry] });
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_HISTORY_IO', message: 'locked' },
    });
    await useHistoryStore.getState().clearHistory();
    expect(useHistoryStore.getState().entries).toHaveLength(1);
    expect(useHistoryStore.getState().error).toBe('locked');
  });
});

describe('historyStore.applyHistoryAdded', () => {
  it('prepends new entry and trims to max 200', () => {
    const many: HistoryEntry[] = Array.from({ length: 200 }, (_, i) => ({
      ...sampleEntry,
      id: `old-${i}`,
    }));
    useHistoryStore.setState({ entries: many });
    useHistoryStore.getState().applyHistoryAdded(sampleEntry);
    const s = useHistoryStore.getState();
    expect(s.entries[0].id).toBe('h1');
    expect(s.entries).toHaveLength(200);
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/store/historyStore.test.ts
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/store/historyStore.ts`:

```typescript
import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import type { HistoryEntry } from '@/types/history';

/** 内存中保留的最大条目,超过则丢弃最旧 */
const MAX_IN_MEMORY = 200;

interface HistoryState {
  entries: HistoryEntry[];
  loading: boolean;
  error: string | null;

  loadHistory: (limit?: number) => Promise<void>;
  clearHistory: () => Promise<void>;
  applyHistoryAdded: (entry: HistoryEntry) => void;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],
  loading: false,
  error: null,

  loadHistory: async (limit = 100) => {
    set({ loading: true, error: null });
    const r = await safeInvoke<HistoryEntry[]>('history_list', { limit });
    if (r.ok) {
      set({ entries: r.value, loading: false });
    } else {
      set({ loading: false, error: r.error.message });
    }
  },

  clearHistory: async () => {
    const r = await safeInvoke<boolean>('history_clear', {});
    if (r.ok) {
      set({ entries: [], error: null });
    } else {
      set({ error: r.error.message });
    }
  },

  applyHistoryAdded: (entry) => {
    set((s) => ({
      // 新条目置顶,超出上限丢弃末尾
      entries: [entry, ...s.entries].slice(0, MAX_IN_MEMORY),
    }));
  },
}));
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/store/historyStore.test.ts
```

预期:全部测试通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/store/historyStore.ts src/store/historyStore.test.ts
git commit -m "feat(ui): add historyStore with load/clear and history_added subscription"
```

---

## Task 8: store/toolStateStore.ts — 工具运行时状态

**目标:** 管理工具列表、当前工具、运行状态与流式任务,订阅 `tool_progress`/`tool_chunk`/`tool_completed`/`tool_failed` 事件。

### Step 1: 写失败测试

- [x] 创建 `src/store/toolStateStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useToolStateStore } from './toolStateStore';
import type { ToolMetadata, ToolOutput } from '@/types/tool';
import type { CommandResponse } from '@/types/ipc';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const sampleMeta: ToolMetadata = {
  id: 'json_formatter',
  name: 'JSON Formatter',
  description: 'Format JSON',
  category: 'formatter',
  icon: 'Braces',
  version: '0.1.0',
  keywords: ['json'],
};

beforeEach(() => {
  invokeMock.mockReset();
  useToolStateStore.setState({
    availableTools: [],
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
});

describe('toolStateStore.loadTools', () => {
  it('stores availableTools on success', async () => {
    invokeMock.mockResolvedValueOnce({
      success: true,
      data: [sampleMeta],
    } satisfies CommandResponse<ToolMetadata[]>);
    await useToolStateStore.getState().loadTools();
    expect(useToolStateStore.getState().availableTools).toHaveLength(1);
  });

  it('leaves availableTools empty on failure', async () => {
    invokeMock.mockRejectedValueOnce(new Error('ipc'));
    await useToolStateStore.getState().loadTools();
    expect(useToolStateStore.getState().availableTools).toEqual([]);
  });
});

describe('toolStateStore.selectTool', () => {
  it('sets currentToolId', () => {
    useToolStateStore.getState().selectTool('json_formatter');
    expect(useToolStateStore.getState().currentToolId).toBe('json_formatter');
  });

  it('can clear by passing null', () => {
    useToolStateStore.getState().selectTool('json_formatter');
    useToolStateStore.getState().selectTool(null);
    expect(useToolStateStore.getState().currentToolId).toBeNull();
  });
});

describe('toolStateStore.executeTool', () => {
  it('sets running true then false, stores output', async () => {
    const out: ToolOutput = { text: 'formatted' };
    invokeMock.mockResolvedValueOnce({
      success: true,
      data: out,
    } satisfies CommandResponse<ToolOutput>);

    const promise = useToolStateStore.getState().executeTool({
      toolId: 'json_formatter',
      input: { text: '{}' },
    });

    expect(useToolStateStore.getState().running).toBe(true);
    const r = await promise;
    expect(useToolStateStore.getState().running).toBe(false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('formatted');
  });

  it('returns error info on failure', async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_PARSE_FAILED', message: 'bad json' },
    });
    const r = await useToolStateStore.getState().executeTool({
      toolId: 'json_formatter',
      input: { text: '{' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ERR_PARSE_FAILED');
  });
});

describe('streaming task lifecycle', () => {
  it('applyToolProgress updates task progress', () => {
    useToolStateStore.getState().applyToolProgress({
      taskId: 't1',
      processed: 5,
      total: 10,
    });
    const t = useToolStateStore.getState().streamingTasks.get('t1');
    expect(t?.processed).toBe(5);
    expect(t?.total).toBe(10);
    expect(t?.status).toBe('running');
  });

  it('applyToolChunk appends text and keeps running', () => {
    useToolStateStore.getState().applyToolProgress({
      taskId: 't1',
      processed: 0,
      total: 1,
    });
    useToolStateStore.getState().applyToolChunk({ taskId: 't1', text: 'a' });
    useToolStateStore.getState().applyToolChunk({ taskId: 't1', text: 'b' });
    const t = useToolStateStore.getState().streamingTasks.get('t1');
    expect(t?.chunks).toBe('ab');
  });

  it('applyToolCompleted sets status completed with output', () => {
    useToolStateStore.getState().applyToolProgress({
      taskId: 't1',
      processed: 0,
      total: 1,
    });
    useToolStateStore.getState().applyToolCompleted({
      taskId: 't1',
      output: { text: 'done' },
    });
    const t = useToolStateStore.getState().streamingTasks.get('t1');
    expect(t?.status).toBe('completed');
    expect(t?.output?.text).toBe('done');
  });

  it('applyToolFailed sets status failed with error', () => {
    useToolStateStore.getState().applyToolProgress({
      taskId: 't1',
      processed: 0,
      total: 1,
    });
    useToolStateStore.getState().applyToolFailed({
      taskId: 't1',
      error: { code: 'ERR_INTERNAL', message: 'panic' },
    });
    const t = useToolStateStore.getState().streamingTasks.get('t1');
    expect(t?.status).toBe('failed');
    expect(t?.error?.code).toBe('ERR_INTERNAL');
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/store/toolStateStore.test.ts
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/store/toolStateStore.ts`:

```typescript
import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import type {
  ToolMetadata,
  ToolInput,
  ToolOutput,
  ToolError,
} from '@/types/tool';
import type {
  ToolProgressPayload,
  ToolChunkPayload,
  ToolCompletedPayload,
  ToolFailedPayload,
} from '@/types/ipc';
import type { ErrorInfo } from '@/types/ipc';

/** 流式任务运行时状态 */
export interface StreamingTaskState {
  taskId: string;
  toolId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  processed: number;
  total: number;
  chunks: string;
  output?: ToolOutput;
  error?: ToolError;
}

interface ExecuteArgs {
  toolId: string;
  input: ToolInput;
}

interface ToolState {
  availableTools: ToolMetadata[];
  currentToolId: string | null;
  running: boolean;
  streamingTasks: Map<string, StreamingTaskState>;

  loadTools: () => Promise<void>;
  selectTool: (id: string | null) => void;
  executeTool: (args: ExecuteArgs) => Promise<{ ok: true; value: ToolOutput } | { ok: false; error: ErrorInfo }>;
  executeStream: (toolId: string, filePath: string) => Promise<{ ok: true; value: string } | { ok: false; error: ErrorInfo }>;
  cancelTask: (taskId: string) => Promise<void>;
  applyToolProgress: (p: ToolProgressPayload) => void;
  applyToolChunk: (p: ToolChunkPayload) => void;
  applyToolCompleted: (p: ToolCompletedPayload) => void;
  applyToolFailed: (p: ToolFailedPayload) => void;
}

export const useToolStateStore = create<ToolState>((set, get) => ({
  availableTools: [],
  currentToolId: null,
  running: false,
  streamingTasks: new Map(),

  loadTools: async () => {
    const r = await safeInvoke<ToolMetadata[]>('tool_list');
    if (r.ok) {
      set({ availableTools: r.value });
    }
    // 失败时不抛,UI 依赖 availableTools 长度即可判断
  },

  selectTool: (id) => set({ currentToolId: id }),

  executeTool: async ({ toolId, input }) => {
    set({ running: true });
    const r = await safeInvoke<ToolOutput>('tool_execute', { toolId, input });
    set({ running: false });
    return r;
  },

  executeStream: async (toolId, filePath) => {
    // 启动流式执行,Rust 返回任务 ID;后续通过事件接收进度与 chunk
    const r = await safeInvoke<string>('tool_execute_stream', { toolId, filePath });
    if (r.ok) {
      const task: StreamingTaskState = {
        taskId: r.value,
        toolId,
        status: 'running',
        processed: 0,
        total: 0,
        chunks: '',
      };
      set((s) => {
        const next = new Map(s.streamingTasks);
        next.set(r.value, task);
        return { streamingTasks: next };
      });
    }
    return r;
  },

  cancelTask: async (taskId) => {
    await safeInvoke<boolean>('tool_cancel', { taskId });
    set((s) => {
      const next = new Map(s.streamingTasks);
      const t = next.get(taskId);
      if (t) next.set(taskId, { ...t, status: 'cancelled' });
      return { streamingTasks: next };
    });
  },

  applyToolProgress: (p) => {
    set((s) => {
      const next = new Map(s.streamingTasks);
      const existing = next.get(p.taskId);
      if (existing) {
        next.set(p.taskId, {
          ...existing,
          processed: p.processed,
          total: p.total,
          status: 'running',
        });
      } else {
        // 进度事件先于 createStream 返回到达,创建占位
        next.set(p.taskId, {
          taskId: p.taskId,
          toolId: '',
          status: 'running',
          processed: p.processed,
          total: p.total,
          chunks: '',
        });
      }
      return { streamingTasks: next };
    });
  },

  applyToolChunk: (p) => {
    set((s) => {
      const next = new Map(s.streamingTasks);
      const existing = next.get(p.taskId);
      if (existing) {
        next.set(p.taskId, {
          ...existing,
          chunks: existing.chunks + p.text,
          status: 'running',
        });
      }
      return { streamingTasks: next };
    });
  },

  applyToolCompleted: (p) => {
    set((s) => {
      const next = new Map(s.streamingTasks);
      const existing = next.get(p.taskId);
      if (existing) {
        next.set(p.taskId, { ...existing, status: 'completed', output: p.output });
      }
      return { streamingTasks: next };
    });
  },

  applyToolFailed: (p) => {
    set((s) => {
      const next = new Map(s.streamingTasks);
      const existing = next.get(p.taskId);
      if (existing) {
        next.set(p.taskId, { ...existing, status: 'failed', error: p.error });
      }
      return { streamingTasks: next };
    });
  },
}));
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/store/toolStateStore.test.ts
```

预期:全部测试通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/store/toolStateStore.ts src/store/toolStateStore.test.ts
git commit -m "feat(ui): add toolStateStore with execute/stream and event reducers"
```

---

## Task 9: hooks/useTool.ts — 工具执行 Hook

**目标:** 封装单个工具的执行生命周期:获取 metadata、执行、缓存结果、卸载清理。

### Step 1: 写失败测试

- [x] 创建 `src/hooks/useTool.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useToolStateStore } from '@/store/toolStateStore';
import { useTool } from './useTool';
import type { ToolMetadata } from '@/types/tool';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const meta: ToolMetadata = {
  id: 'base64_codec',
  name: 'Base64 Codec',
  description: 'encode/decode',
  category: 'encoder',
  icon: 'Binary',
  version: '0.1.0',
  keywords: [],
};

beforeEach(() => {
  invokeMock.mockReset();
  useToolStateStore.setState({
    availableTools: [meta],
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useTool', () => {
  it('returns metadata from store by toolId', () => {
    const { result } = renderHook(() => useTool('base64_codec'));
    expect(result.current.metadata?.id).toBe('base64_codec');
  });

  it('execute invokes tool_execute and stores result', async () => {
    invokeMock.mockResolvedValueOnce({
      success: true,
      data: { text: 'ZW5jb2RlZA==' },
    });
    const { result } = renderHook(() => useTool('base64_codec'));
    await act(async () => {
      await result.current.execute({ text: 'encoded' });
    });
    expect(result.current.result?.text).toBe('ZW5jb2RlZA==');
    expect(result.current.isRunning).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('execute sets error when response fails', async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_PARSE_FAILED', message: 'bad input' },
    });
    const { result } = renderHook(() => useTool('base64_codec'));
    await act(async () => {
      await result.current.execute({ text: '???' });
    });
    expect(result.current.error?.code).toBe('ERR_PARSE_FAILED');
    expect(result.current.result).toBeNull();
  });

  it('cancels running task on unmount', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: 'task-1' });
    const { result, unmount } = renderHook(() => useTool('base64_codec'));
    // 启动流式执行但不等待完成
    act(() => {
      void result.current.executeStream('/tmp/a.json');
    });
    unmount();
    // 取消任务应被调用
    const calls = invokeMock.mock.calls.filter((c) => c[0] === 'tool_cancel');
    expect(calls.length).toBeGreaterThan(0);
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/hooks/useTool.test.tsx
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/hooks/useTool.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToolStateStore } from '@/store/toolStateStore';
import type {
  ToolMetadata,
  ToolInput,
  ToolOutput,
  ToolError,
  Alert,
} from '@/types/tool';

export interface UseToolResult {
  metadata: ToolMetadata | null;
  isRunning: boolean;
  result: ToolOutput | null;
  error: ToolError | null;
  alerts: Alert[];
  execute: (input: ToolInput) => Promise<void>;
  executeStream: (filePath: string) => Promise<void>;
  reset: () => void;
}

/**
 * 工具执行 Hook:绑定单个工具的生命周期。
 * 组件卸载时若有未完成流式任务,自动调用 tool_cancel 取消。
 */
export function useTool(toolId: string): UseToolResult {
  const metadata = useToolStateStore((s) =>
    s.availableTools.find((t) => t.id === toolId) ?? null
  );
  const running = useToolStateStore((s) => s.running);
  const executeTool = useToolStateStore((s) => s.executeTool);
  const executeStreamAction = useToolStateStore((s) => s.executeStream);
  const cancelTask = useToolStateStore((s) => s.cancelTask);

  const [result, setResult] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  /** 当前流式任务 ID,卸载时取消 */
  const taskIdRef = useRef<string | null>(null);

  const execute = useCallback(
    async (input: ToolInput) => {
      setError(null);
      setAlerts([]);
      const r = await executeTool({ toolId, input });
      if (r.ok) {
        setResult(r.value);
        setAlerts(r.value.alerts ?? []);
      } else {
        setResult(null);
        setError(r.error);
      }
    },
    [toolId, executeTool]
  );

  const executeStream = useCallback(
    async (filePath: string) => {
      setError(null);
      setAlerts([]);
      const r = await executeStreamAction(toolId, filePath);
      if (r.ok) {
        taskIdRef.current = r.value;
      } else {
        setError(r.error);
      }
    },
    [toolId, executeStreamAction]
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setAlerts([]);
  }, []);

  // 卸载时取消未完成任务,避免 Rust 侧空跑
  useEffect(() => {
    return () => {
      if (taskIdRef.current) {
        void cancelTask(taskIdRef.current);
        taskIdRef.current = null;
      }
    };
  }, [cancelTask]);

  return {
    metadata,
    isRunning: running,
    result,
    error,
    alerts,
    execute,
    executeStream,
    reset,
  };
}
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/hooks/useTool.test.tsx
```

预期:全部测试通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/hooks/useTool.ts src/hooks/useTool.test.tsx
git commit -m "feat(ui): add useTool hook with execute/stream and unmount cleanup"
```

---

## Task 10: hooks/useClipboard.ts — 剪贴板 Hook

**目标:** 封装 `clipboard_read_text`/`clipboard_write_text`,供工具面板"从剪贴板填充"与"复制输出"使用。

### Step 1: 写失败测试

- [x] 创建 `src/hooks/useClipboard.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useClipboard } from './useClipboard';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
});

describe('useClipboard', () => {
  it('read returns text on success', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: 'clip-text' });
    const { result } = renderHook(() => useClipboard());
    let value = '';
    await act(async () => {
      value = await result.current.read();
    });
    expect(value).toBe('clip-text');
    expect(invokeMock).toHaveBeenCalledWith('clipboard_read_text', {});
  });

  it('read returns empty string on failure', async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_CLIPBOARD_UNAVAILABLE', message: 'no clipboard' },
    });
    const { result } = renderHook(() => useClipboard());
    let value = 'sentinel';
    await act(async () => {
      value = await result.current.read();
    });
    expect(value).toBe('');
  });

  it('write calls clipboard_write_text with text', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: true });
    const { result } = renderHook(() => useClipboard());
    let ok = false;
    await act(async () => {
      ok = await result.current.write('hello');
    });
    expect(ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('clipboard_write_text', {
      text: 'hello',
    });
  });

  it('canRead flag defaults to true', () => {
    const { result } = renderHook(() => useClipboard());
    expect(result.current.canRead).toBe(true);
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/hooks/useClipboard.test.ts
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/hooks/useClipboard.ts`:

```typescript
import { useCallback, useState } from 'react';
import { safeInvoke } from '@/lib/ipc';

export interface UseClipboardResult {
  canRead: boolean;
  read: () => Promise<string>;
  write: (text: string) => Promise<boolean>;
}

/**
 * 剪贴板 Hook,所有读写均通过 Rust 侧命令,不在 JS 直接访问 navigator.clipboard,
 * 以便统一权限与跨平台行为(见 13-security.md)。
 */
export function useClipboard(): UseClipboardResult {
  // MVP 默认可读;若 Rust 报 ERR_CLIPBOARD_UNAVAILABLE,UI 可降级
  const [canRead] = useState(true);

  const read = useCallback(async () => {
    const r = await safeInvoke<string>('clipboard_read_text', {});
    return r.ok ? r.value : '';
  }, []);

  const write = useCallback(async (text: string) => {
    const r = await safeInvoke<boolean>('clipboard_write_text', { text });
    return r.ok ? r.value : false;
  }, []);

  return { canRead, read, write };
}
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/hooks/useClipboard.test.ts
```

预期:全部测试通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/hooks/useClipboard.ts src/hooks/useClipboard.test.ts
git commit -m "feat(ui): add useClipboard hook wrapping clipboard_read/write_text"
```

---

## Task 11: components/ErrorBoundary.tsx

**目标:** React 类组件错误边界,捕获渲染错误,显示友好界面 + 复制错误按钮 + Sonner toast。

### Step 1: 写失败测试

- [x] 创建 `src/components/ErrorBoundary.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
  Toaster: () => null,
}));

const toastSpy = toast.error as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  toastSpy.mockReset();
});

function Boom({ should }: { should: boolean }) {
  if (should) throw new Error('boom!');
  return <div data-testid="ok">ok</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <Boom should={false} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('ok')).toBeInTheDocument();
  });

  it('renders fallback UI when child throws', () => {
    // 抑制 React 的 console.error 噪音
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom should={true} />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/boom!/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('shows toast.error on error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom should={true} />
      </ErrorBoundary>
    );
    expect(toastSpy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('copy error button writes to clipboard', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    // 模拟 navigator.clipboard
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    render(
      <ErrorBoundary>
        <Boom should={true} />
      </ErrorBoundary>
    );
    await user.click(screen.getByRole('button', { name: /copy error/i }));
    expect(writeText).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/components/ErrorBoundary.test.tsx
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/components/ErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  /** 自定义 fallback,默认使用内置 UI */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * React 错误边界:捕获子树渲染错误,展示友好界面并 toast 通知。
 * 注意:错误边界不捕获事件回调与异步错误,那些场景需手动 try/catch + toast。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 同时通过 toast 全局提示,确保用户可见
    toast.error(`渲染错误: ${error.message}`);
    // 控制台保留完整堆栈便于调试
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  handleCopy = async (): Promise<void> => {
    const err = this.state.error;
    if (!err) return;
    const text = `${err.name}: ${err.message}\n${err.stack ?? ''}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('错误已复制到剪贴板');
    } catch {
      toast.error('复制失败');
    }
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }
    return (
      <div
        role="alert"
        className="flex flex-col gap-4 p-6 m-4 rounded-lg border border-destructive/50 bg-destructive/10 text-foreground"
      >
        <h2 className="text-lg font-semibold">渲染出错</h2>
        <p className="text-sm text-muted-foreground">
          {error.message}
        </p>
        <pre className="text-xs font-mono bg-muted p-2 rounded overflow-auto max-h-48">
          {error.stack ?? ''}
        </pre>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={this.reset}>
            重试
          </Button>
          <Button variant="outline" size="sm" onClick={this.handleCopy}>
            复制错误
          </Button>
        </div>
      </div>
    );
  }
}
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/components/ErrorBoundary.test.tsx
```

预期:全部测试通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/components/ErrorBoundary.tsx src/components/ErrorBoundary.test.tsx
git commit -m "feat(ui): add ErrorBoundary with toast and copy-error button"
```

---

## Task 12: components/SideNav.tsx — 侧边导航

**目标:** 按 `ToolCategory` 分组显示工具,当前工具高亮,支持键盘上下导航与 a11y。

### Step 1: 写失败测试

- [x] 创建 `src/components/SideNav.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SideNav } from './SideNav';
import { useToolStateStore } from '@/store/toolStateStore';
import type { ToolMetadata } from '@/types/tool';

const tools: ToolMetadata[] = [
  {
    id: 'json_formatter',
    name: 'JSON Formatter',
    description: '',
    category: 'formatter',
    icon: 'Braces',
    version: '0.1.0',
    keywords: [],
  },
  {
    id: 'base64_codec',
    name: 'Base64 Codec',
    description: '',
    category: 'encoder',
    icon: 'Binary',
    version: '0.1.0',
    keywords: [],
  },
  {
    id: 'hash_calculator',
    name: 'Hash Calculator',
    description: '',
    category: 'hash',
    icon: 'Hash',
    version: '0.1.0',
    keywords: [],
  },
];

beforeEach(() => {
  useToolStateStore.setState({
    availableTools: tools,
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
});

describe('SideNav', () => {
  it('renders groups by category with headings', () => {
    render(<SideNav />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /formatter/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /encoder/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /hash/i })).toBeInTheDocument();
  });

  it('clicking a tool calls selectTool', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(useToolStateStore.getState(), 'selectTool');
    render(<SideNav />);
    await user.click(screen.getByRole('button', { name: /json formatter/i }));
    expect(spy).toHaveBeenCalledWith('json_formatter');
  });

  it('highlights current tool via aria-current', () => {
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<SideNav />);
    const btn = screen.getByRole('button', { name: /base64 codec/i });
    expect(btn).toHaveAttribute('aria-current', 'true');
  });

  it('ArrowDown moves focus to next tool', async () => {
    const user = userEvent.setup();
    render(<SideNav />);
    const jsonBtn = screen.getByRole('button', { name: /json formatter/i });
    const base64Btn = screen.getByRole('button', { name: /base64 codec/i });
    jsonBtn.focus();
    expect(document.activeElement).toBe(jsonBtn);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(base64Btn);
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/components/SideNav.test.tsx
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/components/SideNav.tsx`:

```tsx
import { useMemo, useRef, type KeyboardEvent } from 'react';
import {
  Braces,
  Binary,
  Hash,
  Wand2,
  FileSearch,
  ArrowLeftRight,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToolStateStore } from '@/store/toolStateStore';
import type { ToolCategory, ToolMetadata } from '@/types/tool';
import { ScrollArea } from '@/components/ui/scroll-area';

/** 分类 → 显示名与图标映射 */
const CATEGORY_META: Record<ToolCategory, { label: string; icon: LucideIcon }> = {
  formatter: { label: 'Formatter', icon: Braces },
  encoder: { label: 'Encoder', icon: Binary },
  hash: { label: 'Hash', icon: Hash },
  generator: { label: 'Generator', icon: Wand2 },
  parser: { label: 'Parser', icon: FileSearch },
  converter: { label: 'Converter', icon: ArrowLeftRight },
};

const CATEGORY_ORDER: ToolCategory[] = [
  'formatter',
  'encoder',
  'hash',
  'generator',
  'parser',
  'converter',
];

export function SideNav(): JSX.Element {
  const tools = useToolStateStore((s) => s.availableTools);
  const currentToolId = useToolStateStore((s) => s.currentToolId);
  const selectTool = useToolStateStore((s) => s.selectTool);
  /** 收集所有工具按钮元素,用于键盘上下导航 */
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const grouped = useMemo(() => {
    const map = new Map<ToolCategory, ToolMetadata[]>();
    for (const t of tools) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return map;
  }, [tools]);

  /** 扁平化所有工具,供键盘导航顺序遍历 */
  const flatTools = useMemo(() => {
    return CATEGORY_ORDER.flatMap((c) => grouped.get(c) ?? []);
  }, [grouped]);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const next = (index + dir + flatTools.length) % flatTools.length;
    buttonRefs.current[next]?.focus();
  };

  let flatIndex = -1;

  return (
    <nav
      aria-label="工具导航"
      className="h-full w-56 border-r border-border bg-card"
    >
      <ScrollArea className="h-full">
        <ul className="flex flex-col gap-4 p-2">
          {CATEGORY_ORDER.map((cat) => {
            const list = grouped.get(cat);
            if (!list || list.length === 0) return null;
            const meta = CATEGORY_META[cat];
            const Icon = meta.icon;
            return (
              <li key={cat}>
                <h3 className="px-2 py-1 text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Icon aria-hidden className="h-3 w-3" />
                  {meta.label}
                </h3>
                <ul className="flex flex-col">
                  {list.map((t) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    const active = t.id === currentToolId;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          ref={(el) => {
                            buttonRefs.current[idx] = el;
                          }}
                          aria-current={active ? 'true' : undefined}
                          onClick={() => selectTool(t.id)}
                          onKeyDown={(e) => handleKeyDown(e, idx)}
                          className={cn(
                            'w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors',
                            'hover:bg-accent hover:text-accent-foreground',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            active && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                          )}
                        >
                          {t.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </nav>
  );
}
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/components/SideNav.test.tsx
```

预期:全部测试通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/components/SideNav.tsx src/components/SideNav.test.tsx
git commit -m "feat(ui): add SideNav grouped by category with keyboard navigation"
```

---

## Task 13: components/CommandPalette.tsx — 命令面板(Ctrl+K)

**目标:** 基于 cmdk + shadcn command 组件,全局 Ctrl+K/Cmd+K 唤起,搜索工具并切换。

### Step 1: 写失败测试

- [x] 创建 `src/components/CommandPalette.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';
import { useToolStateStore } from '@/store/toolStateStore';
import type { ToolMetadata } from '@/types/tool';

const tools: ToolMetadata[] = [
  {
    id: 'json_formatter',
    name: 'JSON Formatter',
    description: 'Format JSON',
    category: 'formatter',
    icon: 'Braces',
    version: '0.1.0',
    keywords: ['json', 'pretty'],
  },
  {
    id: 'json_minifier',
    name: 'JSON Minifier',
    description: 'Minify JSON',
    category: 'formatter',
    icon: 'Braces',
    version: '0.1.0',
    keywords: ['json', 'min'],
  },
];

beforeEach(() => {
  useToolStateStore.setState({
    availableTools: tools,
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
});

describe('CommandPalette', () => {
  it('does not render dialog when closed', () => {
    render(<CommandPalette open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders tool list when open', () => {
    render(<CommandPalette open={true} onOpenChange={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /json formatter/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /json minifier/i })).toBeInTheDocument();
  });

  it('filters tools by search query', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open={true} onOpenChange={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'minifier');
    expect(screen.queryByRole('option', { name: /json formatter/i })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /json minifier/i })).toBeInTheDocument();
  });

  it('selecting a tool calls selectTool and closes palette', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(useToolStateStore.getState(), 'selectTool');
    const onOpenChange = vi.fn();
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('option', { name: /json formatter/i }));
    expect(spy).toHaveBeenCalledWith('json_formatter');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/components/CommandPalette.test.tsx
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/components/CommandPalette.tsx`:

```tsx
import { useEffect } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Settings, Trash2, Search } from 'lucide-react';
import { useToolStateStore } from '@/store/toolStateStore';
import { useHistoryStore } from '@/store/historyStore';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 打开设置面板的回调,由 App 注入 */
  onOpenSettings?: () => void;
  /** 打开历史面板的回调,由 App 注入 */
  onOpenHistory?: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSettings,
  onOpenHistory,
}: CommandPaletteProps): JSX.Element {
  const tools = useToolStateStore((s) => s.availableTools);
  const selectTool = useToolStateStore((s) => s.selectTool);
  const clearHistory = useHistoryStore((s) => s.clearHistory);

  // Esc 关闭由 Dialog 内部 Radix 处理,此处仅作冗余兜底
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const handleSelectTool = (toolId: string) => {
    selectTool(toolId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden max-w-xl">
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <DialogDescription className="sr-only">
          搜索工具或操作,回车执行
        </DialogDescription>
        <Command shouldFilter={true}>
          <CommandInput placeholder="搜索工具或操作..." />
          <CommandList className="max-h-80">
            <CommandEmpty>无匹配项</CommandEmpty>
            <CommandGroup heading="工具">
              {tools.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`${t.name} ${t.keywords.join(' ')}`}
                  onSelect={() => handleSelectTool(t.id)}
                >
                  <Search aria-hidden className="h-4 w-4 opacity-50" />
                  <span>{t.name}</span>
                  {t.description && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t.description}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="操作">
              <CommandItem
                value="settings open settings 打开设置"
                onSelect={() => {
                  onOpenSettings?.();
                  onOpenChange(false);
                }}
              >
                <Settings aria-hidden className="h-4 w-4 opacity-50" />
                <span>打开设置</span>
              </CommandItem>
              <CommandItem
                value="history open history 打开历史"
                onSelect={() => {
                  onOpenHistory?.();
                  onOpenChange(false);
                }}
              >
                <Settings aria-hidden className="h-4 w-4 opacity-50" />
                <span>打开历史</span>
              </CommandItem>
              <CommandItem
                value="clear history 清空历史"
                onSelect={async () => {
                  await clearHistory();
                  onOpenChange(false);
                }}
              >
                <Trash2 aria-hidden className="h-4 w-4 opacity-50" />
                <span>清空历史</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/components/CommandPalette.test.tsx
```

预期:全部测试通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx
git commit -m "feat(ui): add CommandPalette with tool search and quick actions"
```

---

## Task 14: components/ToolPanel.tsx — 工具面板(分栏)

**目标:** 使用 `react-resizable-panels` 双栏布局,顶栏含工具名与操作按钮(复制/清空/交换),底部 alerts,中部预留 ToolInput/ToolOutput slot。

### Step 1: 写失败测试

- [x] 创建 `src/components/ToolPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolPanel } from './ToolPanel';
import { useToolStateStore } from '@/store/toolStateStore';
import type { ToolMetadata } from '@/types/tool';

const meta: ToolMetadata = {
  id: 'base64_codec',
  name: 'Base64 Codec',
  description: 'encode/decode',
  category: 'encoder',
  icon: 'Binary',
  version: '0.1.0',
  keywords: [],
};

beforeEach(() => {
  useToolStateStore.setState({
    availableTools: [meta],
    currentToolId: 'base64_codec',
    running: false,
    streamingTasks: new Map(),
  });
});

describe('ToolPanel', () => {
  it('renders tool name in header', () => {
    render(
      <ToolPanel
        toolId="base64_codec"
        inputSlot={<div data-testid="in" />}
        outputSlot={<div data-testid="out" />}
      />
    );
    expect(screen.getByText(/base64 codec/i)).toBeInTheDocument();
  });

  it('renders input and output slots', () => {
    render(
      <ToolPanel
        toolId="base64_codec"
        inputSlot={<div data-testid="in">input</div>}
        outputSlot={<div data-testid="out">output</div>}
      />
    );
    expect(screen.getByTestId('in')).toBeInTheDocument();
    expect(screen.getByTestId('out')).toBeInTheDocument();
  });

  it('clicking copy button calls onCopyOutput', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(
      <ToolPanel
        toolId="base64_codec"
        inputSlot={<div />}
        outputSlot={<div />}
        onCopyOutput={onCopy}
      />
    );
    await user.click(screen.getByRole('button', { name: /copy output/i }));
    expect(onCopy).toHaveBeenCalled();
  });

  it('renders alerts when provided', () => {
    render(
      <ToolPanel
        toolId="base64_codec"
        inputSlot={<div />}
        outputSlot={<div />}
        alerts={[
          { level: 'warning', message: 'large input' },
          { level: 'error', message: 'parse fail' },
        ]}
      />
    );
    expect(screen.getByText(/large input/i)).toBeInTheDocument();
    expect(screen.getByText(/parse fail/i)).toBeInTheDocument();
  });

  it('renders empty state when toolId not found', () => {
    useToolStateStore.setState({ currentToolId: 'unknown' });
    render(
      <ToolPanel
        toolId="unknown"
        inputSlot={<div />}
        outputSlot={<div />}
      />
    );
    expect(screen.getByText(/tool not found/i)).toBeInTheDocument();
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/components/ToolPanel.test.tsx
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/components/ToolPanel.tsx`:

```tsx
import { type ReactNode, useCallback } from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { Copy, Trash2, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useToolStateStore } from '@/store/toolStateStore';
import type { Alert, AlertLevel } from '@/types/tool';

export interface ToolPanelProps {
  toolId: string;
  inputSlot: ReactNode;
  outputSlot: ReactNode;
  alerts?: Alert[];
  onCopyOutput?: () => void;
  onClearInput?: () => void;
  onSwapInputOutput?: () => void;
}

const ALERT_STYLE: Record<AlertLevel, string> = {
  info: 'bg-blue-500/10 text-blue-500',
  warning: 'bg-yellow-500/10 text-yellow-500',
  error: 'bg-destructive/10 text-destructive',
};

export function ToolPanel({
  toolId,
  inputSlot,
  outputSlot,
  alerts = [],
  onCopyOutput,
  onClearInput,
  onSwapInputOutput,
}: ToolPanelProps): JSX.Element {
  const metadata = useToolStateStore((s) =>
    s.availableTools.find((t) => t.id === toolId) ?? null
  );

  const handleCopy = useCallback(() => {
    onCopyOutput?.();
  }, [onCopyOutput]);

  if (!metadata) {
    return (
      <div
        role="status"
        className="flex items-center justify-center h-full text-muted-foreground"
      >
        Tool not found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部工具栏 */}
      <header className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <h2 className="text-sm font-semibold flex-1">{metadata.name}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="复制输出"
          onClick={handleCopy}
        >
          <Copy className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="清空输入"
          onClick={() => onClearInput?.()}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="交换输入输出"
          onClick={() => onSwapInputOutput?.()}
        >
          <ArrowRightLeft className="h-4 w-4" aria-hidden />
        </Button>
      </header>

      {/* 双栏可调整布局 */}
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={50} minSize={20}>
            <div className="h-full overflow-auto p-2">{inputSlot}</div>
          </Panel>
          <PanelResizeHandle className="w-px bg-border hover:bg-primary/50 transition-colors" />
          <Panel defaultSize={50} minSize={20}>
            <div className="h-full overflow-auto p-2">{outputSlot}</div>
          </Panel>
        </PanelGroup>
      </div>

      {/* 底部 alerts */}
      {alerts.length > 0 && (
        <>
          <Separator />
          <footer
            role="region"
            aria-label="工具警告"
            className="flex flex-col gap-1 p-2 max-h-32 overflow-auto"
          >
            {alerts.map((a, i) => (
              <div
                key={i}
                role="alert"
                className={cn(
                  'text-xs px-2 py-1 rounded font-mono',
                  ALERT_STYLE[a.level]
                )}
              >
                [{a.level}] {a.message}
              </div>
            ))}
          </footer>
        </>
      )}
    </div>
  );
}
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/components/ToolPanel.test.tsx
```

预期:全部测试通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/components/ToolPanel.tsx src/components/ToolPanel.test.tsx
git commit -m "feat(ui): add ToolPanel with resizable split and alerts footer"
```

---

## Task 15: components/HistoryPanel.tsx — 历史记录面板

**目标:** 使用 `@tanstack/react-virtual` 虚拟列表显示历史,点击恢复输入,清空按钮。

### Step 1: 写失败测试

- [x] 创建 `src/components/HistoryPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { HistoryPanel } from './HistoryPanel';
import { useHistoryStore } from '@/store/historyStore';
import type { HistoryEntry } from '@/types/history';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const entry: HistoryEntry = {
  id: 'h1',
  toolId: 'json_formatter',
  timestamp: '2026-07-25T08:00:00Z',
  inputSummary: { textPreview: '{"a":1}', textBytes: 7, params: {}, redacted: false },
  outputSummary: { textPreview: '{\n  "a": 1\n}', textBytes: 12, redacted: false },
  success: true,
  durationMs: 5,
};

beforeEach(() => {
  invokeMock.mockReset();
  useHistoryStore.setState({ entries: [entry], loading: false, error: null });
});

describe('HistoryPanel', () => {
  it('renders history entries with tool id and preview', () => {
    render(<HistoryPanel onSelect={() => {}} />);
    expect(screen.getByText(/json_formatter/i)).toBeInTheDocument();
    expect(screen.getByText(/\{"a":1\}/i)).toBeInTheDocument();
  });

  it('clicking an entry calls onSelect with entry', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<HistoryPanel onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: /json_formatter/i }));
    expect(onSelect).toHaveBeenCalledWith(entry);
  });

  it('clear button calls history_clear via store', async () => {
    const user = userEvent.setup();
    invokeMock.mockResolvedValueOnce({ success: true, data: true });
    render(<HistoryPanel onSelect={() => {}} />);
    await user.click(screen.getByRole('button', { name: /clear history/i }));
    expect(invokeMock).toHaveBeenCalledWith('history_clear', {});
  });

  it('shows empty state when no entries', () => {
    useHistoryStore.setState({ entries: [] });
    render(<HistoryPanel onSelect={() => {}} />);
    expect(screen.getByText(/no history/i)).toBeInTheDocument();
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/components/HistoryPanel.test.tsx
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/components/HistoryPanel.tsx`:

```tsx
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatDistanceToNow } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useHistoryStore } from '@/store/historyStore';
import type { HistoryEntry } from '@/types/history';

export interface HistoryPanelProps {
  onSelect: (entry: HistoryEntry) => void;
}

export function HistoryPanel({ onSelect }: HistoryPanelProps): JSX.Element {
  const entries = useHistoryStore((s) => s.entries);
  const clearHistory = useHistoryStore((s) => s.clearHistory);
  const parentRef = useRef<HTMLDivElement>(null);

  // 虚拟列表:仅渲染可见行,即使有数千条历史也保持流畅
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <h2 className="text-sm font-semibold flex-1">历史记录</h2>
        <Button
          variant="ghost"
          size="sm"
          aria-label="清空历史"
          onClick={() => void clearHistory()}
          disabled={entries.length === 0}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          <span className="ml-1">Clear History</span>
        </Button>
      </header>

      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          No history
        </div>
      ) : (
        <div
          ref={parentRef}
          className="flex-1 overflow-auto"
          aria-label="历史记录列表"
        >
          <ul
            style={{ height: `${virtualizer.getTotalSize()}px` }}
            className="relative"
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const entry = entries[vi.index];
              return (
                <li
                  key={entry.id}
                  className="absolute left-0 w-full"
                  style={{ height: `${vi.size}px`, transform: `translateY(${vi.start}px)` }}
                >
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-accent transition-colors flex flex-col gap-0.5"
                    onClick={() => onSelect(entry)}
                  >
                    <span className="text-sm font-medium">
                      {entry.toolId}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                      </span>
                    </span>
                    <span className="text-xs font-mono text-muted-foreground truncate">
                      {entry.inputSummary.textPreview}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/components/HistoryPanel.test.tsx
```

预期:全部测试通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/components/HistoryPanel.tsx src/components/HistoryPanel.test.tsx
git commit -m "feat(ui): add HistoryPanel with virtual list and clear action"
```

---

## Task 16: components/SettingsPanel.tsx — 设置面板

**目标:** 用 react-hook-form + zod 渲染通用设置(主题、JSON 缩进、历史上限、快捷键),保存调用 `configStore.setConfig`。

### Step 1: 写失败测试

- [x] 创建 `src/components/SettingsPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { SettingsPanel } from './SettingsPanel';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG }, loading: false, error: null });
});

describe('SettingsPanel', () => {
  it('renders form fields from current config', () => {
    render(<SettingsPanel />);
    expect(screen.getByLabelText(/theme mode/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max history/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/open command palette/i)).toBeInTheDocument();
  });

  it('shows validation error when max history is negative', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);
    const input = screen.getByLabelText(/max history/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '-5');
    await screen.findByText(/must be 0 or greater/i);
  });

  it('clicking save calls setConfig with changed values', async () => {
    const user = userEvent.setup();
    invokeMock.mockResolvedValueOnce({ success: true, data: true });
    render(<SettingsPanel />);
    const input = screen.getByLabelText(/max history/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '50');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(invokeMock).toHaveBeenCalledWith('config_set', expect.objectContaining({
      key: 'general.max_history',
      value: 50,
    }));
  });

  it('does not call setConfig when form invalid', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);
    const input = screen.getByLabelText(/max history/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '-1');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/components/SettingsPanel.test.tsx
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/components/SettingsPanel.tsx`:

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useConfigStore } from '@/store/configStore';
import type { ShortcutBinding } from '@/types/config';

const SHORTCUT_KEYS: Array<{ key: keyof ShortcutBinding; label: string }> = [
  { key: 'open_command_palette', label: 'Open Command Palette' },
  { key: 'toggle_sidebar', label: 'Toggle Sidebar' },
  { key: 'execute_tool', label: 'Execute Tool' },
  { key: 'clear_input', label: 'Clear Input' },
  { key: 'copy_output', label: 'Copy Output' },
  { key: 'toggle_settings', label: 'Toggle Settings' },
  { key: 'switch_tool', label: 'Switch Tool' },
  { key: 'open_history', label: 'Open History' },
  { key: 'search', label: 'Search' },
  { key: 'close_panel', label: 'Close Panel' },
];

const schema = z.object({
  themeMode: z.enum(['light', 'dark', 'system']),
  fontSize: z.number().int().min(10).max(24),
  maxHistory: z.number().int().min(0).max(10000),
  jsonIndent: z.number().int().min(0).max(8),
  confirmOnClear: z.boolean(),
  shortcuts: z.object(
    SHORTCUT_KEYS.reduce(
      (acc, s) => ({ ...acc, [s.key]: z.string().min(1) }),
      {} as Record<keyof ShortcutBinding, z.ZodString>
    )
  ),
});

type FormValues = z.infer<typeof schema>;

export function SettingsPanel(): JSX.Element {
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      themeMode: 'dark',
      fontSize: 14,
      maxHistory: 100,
      jsonIndent: 2,
      confirmOnClear: true,
      shortcuts: {
        open_command_palette: 'Ctrl+K',
        toggle_sidebar: 'Ctrl+B',
        execute_tool: 'Ctrl+Enter',
        clear_input: 'Ctrl+L',
        copy_output: 'Ctrl+Shift+C',
        toggle_settings: 'Ctrl+,',
        switch_tool: 'Ctrl+P',
        open_history: 'Ctrl+H',
        search: 'Ctrl+F',
        close_panel: 'Esc',
      },
    },
  });

  // 配置加载后同步表单
  useEffect(() => {
    if (!config) return;
    form.reset({
      themeMode: config.theme.mode,
      fontSize: config.general.fontSize,
      maxHistory: config.general.maxHistory,
      // jsonIndent 来自 toolPrefs.json_formatter.indent,缺省 2
      jsonIndent:
        (config.toolPrefs['json_formatter']?.values?.indent as number | undefined) ?? 2,
      confirmOnClear: config.general.confirmOnClear,
      shortcuts: { ...config.shortcuts },
    });
  }, [config, form]);

  const onSubmit = async (values: FormValues) => {
    // 多次调用 setConfig 持久化每个变更字段
    await setConfig('theme.mode', values.themeMode);
    await setConfig('general.fontSize', values.fontSize);
    await setConfig('general.maxHistory', values.maxHistory);
    await setConfig('general.confirmOnClear', values.confirmOnClear);
    await setConfig('toolPrefs.json_formatter.values.indent', values.jsonIndent);
    for (const k of Object.keys(values.shortcuts) as Array<keyof ShortcutBinding>) {
      await setConfig(`shortcuts.${k}`, values.shortcuts[k]);
    }
    toast.success('设置已保存');
  };

  const errors = form.formState.errors;

  return (
    <div className="h-full overflow-auto bg-background">
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="max-w-xl mx-auto p-6 flex flex-col gap-6"
        aria-label="设置表单"
      >
        <h2 className="text-lg font-semibold">通用设置</h2>

        <div className="flex flex-col gap-2">
          <Label htmlFor="themeMode">Theme Mode</Label>
          <Select
            value={form.watch('themeMode')}
            onValueChange={(v) => form.setValue('themeMode', v as FormValues['themeMode'])}
          >
            <SelectTrigger id="themeMode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark (MVP)</SelectItem>
              <SelectItem value="light">Light (待 v1.0)</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="fontSize">Font Size</Label>
          <Input
            id="fontSize"
            type="number"
            {...form.register('fontSize', { valueAsNumber: true })}
          />
          {errors.fontSize && (
            <span className="text-xs text-destructive">{errors.fontSize.message}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="maxHistory">Max History</Label>
          <Input
            id="maxHistory"
            type="number"
            {...form.register('maxHistory', { valueAsNumber: true })}
          />
          {errors.maxHistory && (
            <span className="text-xs text-destructive">must be 0 or greater</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="jsonIndent">JSON Default Indent</Label>
          <Input
            id="jsonIndent"
            type="number"
            {...form.register('jsonIndent', { valueAsNumber: true })}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="confirmOnClear"
            type="checkbox"
            {...form.register('confirmOnClear')}
          />
          <Label htmlFor="confirmOnClear">Confirm on clear</Label>
        </div>

        <Separator />

        <h3 className="text-sm font-semibold">快捷键</h3>
        <div className="grid grid-cols-2 gap-4">
          {SHORTCUT_KEYS.map((s) => (
            <div key={s.key} className="flex flex-col gap-1">
              <Label htmlFor={`sc-${s.key}`}>{s.label}</Label>
              <Input
                id={`sc-${s.key}`}
                {...form.register(`shortcuts.${s.key}`)}
              />
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button type="submit">Save</Button>
          <Button type="button" variant="outline" onClick={() => form.reset()}>
            Reset
          </Button>
        </div>
      </form>
    </div>
  );
}
```

> 注:`@hookform/resolvers` 需安装。补充:

- [x] 安装 resolver 包:

```bash
pnpm add @hookform/resolvers
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/components/SettingsPanel.test.tsx
```

预期:全部测试通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/components/SettingsPanel.tsx src/components/SettingsPanel.test.tsx package.json pnpm-lock.yaml
git commit -m "feat(ui): add SettingsPanel with react-hook-form + zod validation"
```

---

## Task 17: App.tsx — 应用根组件

**目标:** 三栏布局(SideNav + 主区域 + CommandPalette 浮层),启动加载配置/工具/历史,挂载 ErrorBoundary 与 Toaster。

### Step 1: 写失败测试

- [x] 创建 `src/App.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { App } from './App';
import type { ToolMetadata } from '@/types/tool';
import type { CommandResponse } from '@/types/ipc';
import type { UserConfig } from '@/types/config';
import { DEFAULT_USER_CONFIG } from '@/types/config';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const tools: ToolMetadata[] = [
  {
    id: 'json_formatter',
    name: 'JSON Formatter',
    description: '',
    category: 'formatter',
    icon: 'Braces',
    version: '0.1.0',
    keywords: [],
  },
];

function setupHappyPath() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'config_get_all') {
      return Promise.resolve({
        success: true,
        data: { ...DEFAULT_USER_CONFIG },
      } as CommandResponse<UserConfig>);
    }
    if (cmd === 'tool_list') {
      return Promise.resolve({
        success: true,
        data: tools,
      } as CommandResponse<ToolMetadata[]>);
    }
    if (cmd === 'history_list') {
      return Promise.resolve({ success: true, data: [] });
    }
    return Promise.resolve({ success: true, data: null });
  });
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe('App', () => {
  it('renders SideNav with tool groups after mount', async () => {
    setupHappyPath();
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /json formatter/i }))
      .toBeInTheDocument();
  });

  it('clicking a tool switches main area to ToolPanel', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    await user.click(await screen.findByRole('button', { name: /json formatter/i }));
    // ToolPanel header 显示工具名
    expect(screen.getAllByText(/json formatter/i).length).toBeGreaterThan(0);
  });

  it('Ctrl+K opens CommandPalette', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Control>}{k}{/Control}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/App.test.tsx
```

预期:模块不存在,全部失败。

### Step 3: 写实现

- [x] 创建 `src/App.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { Toaster, toast } from 'sonner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SideNav } from '@/components/SideNav';
import { CommandPalette } from '@/components/CommandPalette';
import { ToolPanel } from '@/components/ToolPanel';
import { HistoryPanel } from '@/components/HistoryPanel';
import { SettingsPanel } from '@/components/SettingsPanel';
import { useConfigStore } from '@/store/configStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { useHistoryStore } from '@/store/historyStore';
import { listen } from '@/lib/ipc';
import type {
  ConfigChangedPayload,
  ToolProgressPayload,
  ToolChunkPayload,
  ToolCompletedPayload,
  ToolFailedPayload,
} from '@/types/ipc';
import type { HistoryEntry } from '@/types/history';

type View = 'tool' | 'history' | 'settings';

export function App(): JSX.Element {
  const [view, setView] = useState<View>('tool');
  const [paletteOpen, setPaletteOpen] = useState(false);

  const loadConfig = useConfigStore((s) => s.loadConfig);
  const applyConfigChanged = useConfigStore((s) => s.applyConfigChanged);
  const loadTools = useToolStateStore((s) => s.loadTools);
  const currentToolId = useToolStateStore((s) => s.currentToolId);
  const applyToolProgress = useToolStateStore((s) => s.applyToolProgress);
  const applyToolChunk = useToolStateStore((s) => s.applyToolChunk);
  const applyToolCompleted = useToolStateStore((s) => s.applyToolCompleted);
  const applyToolFailed = useToolStateStore((s) => s.applyToolFailed);
  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const applyHistoryAdded = useHistoryStore((s) => s.applyHistoryAdded);

  // 启动一次性加载
  useEffect(() => {
    void loadConfig();
    void loadTools();
    void loadHistory();
  }, [loadConfig, loadTools, loadHistory]);

  // 订阅全局事件:配置变更、历史新增、流式工具事件
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    void (async () => {
      unlisteners.push(
        await listen<ConfigChangedPayload>('config_changed', (p) =>
          applyConfigChanged(p)
        )
      );
      unlisteners.push(
        await listen<HistoryEntry>('history_added', (e) =>
          applyHistoryAdded(e)
        )
      );
      unlisteners.push(
        await listen<ToolProgressPayload>('tool_progress', (p) =>
          applyToolProgress(p)
        )
      );
      unlisteners.push(
        await listen<ToolChunkPayload>('tool_chunk', (p) => applyToolChunk(p))
      );
      unlisteners.push(
        await listen<ToolCompletedPayload>('tool_completed', (p) =>
          applyToolCompleted(p)
        )
      );
      unlisteners.push(
        await listen<ToolFailedPayload>('tool_failed', (p) => {
          applyToolFailed(p);
          toast.error(`工具执行失败: ${p.error.message}`);
        })
      );
    })();
    return () => {
      for (const u of unlisteners) u();
    };
  }, [
    applyConfigChanged,
    applyHistoryAdded,
    applyToolProgress,
    applyToolChunk,
    applyToolCompleted,
    applyToolFailed,
  ]);

  // 全局快捷键:Ctrl+K 打开命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSelectHistory = useCallback((entry: HistoryEntry) => {
    useToolStateStore.getState().selectTool(entry.toolId);
    setView('tool');
  }, []);

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden">
        <SideNav />
        <main className="flex-1 min-w-0">
          {view === 'tool' && currentToolId && (
            <ToolPanel
              toolId={currentToolId}
              inputSlot={
                <div className="text-xs text-muted-foreground p-2">
                  工具输入区(由子计划 05 实现具体工具 UI 注入)
                </div>
              }
              outputSlot={
                <div className="text-xs text-muted-foreground p-2">
                  工具输出区(由子计划 05 实现具体工具 UI 注入)
                </div>
              }
            />
          )}
          {view === 'tool' && !currentToolId && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              请从侧边栏选择工具,或按 Ctrl+K 打开命令面板
            </div>
          )}
          {view === 'history' && (
            <HistoryPanel onSelect={handleSelectHistory} />
          )}
          {view === 'settings' && <SettingsPanel />}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenSettings={() => setView('settings')}
        onOpenHistory={() => setView('history')}
      />

      <Toaster richColors position="bottom-right" />
    </ErrorBoundary>
  );
}
```

### Step 4: 运行测试验证通过

- [x] 运行:

```bash
pnpm test -- src/App.test.tsx
```

预期:3 个测试全部通过。

### Step 5: 提交

- [x] 提交:

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(ui): add App root with three-pane layout and global event subscription"
```

---

## Task 18: main.tsx — React 入口

**目标:** 创建 React root,挂载 App,导入 globals.css。无单测,仅作入口装配。

### Step 1: 创建入口文件

- [x] 创建 `src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootEl).render(<App />);
```

### Step 2: 验证 typecheck

- [x] 运行:

```bash
pnpm typecheck
```

预期:无错误。

### Step 3: 验证 dev server 可启动

- [x] 运行(在前台观察 5 秒后 Ctrl+C 退出):

```bash
pnpm dev
```

预期:Vite 输出 `Local: http://localhost:5173/`,无编译错误。

### Step 4: 提交

- [x] 提交:

```bash
git add src/main.tsx
git commit -m "feat(ui): add main.tsx React entry point"
```

---

## Task 19: 集成冒烟测试

**目标:** 在 `src/App.test.tsx` 之外补充一组跨组件交互冒烟测试,验证 SideNav 分组、点击切换 ToolPanel、Ctrl+K 打开 CommandPalette 三个端到端路径。

### Step 1: 写失败测试

- [x] 创建 `src/integration.smoke.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { App } from './App';
import { useToolStateStore } from '@/store/toolStateStore';
import { useHistoryStore } from '@/store/historyStore';
import { useConfigStore } from '@/store/configStore';
import type { ToolMetadata } from '@/types/tool';
import type { CommandResponse } from '@/types/ipc';
import type { UserConfig, HistoryEntry } from '@/types';
import { DEFAULT_USER_CONFIG } from '@/types/config';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const tools: ToolMetadata[] = [
  {
    id: 'json_formatter',
    name: 'JSON Formatter',
    description: '',
    category: 'formatter',
    icon: 'Braces',
    version: '0.1.0',
    keywords: ['json'],
  },
  {
    id: 'base64_codec',
    name: 'Base64 Codec',
    description: '',
    category: 'encoder',
    icon: 'Binary',
    version: '0.1.0',
    keywords: ['base64'],
  },
];

const historyEntry: HistoryEntry = {
  id: 'h-1',
  toolId: 'json_formatter',
  timestamp: '2026-07-25T10:00:00Z',
  inputSummary: { textPreview: '{}', textBytes: 2, params: {}, redacted: false },
  outputSummary: { textPreview: '{}', textBytes: 2, redacted: false },
  success: true,
  durationMs: 1,
};

function setupHappyPath() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'config_get_all') {
      return Promise.resolve({
        success: true,
        data: { ...DEFAULT_USER_CONFIG },
      } as CommandResponse<UserConfig>);
    }
    if (cmd === 'tool_list') {
      return Promise.resolve({
        success: true,
        data: tools,
      } as CommandResponse<ToolMetadata[]>);
    }
    if (cmd === 'history_list') {
      return Promise.resolve({
        success: true,
        data: [historyEntry],
      } as CommandResponse<HistoryEntry[]>);
    }
    return Promise.resolve({ success: true, data: null });
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  useToolStateStore.setState({
    availableTools: [],
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
  useHistoryStore.setState({ entries: [], loading: false, error: null });
  useConfigStore.setState({ config: null, loading: false, error: null });
});

describe('smoke: SideNav 显示工具分组', () => {
  it('渲染 Formatter 与 Encoder 两个分组', async () => {
    setupHappyPath();
    await act(async () => {
      render(<App />);
    });
    expect(await screen.findByRole('heading', { name: /^formatter$/i }))
      .toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^encoder$/i }))
      .toBeInTheDocument();
  });

  it('每个工具在对应分组下渲染为按钮', async () => {
    setupHappyPath();
    await act(async () => {
      render(<App />);
    });
    expect(await screen.findByRole('button', { name: /json formatter/i }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: /base64 codec/i }))
      .toBeInTheDocument();
  });
});

describe('smoke: 点击工具切换 ToolPanel', () => {
  it('点击 JSON Formatter 后,主区域显示该工具名', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    const btn = await screen.findByRole('button', { name: /json formatter/i });
    await user.click(btn);
    // ToolPanel header 包含工具名,加上 SideNav 的按钮文本,至少出现 2 次
    expect(screen.getAllByText(/json formatter/i).length).toBeGreaterThanOrEqual(2);
  });

  it('切换工具后 currentToolId 更新', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    await user.click(await screen.findByRole('button', { name: /base64 codec/i }));
    expect(useToolStateStore.getState().currentToolId).toBe('base64_codec');
  });
});

describe('smoke: Ctrl+K 打开 CommandPalette', () => {
  it('按 Ctrl+K 出现 dialog,Esc 关闭', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Control>}{k}{/Control}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    // Radix Dialog 通过 onOpenChange 关闭,可能需等待 React 处理
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('命令面板中输入 base64 后仅显示 Base64 Codec', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    await user.keyboard('{Control>}{k}{/Control}');
    const dialog = await screen.findByRole('dialog');
    const input = dialog.querySelector('input') as HTMLInputElement;
    await user.type(input, 'base64');
    expect(screen.getByRole('option', { name: /base64 codec/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /json formatter/i }))
      .not.toBeInTheDocument();
  });
});
```

### Step 2: 运行测试验证失败

- [x] 运行:

```bash
pnpm test -- src/integration.smoke.test.tsx
```

预期:部分测试失败(若 Task 17 已完成,大多数应通过;此文件为补充覆盖,主要验证 Ctrl+K 关闭、命令面板过滤等交互细节)。

### Step 3: 修复(若失败)

- [x] 若 CommandPalette 关闭逻辑或搜索过滤未通过,回到 `src/components/CommandPalette.tsx` 检查:
  - Dialog 的 `onOpenChange` 是否正确传递
  - Command 的 `shouldFilter` 是否为 `true`(默认即 true)

### Step 4: 运行全部测试

- [x] 运行全部前端测试:

```bash
pnpm test
```

预期:全部测试通过(19 个 Task 的所有测试文件均绿色)。

### Step 5: 提交

- [x] 提交:

```bash
git add src/integration.smoke.test.tsx
git commit -m "test(ui): add integration smoke tests for SideNav/ToolPanel/CommandPalette"
```

---

## 附录:Task 与产物对照

| Task | 产物文件 | 测试文件 |
|------|----------|----------|
| 1 | `vitest.config.ts`、`src/test/setup.ts`、`package.json` | — |
| 2 | `tailwind.config.ts`、`src/styles/globals.css`、`index.html` | `src/styles/globals.test.ts` |
| 3 | `src/lib/utils.ts`、`components.json`、`src/components/ui/*` | `src/lib/utils.test.ts` |
| 4 | `src/types/{tool,config,history,ipc,index}.ts` | `src/types/types.test.ts` |
| 5 | `src/lib/ipc.ts` | `src/lib/ipc.test.ts` |
| 6 | `src/store/configStore.ts` | `src/store/configStore.test.ts` |
| 7 | `src/store/historyStore.ts` | `src/store/historyStore.test.ts` |
| 8 | `src/store/toolStateStore.ts` | `src/store/toolStateStore.test.ts` |
| 9 | `src/hooks/useTool.ts` | `src/hooks/useTool.test.tsx` |
| 10 | `src/hooks/useClipboard.ts` | `src/hooks/useClipboard.test.ts` |
| 11 | `src/components/ErrorBoundary.tsx` | `src/components/ErrorBoundary.test.tsx` |
| 12 | `src/components/SideNav.tsx` | `src/components/SideNav.test.tsx` |
| 13 | `src/components/CommandPalette.tsx` | `src/components/CommandPalette.test.tsx` |
| 14 | `src/components/ToolPanel.tsx` | `src/components/ToolPanel.test.tsx` |
| 15 | `src/components/HistoryPanel.tsx` | `src/components/HistoryPanel.test.tsx` |
| 16 | `src/components/SettingsPanel.tsx` | `src/components/SettingsPanel.test.tsx` |
| 17 | `src/App.tsx` | `src/App.test.tsx` |
| 18 | `src/main.tsx` | — |
| 19 | — | `src/integration.smoke.test.tsx` |

**完成本计划后,UI 脚手架就绪,可交付子计划 05 实现具体工具 UI。**
