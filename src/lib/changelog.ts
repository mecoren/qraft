/**
 * 更新日志数据 —— 前端硬编码,发版时按同一格式追加新版本条目
 *
 * 结构对齐 wait-home/desktop 的 VersionInfo 模型:
 * - version: 版本号(不含 v 前缀)
 * - date: 发布日期(YYYY-MM-DD)
 * - summary: 版本一句话摘要(LocalizedText 双语)
 * - changes: 变更明细,按 新增/修复/优化/其他 四类组织(描述双语)
 *
 * v0.1.0 内容基于 git log(2026-07-25 首提交 至 2026-08-21 00:00)提炼,
 * v0.1.1 内容基于 git log 与代码(2026-08-21 00:00 之后)提炼,
 * v0.1.2 内容基于 git log(v0.1.1 标签之后至 2026-08-23)提炼,
 * v0.1.5 内容基于 git log(v0.1.2 标签之后至 2026-08-27)提炼,
 * v0.2.0 内容基于 git log(v0.1.5 标签之后至 2026-08-28)提炼,
 * v0.2.2 内容基于 git log(v0.2.0 标签之后至 2026-08-29)提炼,
 * 均按功能合并同类提交,避免逐条罗列中间过程。
 */

import type { LocalizedText } from './tool-catalog';

export type ChangeCategory = 'feature' | 'fix' | 'refactor' | 'chore';

export interface ChangeEntry {
  category: ChangeCategory;
  description: LocalizedText;
}

export interface VersionInfo {
  version: string;
  date: string;
  summary: LocalizedText;
  changes: ChangeEntry[];
}

/** 变更类别 → 中文标签(遗留导出;UI 徽章现走 chrome.about.cat_* 键) */
export const CHANGE_CATEGORY_LABEL: Record<ChangeCategory, string> = {
  feature: '新增',
  fix: '修复',
  refactor: '优化',
  chore: '其他',
};

