/**
 * AboutDialog —— 关于弹窗(独立入口)
 *
 * 参考 wait-home/desktop 的 about-page,采用左右分栏布局:
 * - 左侧导航:应用信息 / 更新日志 / 开源许可 / 开源组件 四个分区
 * - 右侧内容:对应分区的内容
 *
 * 数据来源:
 * - 更新日志:src/lib/changelog.ts(前端硬编码,发版时追加新版本条目)
 * - 应用信息/开源许可/开源组件:由原 SettingsPanel 的 AboutSection 迁入,
 *   版本号仍由 Vite 注入的 __APP_VERSION__ 提供(唯一数据源 package.json)
 *
 * 交互:与 SettingsDialog 一致,支持标题栏拖拽、四角缩放、视口内 clamp
 * (由 useDialogWindow hook 提供)。
 */

import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { BookOpen, Code, GripHorizontal, History, Info, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Logo } from '@/components/Logo';
import { useDialogWindow, DialogResizeHandle } from '@/hooks/useDialogWindow';
import { CHANGELOG_VERSIONS, type ChangeCategory } from '@/lib/changelog';
import { pickText, type LocalizedText } from '@/lib/tool-catalog';

/** 默认尺寸(px) */
const DEFAULT_WIDTH = 920;
const DEFAULT_HEIGHT = 640;
/** 最小尺寸(px) */
const MIN_WIDTH = 560;
const MIN_HEIGHT = 420;

// ============================================================
// 左侧导航分类定义
// ============================================================

type AboutCategory = 'info' | 'changelog' | 'licenses' | 'components';

interface CategoryItem {
  key: AboutCategory;
  /** i18n 键名(MODE_LABEL 模式),组件层翻译 */
  labelKey: string;
  icon: LucideIcon;
}

const CATEGORIES: CategoryItem[] = [
  { key: 'info', labelKey: 'chrome.about.nav_info', icon: Info },
  { key: 'changelog', labelKey: 'chrome.about.nav_changelog', icon: History },
  { key: 'licenses', labelKey: 'chrome.about.nav_licenses', icon: BookOpen },
  { key: 'components', labelKey: 'chrome.about.nav_components', icon: Code },
];

// ============================================================
// 应用版本号 —— 构建时由 Vite 注入(唯一数据源:package.json 的 version 字段)
// 发版请使用 scripts/bump-version.sh 统一升级,勿在此处手动修改。
// ============================================================

const APP_VERSION = __APP_VERSION__;

/** 应用信息条目(label 存 i18n 键,组件层翻译) */
const ABOUT_INFO_ITEMS: { labelKey: string; value: string }[] = [
  { labelKey: 'chrome.about.item_name', value: 'Qraft' },
  { labelKey: 'chrome.about.item_version', value: `v${APP_VERSION}` },
  { labelKey: 'chrome.about.item_stack', value: 'Tauri 2.0 + React 19 + Rust' },
  { labelKey: 'chrome.about.item_ui_framework', value: 'shadcn/ui + Tailwind CSS v4' },
  { labelKey: 'chrome.about.item_update_source', value: 'GitHub Releases' },
];

// ============================================================
// 开源许可
// ============================================================

interface LicenseEntry {
  name: string;
  license: string;
  homepage?: string;
}

