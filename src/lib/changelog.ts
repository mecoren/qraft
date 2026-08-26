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