export const CHANGELOG_VERSIONS: VersionInfo[] = [
  {
    version: '0.2.2',
    date: '2026-08-29',
    summary: {
      zh: 'Windows 文件关联图标与应用内视觉统一,NSIS 安装器覆盖安装与界面图标定制',
      en: 'Unified Windows file association icons with the app visuals, NSIS overwrite-install and icon customization',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: 'Windows 文件关联图标与应用内视觉统一:资源管理器中的关联图标改为与「打开的编辑器」标签栏同一套 material-icon-theme 图标(脚本生成 16–256 七尺寸 ICO);文件关联按语言拆分为 22 个 ProgID,每个 ProgID 的 DefaultIcon 与应用内 getFileIconName 映射一一对应;安装完成广播 SHCNE_ASSOCCHANGED 即时刷新;历史遗留的 "Source Code File" 分组 ProgID 在安装/卸载时自动清理',
          en: 'Unified Windows file association icons: Explorer icons now match the material-icon-theme icons in editor tabs (generated at 16–256px); associations split into 22 language ProgIDs whose DefaultIcon maps 1:1 to the in-app getFileIconName; SHCNE_ASSOCCHANGED broadcast refreshes icons instantly; legacy "Source Code File" ProgIDs auto-cleaned on install/uninstall',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: 'NSIS 安装器改用项目定制模板:检测到已安装旧版本时跳过「Uninstall before installing / Do not uninstall」选择页,直接覆盖安装以保留用户配置与数据;从 WiX(MSI) 迁移场景仍保留卸载流程;安装器与卸载器界面图标显式配置为项目图标,消除 NSIS 默认占位图标',
          en: 'Custom NSIS installer template: skips the "uninstall first?" page on existing installations for a straight overwrite install that preserves user data; uninstall flow retained for WiX (MSI) migration; installer/uninstaller icons set to the project icon, removing NSIS placeholder icons',
        },
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-08-28',
    summary: {
      zh: '工具可弹出为独立窗口(关闭时回写主窗口)、文本比较全面重构与差异计算 Web Worker 化、全量工具样式统一',
      en: 'Tools pop out to separate windows with write-back on close, text compare rebuilt with Web Worker diffing, unified tool styling',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: '工具弹出新窗口(pop-out):任意工具可弹出为独立系统窗口,弹窗与主窗口共享 localStorage 持久层,关闭弹窗时把弹窗内的最后编辑回写主窗口;标题栏/命令面板/侧栏右键菜单三处入口,每工具单实例(重复打开自动聚焦)',
          en: 'Pop-out windows: any tool can pop out to a separate OS window sharing the localStorage persistence layer, with the last edits written back to the main window on close; entries in titlebar, command palette and sidebar context menu, one instance per tool (reopening focuses)',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '文本比较工具全量重构:对齐 JSON 格式化器工作区样式(多 Tab 增删与持久化、按输入派生 Tab 名),差异展示与 VSCode 原生 DiffEditor 对齐(行级红/绿背景、词级高亮、行号色条、右缘概览标尺)',
          en: 'Text compare rebuilt: workspace style aligned with the JSON formatter (persistent tabs, names derived from input), diff visuals aligned with VSCode native DiffEditor (row-level red/green, word-level highlights, gutter bars, overview ruler)',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增共享差异对比视图组件 TextDiffView(并排/行内布局、差异高亮、统计徽标、滚动同步),文本比较与文本编辑器「文件对比」共用,文件对比按扩展名推断语言',
          en: 'New shared TextDiffView component (side-by-side/inline layouts, diff highlights, stats badge, scroll sync) used by both text compare and the editor file-compare view, which now infers language by extension',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复系统级文件打开会清空编辑器文件列表的问题:打开文件与持久化历史 Tab 改为合并水合,并区分用户主动与系统自动打开入口',
          en: 'Fixed system file opens wiping the editor tab list: files now merge-hydrate with persisted history tabs, distinguishing user-initiated from system-initiated opens',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '差异计算 Web Worker 化:TextDiffView 差异计算迁移至 Web Worker(小输入同步快路径),大文档对比不再阻塞 UI(实测长任务 140 次/54s → 0 次)',
          en: 'Diff computation moved to a Web Worker (sync fast path for small inputs): large-document diffs no longer block the UI (measured long tasks 140/54s → 0)',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '全量工具样式统一至 JsonFormatter 基准:统一工具 shell 卡片、扁平顶部配置区与次级卡片规范,40+ 工具面板视觉一致',
          en: 'All tool styles unified to the JsonFormatter baseline: consistent tool shell cards, flat top config area and inner-card rules across 40+ tools',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '移除 url_codec 独立工具,URL 编码/解码能力整合进 JSON 格式化器(JsonFormatter)',
          en: 'Removed the standalone url_codec tool; URL encode/decode is now integrated into the JSON formatter',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '编辑器未保存确认由居中对话框改为锚定小 Popover,与关闭 Tab/清空历史等确认交互统一',
          en: 'Unsaved-changes confirmation in the editor changed from a centered dialog to an anchored popover, consistent with tab-close/history-clear confirmations',
        },
      },
      {
        category: 'chore',
        description: {
          zh: '修复 Rust clippy 冗余 clone 警告,全量代码通过 Prettier 格式化与 ESLint 门禁',
          en: 'Fixed a Rust clippy redundant-clone warning; all code passes Prettier formatting and ESLint gates',
        },
      },
    ],
  },
  {
    version: '0.1.5',
    date: '2026-08-27',
    summary: {
      zh: '界面中英双语全面落地,新增五个工具与跨工具传值,性能优化与编辑器 Esc 键修复',
      en: 'Full bilingual UI, five new tools with cross-tool handoff, performance optimizations and editor Esc key fixes',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: '界面中英双语(i18next 全量落地):设置页新增界面语言切换;侧栏/命令面板/设置/关于/欢迎页/全局搜索锚点及全部工具面板文案双语;目录元数据与搜索索引双语命中;Monaco 内置 UI 随应用语言切换',
          en: 'Full bilingual UI via i18next: interface language switcher in settings; sidebar, command palette, settings, About, welcome page, search anchors and all tool panels localized; bilingual catalog metadata and search index hits; Monaco built-in UI follows the app language',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增 5 个工具:文本统计(字符/词数/行数/字节)、ULID 生成器(Crockford Base32)、Basic Auth 生成器(UTF-8 安全)、IPv4 子网计算器、JSON↔CSV 转换器(RFC 4180)',
          en: 'Five new tools: text statistics (chars/words/lines/bytes), ULID generator (Crockford Base32), Basic Auth generator (UTF-8 safe), IPv4 subnet calculator and JSON↔CSV converter (RFC 4180)',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '跨工具传值(send-to):输出区新增发送菜单与接收通道,JSON 格式化器/Base64 转换器/哈希计算器率先接入',
          en: 'Cross-tool handoff (send-to): send menu in tool output areas with receiving channels, adopted first by JSON formatter / Base64 / hash tools',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '剪贴板智能探测(smart-detect,默认关闭):探测 JSON/JWT/Base64/PEM/URL 类型并在命令面板给出推荐',
          en: 'Clipboard smart detection (opt-in by default off): detects JSON/JWT/Base64/PEM/URL content and surfaces recommendations in the command palette',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '工具全局快捷键:Ctrl+Enter 执行 / Ctrl+L 清空 / Ctrl+Shift+C 复制,配套工具动作注册表,多工具已接入',
          en: 'Tool global shortcuts: Ctrl+Enter execute / Ctrl+L clear / Ctrl+Shift+C copy with a tool action registry, wired into multiple tools',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '文本编辑器增强:Markdown 分屏预览与视图模式切换、状态栏实时文件大小、Tab 支持重命名与固定、字号跟随设置档位',
          en: 'Editor enhancements: Markdown split preview with view mode switcher, live file size in status bar, tab rename/pin support and font size following settings',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复文本编辑器 Esc 键被全局快捷键拦截的问题:无面板打开且焦点在编辑器时 Esc 正确交给 Monaco 关闭查找替换框',
          en: "Fixed the editor's Esc key being swallowed by global shortcuts: with no panel open and focus in the editor, Esc now correctly reaches Monaco to close the find widget",
        },
      },
      {
        category: 'fix',
        description: {
          zh: '快捷键忽略长按自动重复事件(e.repeat)防止连发;打通工具执行历史落库与事件链路',
          en: 'Shortcuts ignore auto-repeat events (e.repeat) to prevent rapid-fire; fixed tool execution history persistence and event chain',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '收藏工具平铺至固定「文本编辑器」下方,去除分类分组;固定编辑器不可收藏',
          en: 'Favorite tools flattened below the pinned text editor without category grouping; the pinned editor cannot be favorited',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '性能优化:启动性能打磨、大输入路径降阻塞(release 启用 LTO/strip)、ToolPanel keepalive 引入 LRU 上限、空闲期预取 Markdown 重型 chunk',
          en: 'Performance: startup polish, reduced blocking on large inputs (LTO/strip in release), LRU cap for ToolPanel keepalive, idle prefetch of heavy Markdown chunks',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '全局搜索海量命中护栏:单文件/全局收集上限、截断标记与高亮范围限制;7 个工具错误格式化收口为共享模块',
          en: 'Search flood guards: per-file/global collection caps, truncation markers and highlight limits; consolidated error formatting of 7 tools into a shared module',
        },
      },
      {
        category: 'chore',
        description: {
          zh: '接入 pnpm audit 门禁并升级 dompurify;支持 prefers-reduced-motion 减弱动态效果',
          en: 'pnpm audit gate with dompurify upgrade; prefers-reduced-motion support for reduced motion',
        },
      },
    ],
  },
  {
    version: '0.1.2',
    date: '2026-08-23',
    summary: {
      zh: '工具箱扩容与编辑器全面增强:IP 解析、PNG 压缩、多编码支持、多根文件夹工作区与 Markdown 预览升级',
      en: 'Toolbox expansion and editor enhancements: IP parser, PNG compression, multi-encoding support, multi-root workspace and Markdown preview upgrades',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: '新增 IP 地址解析器与归属地查询:支持 IPv4/IPv6 与 CIDR 记法解析,实时计算子网掩码、网络/广播地址、可用主机范围等信息,并可查询 IP 归属地',
          en: 'New IP address parser with geolocation lookup: IPv4/IPv6 and CIDR parsing, live netmask, network/broadcast address and usable host range, plus IP geolocation',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增 PNG 压缩工具,集成 OxiPNG 无损优化与调色板量化压缩',
          en: 'New PNG compressor integrating OxiPNG lossless optimization and lossy palette quantization',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增多语言文本编码检测与转换(UTF-8 / GBK / Big5 等),编辑器支持文件编码切换并持久化',
          en: 'Multi-language text encoding detection and conversion (UTF-8 / GBK / Big5 etc.); the editor supports switching file encoding with persistence',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '编辑器支持打开文件夹形成多根文件夹工作区:目录树懒加载、展开状态持久化,并校验二进制/非 UTF-8 文件',
          en: 'Open folders to form a multi-root workspace in the editor: lazy directory tree, persisted expansion state, and binary/non-UTF-8 file validation',
        },
      },
      {
        category: 'feature',
        description: {
          zh: 'Markdown 预览增强:分栏编辑、公式与图表渲染、滚动同步',
          en: 'Markdown preview enhancements: split-pane editing, math & diagram rendering, scroll sync',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增 JSON 键排序与实体类生成工具',
          en: 'New JSON key sorting and entity class generation tools',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '文件树按文件类型展示 Material Icon Theme 图标(参考 VSCode 效果)',
          en: 'File tree shows Material Icon Theme icons by file type (VSCode-style)',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '编辑器支持单个 Tab 自动换行开关,右键菜单切换并随工作区持久化',
          en: 'Per-tab word-wrap toggle in the editor, switched via context menu and persisted per workspace',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '全局搜索支持结果跳转与字段高亮;生产环境下禁用浏览器默认右键菜单',
          en: 'Global search supports result jumping and field highlighting; the browser default context menu is disabled in production',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '完善 Monaco 中文本地化与主题明暗判定',
          en: 'Improved Monaco Chinese localization and theme dark/light detection',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复命令面板滚动区域高度塌缩与下拉框滚轮失效问题',
          en: 'Fixed command palette scroll-area height collapse and broken wheel scrolling in dropdowns',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '优化文件打开失败的错误提示:区分不支持格式等错误类型,IPC 错误归一化保留真实错误详情',
          en: 'Better file-open error messages: distinguishes unsupported formats etc.; normalized IPC errors preserve real details',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '编辑器侧边栏体验优化:Tab 显示所在目录、未命名 Tab 按首行内容派生标题、中键关闭 Tab、拖拽逻辑重构(滞回防抖)与文件树高度策略自适应',
          en: 'Editor sidebar polish: tabs show their directory, untitled tabs derive titles from first line, middle-click to close, reworked drag logic (hysteresis debounce) and adaptive tree height',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '优化 Monaco JSON 折叠摘要样式({ N 个键 } / [ N 个元素 ])、全局滚动条样式与字体选择器性能',
          en: 'Refined Monaco JSON fold summaries ({ N keys } / [ N items ]), global scrollbar styling and font picker performance',
        },
      },
      {
        category: 'chore',
        description: {
          zh: 'Windows 安装包集成右键菜单:安装时注册文件/文件夹右键菜单与「打开方式」列表,卸载自动清理',
          en: 'Windows installer context-menu integration: registers file/folder context menu and "Open with" entries on install, cleaned up on uninstall',
        },
      },
      {
        category: 'chore',
        description: {
          zh: '开发/生产环境数据隔离:dev 使用独立应用标识符,不再读写正式版数据目录',
          en: 'Dev/prod data isolation: dev builds use a separate app identifier and no longer touch production data directories',
        },
      },
      {
        category: 'chore',
        description: {
          zh: '补充 destructive-foreground 颜色变量,完善主题色彩体系',
          en: 'Added destructive-foreground color variable, completing the theme color system',
        },
      },
    ],
  },
  {
    version: '0.1.1',
    date: '2026-08-21',
    summary: {
      zh: '独立的关于对话框与更新日志,以及 Monaco 图标与编辑器退出流程的修复优化',
      en: 'Standalone About dialog with changelog, plus fixes for Monaco icons and the editor exit flow',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: '新增独立「关于」对话框:从设置弹窗分离,提供 应用信息 / 更新日志 / 开源许可 / 开源组件 四分区左右分栏布局,支持拖拽移动与四角缩放',
          en: 'New standalone About dialog, separated from settings: App info / Changelog / Licenses / Components in a two-pane layout with drag-to-move and corner resizing',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增应用更新日志,采用折叠面板按版本展示迭代明细,默认展开最新版本,便于后续发版持续维护',
          en: 'New app changelog as collapsible per-version panels, latest expanded by default, easy to maintain across releases',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '侧边栏底部新增「关于」入口(展开态文本项 + 折叠态图标按钮),与「设置」并列',
          en: 'New "About" entry at the sidebar bottom (text item when expanded, icon button when collapsed), alongside Settings',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复 Monaco 0.56 min 构建缺失 codicon 样式导致图标异常的问题',
          en: 'Fixed broken icons caused by missing codicon styles in the Monaco 0.56 min build',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '设置弹窗瘦身:移除「关于」菜单项,设置与关于彻底分离,入口收敛至侧边栏',
          en: 'Slimmed the settings dialog: removed the About menu item; settings and About are fully separated with entries consolidated in the sidebar',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '抽取通用弹窗窗口逻辑为 useDialogWindow hook(拖拽 / 四角缩放 / 视口 clamp),设置与关于弹窗共用',
          en: 'Extracted shared dialog window logic into the useDialogWindow hook (drag / corner resize / viewport clamp), shared by settings and About dialogs',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '编辑器退出时移除未保存确认对话框,改为自动冲刷缓存后退出,简化关闭流程',
          en: 'Removed the unsaved-changes confirmation on editor exit; caches flush automatically for a simpler close flow',
        },
      },
      {
        category: 'chore',
        description: {
          zh: '新增 shadcn Accordion 组件与 @radix-ui/react-accordion 依赖,支撑更新日志与开源组件的折叠交互',
          en: 'Added the shadcn Accordion component and @radix-ui/react-accordion dependency powering changelog and component accordions',
        },
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-08-20',
    summary: {
      zh: '首个版本迭代:代码编辑器工作区、GitHub Releases 更新、品牌重塑与 CI/CD 加固',
      en: 'First iteration: code editor workspace, GitHub Releases updates, rebranding and CI/CD hardening',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: '更新源接入 GitHub Releases,并按安装方式分流更新:就地覆盖类自动下载 patch,系统安装版跳转手动下载整包,支持下载进度展示',
          en: 'Updates powered by GitHub Releases with per-install-mode flow: in-place installs auto-download patches, system installs jump to manual full-package download, with progress display',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '代码编辑器工作区:多标签页与文件拖拽排序、多选文件并排对比差异、差异分组与 Tab 展示',
          en: 'Code editor workspace: multi-tab with drag reordering, multi-file side-by-side diffs, diff grouping and tab display',
        },
      },
      {
        category: 'feature',
        description: {
          zh: 'Monaco 编辑器增强:代码折叠、中文右键菜单、语言模式选择、底部状态栏与字符统计、JSON 编辑器折叠摘要',
          en: 'Monaco enhancements: code folding, localized context menu, language mode picker, status bar with char count, JSON fold summaries',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增字符命名风格循环切换(配置 + 快捷键),支持 camelCase / snake_case 等风格',
          en: 'New naming-case cycling (settings + shortcut) supporting camelCase / snake_case and more',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '统一 Base64 工具:支持多模式编解码与文件保存;文本比较工具重构为 Monaco DiffEditor',
          en: 'Unified Base64 tool with multi-mode codecs and file saving; text compare rebuilt on Monaco DiffEditor',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '工具面板支持 keepalive 保留状态,切换工具后输入输出与滚动位置不丢失',
          en: 'Tool panel keepalive preserves state; inputs, outputs and scroll positions survive tool switches',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '侧边栏支持右键收藏及排序工具;编辑器工具栏迁移至标题栏菜单栏',
          en: 'Sidebar supports right-click favoriting and reordering; editor toolbar moved to the titlebar menu',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '支持单实例运行与文件打开关联,可快速在编辑器中打开本地文件',
          en: 'Single-instance running and file-open association for quickly opening local files in the editor',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复生产构建 Tailwind v4 样式丢失、ScrollArea 滑块样式丢失的问题',
          en: 'Fixed missing Tailwind v4 styles and ScrollArea thumb styling in production builds',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '生产 CSP 允许 Monaco 运行时内联样式,修复编辑器在打包后异常',
          en: 'Production CSP now allows Monaco runtime inline styles, fixing broken packaged builds',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复 Vite8/esbuild 构建兼容性,并兼容 react-resizable-panels v4',
          en: 'Fixed Vite 8 / esbuild build compatibility and react-resizable-panels v4 support',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复 Base64 工具二进制预览 src 属性竞态,优化更新下载进度计算',
          en: 'Fixed a race in Base64 binary preview src assignment and improved update download progress calculation',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '统一应用版本号数据源为 package.json,发版仅需修改一处',
          en: 'Single source of truth for the app version in package.json; releases change one place only',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '统一语义色 token,修复输入输出分离逻辑;优化编辑器侧边栏布局与响应式适配',
          en: 'Unified semantic color tokens, fixed input/output split logic; improved sidebar layout and responsiveness',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '优化历史裁剪与前端渲染性能,减少大历史量下的卡顿',
          en: 'Optimized history trimming and frontend rendering, reducing jank with large histories',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '品牌重塑:Logo 与应用图标透明化并新增暗色反色版本,全面应用到应用内、favicon 与打包图标',
          en: 'Rebranding: transparent logo and app icon with a dark inverse variant, applied across the app, favicon and package icons',
        },
      },
      {
        category: 'chore',
        description: {
          zh: '重构 CI/CD 工作流,支持多平台 arm64 构建,并修复 cargo audit 与 SBOM 生成流程',
          en: 'Reworked CI/CD workflows with multi-platform arm64 builds; fixed cargo audit and SBOM generation',
        },
      },
      {
        category: 'chore',
        description: {
          zh: '批量更新依赖并新增工具库;修复 clippy 警告并清理代码',
          en: 'Batch dependency updates plus new utility libs; fixed clippy warnings and cleaned up code',
        },
      },
    ],
  },
];