const LICENSES: LicenseEntry[] = [
  { name: 'React', license: 'MIT License', homepage: 'https://react.dev' },
  { name: 'React Router', license: 'MIT License', homepage: 'https://reactrouter.com' },
  { name: 'Tailwind CSS', license: 'MIT License', homepage: 'https://tailwindcss.com' },
  { name: 'shadcn/ui', license: 'MIT License', homepage: 'https://ui.shadcn.com' },
  { name: 'Radix UI', license: 'MIT License', homepage: 'https://www.radix-ui.com' },
  { name: 'Tauri', license: 'Apache-2.0 / MIT', homepage: 'https://tauri.app' },
  { name: 'Vite', license: 'MIT License', homepage: 'https://vitejs.dev' },
  { name: 'TypeScript', license: 'Apache-2.0', homepage: 'https://www.typescriptlang.org' },
  {
    name: 'Monaco Editor',
    license: 'MIT License',
    homepage: 'https://microsoft.github.io/monaco-editor',
  },
  { name: 'Lucide Icons', license: 'ISC License', homepage: 'https://lucide.dev' },
  { name: 'Zustand', license: 'MIT License', homepage: 'https://github.com/pmndrs/zustand' },
  { name: 'React Hook Form', license: 'MIT License', homepage: 'https://react-hook-form.com' },
  { name: 'Zod', license: 'MIT License', homepage: 'https://zod.dev' },
  {
    name: 'SQL Formatter',
    license: 'MIT License',
    homepage: 'https://github.com/sql-formatter-org/sql-formatter',
  },
  { name: 'sonner', license: 'MIT License', homepage: 'https://sonner.emilkowal.ski' },
  { name: 'Rust', license: 'MIT / Apache-2.0', homepage: 'https://www.rust-lang.org' },
  { name: 'Tokio', license: 'MIT License', homepage: 'https://tokio.rs' },
  { name: 'Serde', license: 'MIT / Apache-2.0', homepage: 'https://serde.rs' },
  { name: 'Chrono', license: 'MIT / Apache-2.0', homepage: 'https://github.com/chronotope/chrono' },
  {
    name: 'window-vibrancy',
    license: 'MIT License',
    homepage: 'https://github.com/tauri-apps/window-vibrancy',
  },
];

// ============================================================
// 开源组件(与 package.json / Cargo.toml 的依赖对齐)
// ============================================================

type ComponentSource = 'frontend' | 'rust';

interface OpenSourceComponent {
  name: string;
  version: string;
  source: ComponentSource;
  description: LocalizedText;
  license: string;
  repository?: string;
  homepage?: string;
}

const COMPONENTS: OpenSourceComponent[] = [
  // ---------- 前端 npm 依赖 ----------
  {
    name: 'react',
    version: '^19.2.8',
    source: 'frontend',
    description: { zh: '用于构建用户界面的声明式库', en: 'Declarative library for building user interfaces' },
    license: 'MIT',
    repository: 'https://github.com/facebook/react',
    homepage: 'https://react.dev',
  },
  {
    name: 'react-dom',
    version: '^19.2.8',
    source: 'frontend',
    description: { zh: 'React 的 DOM 渲染器', en: 'DOM renderer for React' },
    license: 'MIT',
    repository: 'https://github.com/facebook/react',
  },
  {
    name: 'react-router-dom',
    version: '^7.18.2',
    source: 'frontend',
    description: { zh: 'React 官方声明式路由库', en: 'Official declarative router for React' },
    license: 'MIT',
    repository: 'https://github.com/remix-run/react-router',
    homepage: 'https://reactrouter.com',
  },
  {
    name: '@tauri-apps/api',
    version: '^2.11.1',
    source: 'frontend',
    description: { zh: 'Tauri 2.0 JavaScript API', en: 'Tauri 2.0 JavaScript API' },
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/tauri',
    homepage: 'https://tauri.app',
  },
  {
    name: '@tauri-apps/plugin-updater',
    version: '^2.10.1',
    source: 'frontend',
    description: { zh: 'Tauri 应用更新插件', en: 'Tauri app updater plugin' },
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: '@tauri-apps/plugin-dialog',
    version: '^2.7.2',
    source: 'frontend',
    description: { zh: 'Tauri 原生对话框插件', en: 'Tauri native dialog plugin' },
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: '@tauri-apps/plugin-shell',
    version: '^2.3.5',
    source: 'frontend',
    description: { zh: 'Tauri Shell 调用插件', en: 'Tauri shell invocation plugin' },
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: '@tauri-apps/plugin-clipboard-manager',
    version: '^2.3.2',
    source: 'frontend',
    description: { zh: 'Tauri 剪贴板管理插件', en: 'Tauri clipboard manager plugin' },
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'zustand',
    version: '^5.0.14',
    source: 'frontend',
    description: { zh: '轻量级状态管理库', en: 'Lightweight state management' },
    license: 'MIT',
    repository: 'https://github.com/pmndrs/zustand',
  },
  {
    name: 'react-hook-form',
    version: '^7.83.0',
    source: 'frontend',
    description: { zh: '高性能表单状态管理', en: 'High-performance form state management' },
    license: 'MIT',
    repository: 'https://github.com/react-hook-form/react-hook-form',
    homepage: 'https://react-hook-form.com',
  },
  {
    name: '@hookform/resolvers',
    version: '^5.5.7',
    source: 'frontend',
    description: { zh: 'React Hook Form 校验解析器', en: 'Validation resolvers for React Hook Form' },
    license: 'MIT',
    repository: 'https://github.com/react-hook-form/resolvers',
  },
  {
    name: 'zod',
    version: '^4.4.3',
    source: 'frontend',
    description: { zh: '运行时类型校验库', en: 'Runtime type validation' },
    license: 'MIT',
    repository: 'https://github.com/colinhacks/zod',
    homepage: 'https://zod.dev',
  },
  {
    name: 'tailwindcss',
    version: '^4.3.3',
    source: 'frontend',
    description: { zh: '原子化 CSS 框架 v4', en: 'Utility-first CSS framework v4' },
    license: 'MIT',
    repository: 'https://github.com/tailwindlabs/tailwindcss',
    homepage: 'https://tailwindcss.com',
  },
  {
    name: '@radix-ui/primitives',
    version: '^1.1.21',
    source: 'frontend',
    description: { zh: '无头 UI 组件原语(Dialog / Tabs / Select 等)', en: 'Headless UI primitives (Dialog / Tabs / Select etc.)' },
    license: 'MIT',
    repository: 'https://github.com/radix-ui/primitives',
    homepage: 'https://www.radix-ui.com',
  },
  {
    name: 'shadcn/ui',
    version: '—',
    source: 'frontend',
    description: { zh: '基于 Radix + Tailwind 的可复用组件集合', en: 'Reusable components built on Radix + Tailwind' },
    license: 'MIT',
    repository: 'https://github.com/shadcn-ui/ui',
    homepage: 'https://ui.shadcn.com',
  },
  {
    name: 'lucide-react',
    version: '^1.28.0',
    source: 'frontend',
    description: { zh: 'Lucide 图标库的 React 封装', en: 'React wrapper for the Lucide icon library' },
    license: 'ISC',
    repository: 'https://github.com/lucide-icons/lucide',
    homepage: 'https://lucide.dev',
  },
  {
    name: 'monaco-editor',
    version: '^0.56.0',
    source: 'frontend',
    description: { zh: 'VS Code 同款代码编辑器', en: 'The code editor powering VS Code' },
    license: 'MIT',
    repository: 'https://github.com/microsoft/monaco-editor',
    homepage: 'https://microsoft.github.io/monaco-editor',
  },
  {
    name: '@monaco-editor/react',
    version: '^4.7.0',
    source: 'frontend',
    description: { zh: 'Monaco 编辑器的 React 封装', en: 'React wrapper for the Monaco editor' },
    license: 'MIT',
    repository: 'https://github.com/suren-atoyan/monaco-react',
  },
  {
    name: 'sonner',
    version: '^2.0.7',
    source: 'frontend',
    description: { zh: 'Toast 通知组件', en: 'Toast notification component' },
    license: 'MIT',
    repository: 'https://github.com/emilkowalski/sonner',
    homepage: 'https://sonner.emilkowal.ski',
  },
  {
    name: 'cmdk',
    version: '^1.1.1',
    source: 'frontend',
    description: { zh: '命令面板组件', en: 'Command palette component' },
    license: 'MIT',
    repository: 'https://github.com/pacocoursey/cmdk',
  },
  {
    name: 'class-variance-authority',
    version: '^0.7.1',
    source: 'frontend',
    description: { zh: '类型安全的 className 变体管理', en: 'Type-safe className variant management' },
    license: 'Apache-2.0',
    repository: 'https://github.com/joe-bell/cva',
  },
  {
    name: 'clsx',
    version: '^2.1.1',
    source: 'frontend',
    description: { zh: '条件 className 构造工具', en: 'Conditional className builder' },
    license: 'MIT',
    repository: 'https://github.com/lukeed/clsx',
  },
  {
    name: 'tailwind-merge',
    version: '^3.6.0',
    source: 'frontend',
    description: { zh: '智能合并 Tailwind 类名', en: 'Smart Tailwind class merging' },
    license: 'MIT',
    repository: 'https://github.com/dcastil/tailwind-merge',
  },
  {
    name: 'sql-formatter',
    version: '^15.8.2',
    source: 'frontend',
    description: { zh: 'SQL 语句格式化', en: 'SQL statement formatting' },
    license: 'MIT',
    repository: 'https://github.com/sql-formatter-org/sql-formatter',
  },
  {
    name: 'date-fns',
    version: '^4.4.0',
    source: 'frontend',
    description: { zh: '现代日期工具库', en: 'Modern date utility library' },
    license: 'MIT',
    repository: 'https://github.com/date-fns/date-fns',
    homepage: 'https://date-fns.org',
  },
  {
    name: 'react-resizable-panels',
    version: '^4.12.2',
    source: 'frontend',
    description: { zh: '可调整大小的面板', en: 'Resizable panel components' },
    license: 'MIT',
    repository: 'https://github.com/bvaughn/react-resizable-panels',
  },
  {
    name: '@tanstack/react-virtual',
    version: '^3.14.9',
    source: 'frontend',
    description: { zh: '虚拟列表渲染', en: 'Virtualized list rendering' },
    license: 'MIT',
    repository: 'https://github.com/TanStack/virtual',
    homepage: 'https://tanstack.com/virtual',
  },
  {
    name: 'yaml',
    version: '^2.9.0',
    source: 'frontend',
    description: { zh: 'YAML 解析与序列化', en: 'YAML parsing and serialization' },
    license: 'ISC',
    repository: 'https://github.com/eemeli/yaml',
  },
  {
    name: 'vite',
    version: '^8.1.5',
    source: 'frontend',
    description: { zh: '下一代前端构建工具', en: 'Next-generation frontend build tool' },
    license: 'MIT',
    repository: 'https://github.com/vitejs/vite',
    homepage: 'https://vitejs.dev',
  },
  {
    name: 'typescript',
    version: '^6.0.3',
    source: 'frontend',
    description: { zh: 'JavaScript 的超集,添加静态类型', en: 'A superset of JavaScript with static types' },
    license: 'Apache-2.0',
    repository: 'https://github.com/microsoft/TypeScript',
    homepage: 'https://www.typescriptlang.org',
  },
  {
    name: 'vitest',
    version: '^4.1.10',
    source: 'frontend',
    description: { zh: '单元测试框架', en: 'Unit test framework' },
    license: 'MIT',
    repository: 'https://github.com/vitest-dev/vitest',
    homepage: 'https://vitest.dev',
  },

  // ---------- Rust crates 依赖 ----------
  {
    name: 'tauri',
    version: '2',
    source: 'rust',
    description: { zh: '构建跨平台桌面应用的 Rust 框架', en: 'Rust framework for cross-platform desktop apps' },
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/tauri',
    homepage: 'https://tauri.app',
  },
  {
    name: 'tauri-plugin-updater',
    version: '2',
    source: 'rust',
    description: { zh: '应用自动更新插件', en: 'App auto-update plugin' },
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'tauri-plugin-dialog',
    version: '2',
    source: 'rust',
    description: { zh: '原生对话框插件', en: 'Native dialog plugin' },
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'tauri-plugin-shell',
    version: '2',
    source: 'rust',
    description: { zh: 'Shell 命令调用插件', en: 'Shell command invocation plugin' },
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'tauri-plugin-clipboard-manager',
    version: '2',
    source: 'rust',
    description: { zh: '剪贴板访问插件', en: 'Clipboard access plugin' },
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'tauri-plugin-window-state',
    version: '2',
    source: 'rust',
    description: { zh: '窗口状态记忆插件', en: 'Window state persistence plugin' },
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'tauri-plugin-single-instance',
    version: '2',
    source: 'rust',
    description: { zh: '单实例运行插件', en: 'Single-instance plugin' },
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'tokio',
    version: '1.40',
    source: 'rust',
    description: { zh: '异步运行时与并发工具库', en: 'Async runtime and concurrency utilities' },
    license: 'MIT',
    repository: 'https://github.com/tokio-rs/tokio',
    homepage: 'https://tokio.rs',
  },
  {
    name: 'serde',
    version: '1',
    source: 'rust',
    description: { zh: '序列化/反序列化框架', en: 'Serialization / deserialization framework' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/serde-rs/serde',
    homepage: 'https://serde.rs',
  },
  {
    name: 'serde_json',
    version: '1',
    source: 'rust',
    description: { zh: 'JSON 序列化实现', en: 'JSON serialization support' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/serde-rs/json',
  },
  {
    name: 'thiserror',
    version: '1',
    source: 'rust',
    description: { zh: '派生错误类型的库', en: 'Derive macro for error types' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/dtolnay/thiserror',
  },
  {
    name: 'anyhow',
    version: '1',
    source: 'rust',
    description: { zh: '灵活的错误处理库', en: 'Flexible error handling' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/dtolnay/anyhow',
  },
  {
    name: 'uuid',
    version: '1',
    source: 'rust',
    description: { zh: 'UUID 生成与解析', en: 'UUID generation and parsing' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/uuid-rs/uuid',
  },
  {
    name: 'futures',
    version: '0.3',
    source: 'rust',
    description: { zh: '异步编程抽象库', en: 'Async programming abstractions' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/rust-lang/futures-rs',
  },
  {
    name: 'async-trait',
    version: '0.1',
    source: 'rust',
    description: { zh: '异步 trait 方法支持', en: 'Async trait method support' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/dtolnay/async-trait',
  },
  {
    name: 'tokio-util',
    version: '0.7',
    source: 'rust',
    description: { zh: 'Tokio 工具集', en: 'Tokio utilities' },
    license: 'MIT',
    repository: 'https://github.com/tokio-rs/tokio',
  },
  {
    name: 'chrono',
    version: '0.4',
    source: 'rust',
    description: { zh: '日期时间库', en: 'Date and time library' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/chronotope/chrono',
  },
  {
    name: 'chrono-tz',
    version: '0.9',
    source: 'rust',
    description: { zh: '时区数据', en: 'Timezone data' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/chronotope/chrono-tz',
  },
  {
    name: 'regex',
    version: '1',
    source: 'rust',
    description: { zh: '正则表达式库', en: 'Regular expression engine' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/rust-lang/regex',
  },
  {
    name: 'sha2',
    version: '0.10',
    source: 'rust',
    description: { zh: 'SHA-2 哈希算法实现', en: 'SHA-2 hash implementation' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/RustCrypto/hashes',
  },
  {
    name: 'sha3',
    version: '0.10',
    source: 'rust',
    description: { zh: 'SHA-3 哈希算法实现', en: 'SHA-3 hash implementation' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/RustCrypto/hashes',
  },
  {
    name: 'blake3',
    version: '1.5',
    source: 'rust',
    description: { zh: 'BLAKE3 哈希算法实现', en: 'BLAKE3 hash implementation' },
    license: 'CC0-1.0 / Apache-2.0',
    repository: 'https://github.com/BLAKE3-team/BLAKE3',
  },
  {
    name: 'md-5',
    version: '0.10',
    source: 'rust',
    description: { zh: 'MD5 哈希算法实现', en: 'MD5 hash implementation' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/RustCrypto/hashes',
  },
  {
    name: 'jsonwebtoken',
    version: '9',
    source: 'rust',
    description: { zh: 'JWT 编解码库', en: 'JWT encode / decode library' },
    license: 'MIT',
    repository: 'https://github.com/Keats/jsonwebtoken',
  },
  {
    name: 'base64',
    version: '0.22',
    source: 'rust',
    description: { zh: 'Base64 编码解码', en: 'Base64 encoding / decoding' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/marshallpierce/rust-base64',
  },
  {
    name: 'url',
    version: '2.5',
    source: 'rust',
    description: { zh: 'URL 解析库', en: 'URL parsing library' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/servo/rust-url',
  },
  {
    name: 'percent-encoding',
    version: '2.3',
    source: 'rust',
    description: { zh: 'URL 百分号编码', en: 'URL percent encoding' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/servo/rust-url',
  },
  {
    name: 'window-vibrancy',
    version: '0.8',
    source: 'rust',
    description: { zh: 'Windows 云母 / macOS 亚克力窗口材质', en: 'Windows Mica / macOS acrylic window materials' },
    license: 'MIT',
    repository: 'https://github.com/tauri-apps/window-vibrancy',
  },
  {
    name: 'windows',
    version: '0.61',
    source: 'rust',
    description: { zh: 'Windows API 绑定(DirectWrite 字体枚举等)', en: 'Windows API bindings (DirectWrite font enumeration etc.)' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/microsoft/windows-rs',
  },
  {
    name: 'directories',
    version: '5.0',
    source: 'rust',
    description: { zh: '系统数据目录查询', en: 'System data directory lookup' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/dirs-dev/directories-rs',
  },
  {
    name: 'parking_lot',
    version: '0.12',
    source: 'rust',
    description: { zh: '高性能同步原语', en: 'High-performance synchronization primitives' },
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/Amanieu/parking_lot',
  },
  {
    name: 'tracing',
    version: '0.1',
    source: 'rust',
    description: { zh: '结构化日志库', en: 'Structured logging library' },
    license: 'MIT',
    repository: 'https://github.com/tokio-rs/tracing',
  },
];

/** 变更类别 → Badge 变体 */
const CHANGE_CATEGORY_VARIANT: Record<
  ChangeCategory,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  feature: 'default',
  fix: 'destructive',
  refactor: 'secondary',
  chore: 'outline',
};

// ============================================================
// 关于弹窗主组件:左侧导航 + 右侧内容
// ============================================================

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps): JSX.Element {
  const { t } = useTranslation();
  const [active, setActive] = useState<AboutCategory>('info');

  const { rect, dragEvents, resizeEvents, onMove } = useDialogWindow({
    defaultWidth: DEFAULT_WIDTH,
    defaultHeight: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="z-50 flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl outline-none"
          style={{
            position: 'fixed',
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            transform: 'none',
          }}
          onPointerMove={onMove}
        >
          {/* 顶部拖拽标题栏 */}
          <div
            className="flex h-12 shrink-0 cursor-grab select-none items-center gap-2 border-b bg-muted/30 px-4 active:cursor-grabbing"
            {...dragEvents}
          >
            <GripHorizontal className="size-4 text-muted-foreground" />
            <DialogTitle className="text-sm font-semibold">{t('chrome.about.title')}</DialogTitle>
            <DialogDescription className="sr-only">{t('chrome.about.sr_desc')}</DialogDescription>
            <div className="flex-1" />
            <button
              data-no-drag
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={t('chrome.about.close_aria')}
            >
              <X className="size-4" />
            </button>
          </div>

          {/* 主体:左导航 + 右内容 */}
          <div className="flex min-h-0 flex-1" data-no-drag>
            {/* 左侧导航 */}
            <nav className="w-44 shrink-0 border-r bg-muted/30 p-2">
              <div className="flex flex-col gap-1">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const isActive = active === cat.key;
                  return (
                    <Button
                      key={cat.key}
                      type="button"
                      variant="ghost"
                      onClick={() => setActive(cat.key)}
                      aria-pressed={isActive}
                      className={cn(
                        'flex w-full items-center justify-start gap-2 px-3 py-2 text-sm',
                        isActive
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                      )}
                    >
                      <Icon aria-hidden className="size-4" />
                      {t(cat.labelKey)}
                    </Button>
                  );
                })}
              </div>
            </nav>

            {/* 右侧内容区 */}
            <div className="min-w-0 flex-1">
              <ScrollArea className="h-full">
                <div className="mx-auto max-w-3xl p-6">
                  {active === 'info' && <InfoSection />}
                  {active === 'changelog' && <ChangelogSection />}
                  {active === 'licenses' && <LicensesSection />}
                  {active === 'components' && <ComponentsSection />}
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* 仅四角缩放手柄 */}
          <DialogResizeHandle dir="se" className="bottom-0 right-0 h-4 w-4" {...resizeEvents} />
          <DialogResizeHandle dir="sw" className="bottom-0 left-0 h-4 w-4" {...resizeEvents} />
          <DialogResizeHandle dir="ne" className="right-0 top-0 h-4 w-4" {...resizeEvents} />
          <DialogResizeHandle dir="nw" className="left-0 top-0 h-4 w-4" {...resizeEvents} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

// ============================================================
// 应用信息面板
// ============================================================

function InfoSection(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 py-2">
        <Logo className="size-20 rounded-2xl bg-muted/50 p-3 shadow-sm" />
        <div className="text-center">
          <div className="text-base font-semibold text-foreground">Qraft</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t('chrome.welcome.hero_title')}
          </div>
        </div>
        <Badge variant="secondary" className="mt-1">
          v{APP_VERSION}
        </Badge>
      </div>
      <div>
        <h2 className="text-base font-semibold text-foreground">{t('chrome.about.info_heading')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('chrome.about.info_desc')}</p>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          {ABOUT_INFO_ITEMS.map((item) => (
            <div key={item.labelKey} className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{t(item.labelKey)}</span>
              <span className="text-sm font-medium text-foreground">{item.value}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// 更新日志面板(Accordion 折叠展示,默认展开最新版本)
// ============================================================

function ChangelogSection(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t('chrome.about.changelog_heading')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('chrome.about.changelog_desc', { count: CHANGELOG_VERSIONS.length })}
        </p>
      </div>
      <Card>
        <CardContent className="pt-2">
          <Accordion type="single" defaultValue={CHANGELOG_VERSIONS[0]?.version} collapsible>
            {CHANGELOG_VERSIONS.map((log) => (
              <AccordionItem key={log.version} value={log.version}>
                <AccordionTrigger>
                  <div className="flex flex-1 flex-col items-start gap-1 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">v{log.version}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {log.date}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{pickText(log.summary)}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ul className="flex flex-col gap-2 pl-1">
                    {log.changes.map((change, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Badge
                          variant={CHANGE_CATEGORY_VARIANT[change.category]}
                          className="mt-0.5 shrink-0 text-[10px]"
                        >
                          {/* 类别徽章走 i18n;条目描述为 LocalizedText 双语 */}
                          {t(`chrome.about.cat_${change.category}`)}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {pickText(change.description)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// 开源许可面板
// ============================================================

function LicensesSection(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t('chrome.about.licenses_heading')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('chrome.about.licenses_desc')}</p>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          {LICENSES.map((item) => (
            <div key={item.name} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground">{item.name}</span>
                {item.homepage && (
                  <a
                    href={item.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {item.homepage}
                  </a>
                )}
              </div>
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {item.license}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// 开源组件面板(Tabs 切换前后端依赖 + Accordion 明细)
// ============================================================

function ComponentGroup({ list }: { list: OpenSourceComponent[] }): JSX.Element {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="pt-2">
        <Accordion type="single" collapsible>
          {list.map((comp) => (
            <AccordionItem key={`${comp.source}-${comp.name}`} value={comp.name}>
              <AccordionTrigger>
                <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                  <div className="flex min-w-0 flex-col items-start gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {comp.name}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {pickText(comp.description)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      v{comp.version}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {comp.license}
                    </Badge>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-2 pl-1 text-xs text-muted-foreground">
                  {comp.repository && (
                    <div>
                      <span className="font-medium text-foreground">
                        {t('chrome.about.repo_label')}
                      </span>
                      <a
                        href={comp.repository}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 hover:text-foreground hover:underline"
                      >
                        {comp.repository}
                      </a>
                    </div>
                  )}
                  {comp.homepage && (
                    <div>
                      <span className="font-medium text-foreground">
                        {t('chrome.about.homepage_label')}
                      </span>
                      <a
                        href={comp.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 hover:text-foreground hover:underline"
                      >
                        {comp.homepage}
                      </a>
                    </div>
                  )}
                  <div>
                    <span className="font-medium text-foreground">
                      {t('chrome.about.license_label')}
                    </span>
                    <span className="ml-1">{comp.license}</span>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function ComponentsSection(): JSX.Element {
  const { t } = useTranslation();
  const frontend = COMPONENTS.filter((c) => c.source === 'frontend');
  const rust = COMPONENTS.filter((c) => c.source === 'rust');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t('chrome.about.components_heading')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('chrome.about.components_desc', {
            frontend: frontend.length,
            rust: rust.length,
            total: COMPONENTS.length,
          })}
        </p>
      </div>
      <Tabs defaultValue="frontend" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="frontend">{t('chrome.about.tab_frontend')}</TabsTrigger>
          <TabsTrigger value="rust">{t('chrome.about.tab_rust')}</TabsTrigger>
        </TabsList>
        <TabsContent value="frontend">
          <ComponentGroup list={frontend} />
        </TabsContent>
        <TabsContent value="rust">
          <ComponentGroup list={rust} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
