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
 * v0.2.5 内容基于 git log 与工作区改动(v0.2.2 标签之后至 2026-09-03)提炼,
 * v0.2.6 内容基于 git log(v0.2.5 标签之后至 2026-09-07)提炼,
 * v0.2.7 内容基于 git log(v0.2.6 标签之后至 2026-09-10)提炼(发版时仅入 CHANGELOG.md,此处 0.2.8 发版补记),
 * v0.2.8 内容基于 git log(v0.2.7 标签之后至 2026-09-14)提炼,
 * v0.2.9 内容基于 git log 与工作区改动(v0.2.8 标签之后至 2026-09-15)提炼,
 * v0.3.0 内容基于 git log 与工作区改动(v0.2.9 标签之后至 2026-09-15)提炼,
 * v0.3.1 内容基于 git log(v0.3.0 标签之后至 2026-09-16)提炼,
 * v0.3.2 内容基于 git log(v0.3.1 标签之后至 2026-09-18)提炼,
 * v0.3.3 内容基于 git log(v0.3.2 标签之后至 2026-09-19)提炼,
 * v0.3.4 内容基于 git log(v0.3.3 标签之后至 2026-09-20)提炼,
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
    version: '0.3.4',
    date: '2026-09-20',
    summary: {
      zh: '编辑器缩进统一收口到设置:文本编辑器与 JSON 格式化器新增缩进字符 / 宽度设置,并支持按文件单独覆盖(覆盖后不再跟随全局);同时修掉制表符缩进 JSON 文档的假报错与失效修复,格式化分流阈值升到 2MiB',
      en: 'Indentation now comes from one place: the text editor and JSON formatter gained indent character/width settings plus per-file overrides that stop following the global value once set; this release also fixes false syntax errors and broken repair for tab-indented JSON and raises the formatter split threshold to 2 MiB',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: '文本编辑器新增「缩进字符」(空格 / Tab)设置,JSON 格式化器新增「使用 Tab 缩进」开关;两个工具都支持按文件 / 文档单独覆盖缩进方式与宽度,覆盖后本文件不再跟随全局设置(只有改设置才影响其余文件),编辑器状态栏缩进菜单新增「跟随设置」清除覆盖,JSON 格式化器顶部新增文档级缩进选择器并在跟随态标注当前全局值',
          en: 'The text editor gained an indent-character setting (spaces/tabs) and the JSON formatter an "indent with tabs" switch; both tools now support per-file/per-document overrides of indent style and width that stop following the global settings once set (only changing the settings affects the rest), the editor status bar menu gained "follow settings" to clear an override, and the JSON formatter gained a document-level indent picker that labels the current global value while following',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: 'JSON 格式化器前后端分流阈值按实测从 200KB 提升到 2MiB,并消费后端随 extra 返回的结构统计,不再重复解析输出;Rust 侧 sort_keys 改为递归排序、缩进参数归一化(与前端同口径,非法值统一回落 2 空格)、删除不可达的流式路径',
          en: 'The JSON formatter split threshold moved from 200KB to 2 MiB based on measurements, and the frontend now consumes the structure stats returned in the backend extra instead of re-parsing the output; on the Rust side sort_keys became recursive, indent params are normalized (same rules as the frontend, invalid values fall back to 2 spaces), and the unreachable streaming path was removed',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复制表符缩进的 JSON 文档被误判语法错误、以及「一键修复」在这类文档上失效:诊断与修复把 Tab 计入 JSON 空白字符',
          en: 'Fixed false syntax errors and broken one-click repair for tab-indented JSON: diagnostics and repair now treat tabs as JSON whitespace',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复设置页的 JSON 缩进偏好保存后工具侧不生效,以及缩进宽度在前后端分流两侧输出不一致(0 等非法值统一回落)',
          en: 'Fixed the JSON indent preference from Settings not taking effect in the tool, and indent widths producing different output on the two sides of the frontend/backend split (invalid values such as 0 now fall back consistently)',
        },
      },
    ],
  },
  {
    version: '0.3.3',
    date: '2026-09-19',
    summary: {
      zh: '文本编辑器开始感知文件外部变更:watcher 推送 + mtime 复核提示,文件被外部删除后保存直接在原路径重建;保存链路全面改原子写入,并修掉保存丢脏竞态与设置项写入恒失败',
      en: 'The text editor now reacts to external file changes: watcher pushes with mtime re-check toasts, and saving a file deleted outside recreates it in place. The whole save path switched to atomic writes, plus fixes for lost-dirty save races and settings that never persisted',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: '文本编辑器感知文件的外部变更:后端新增 notify 父目录 watcher,打开的文件被其它程序改写或删除时 toast 提示(事件只带路径,是否算外部修改由前端按 mtime 基准复核,并保留激活时比对兜底);文件在打开后被外部删除时保存不再失败,后端单独分流 ERR_FILE_NOT_FOUND,前端去掉校验基准重试一次并在原路径重建,提示「已重新创建」',
          en: 'The text editor now notices external changes: a backend notify parent-directory watcher toasts when an open file is rewritten or deleted by another program (events carry only the path; the frontend re-checks mtime, with the on-activation comparison kept as fallback). Saving a file deleted after opening no longer fails — ERR_FILE_NOT_FOUND is routed separately and the frontend retries without the mtime baseline, recreating the file in place with a "recreated" toast',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '写盘改原子替换(目标同目录临时文件 + fsync + rename),覆盖写回、按编码保存、另存为与 history.jsonl 裁剪不再因磁盘满或崩溃残留半截文件;打开拖放/关联进来的文件合并为一次读取;编辑器工作区持久化防抖按载荷大小自适应,config_set 去掉整份配置预读并为 tool_prefs.<name> 加直写快路径;大文件行索引扫描与全文搜索按 scanId 支持取消',
          en: 'Disk writes became atomic replacements (temp file in the target directory + fsync + rename), so overwrite saves, encoded saves, save-as and history.jsonl trimming no longer leave half-written files on a full disk or crash; opening dropped/associated files collapsed into a single read; workspace persistence debounce now scales with payload size, config_set dropped its full-config pre-read and gained a HashMap fast path for tool_prefs.<name>; large-file index scans and full-text search are now cancellable by scanId',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '编辑器工作区主组件按内聚块拆为 11 个 hook 与子组件(约 2400 行降到约 940 行,行为不变);「检查更新」从设置页迁入「关于」弹窗,改为版本徽标行的胶囊小按钮',
          en: 'The editor workbench component was split by cohesive block into 11 hooks and child components (about 2,400 lines down to about 940, behavior unchanged); "check for updates" moved from Settings into the About dialog as a pill button on the version badge row',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复保存丢脏竞态:异步落盘期间的新输入不再被误判已保存(Markdown 编辑器按写入快照回写、代码编辑器 markSaved 收写盘快照、PDF 编辑器用编辑序号 rev 守卫);修复 Monaco model 池化下的全局泄漏(工作台卸载时释放 inmemory://tab/* model);消除每次按键的全文 O(n) 扫描(状态栏统计 deferred 降级、码点计数零分配、JSON 探测只解析头部、Monaco options 稳定引用)',
          en: 'Fixed lost-dirty save races: edits typed while an async write is in flight are no longer treated as saved (Markdown editor writes back the snapshot, code editor markSaved takes the written snapshot, PDF editor guards with an edit revision counter); fixed a global Monaco model leak by disposing pooled inmemory://tab/* models on workbench unmount; removed the per-keystroke O(n) full-text scan (deferred status-bar stats, allocation-free code point counting, JSON probe parsing only the head, stable Monaco options)',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复大文件读取错行:前后端校准点统一为 { line, offset } 对象(原按元组消费致锚点恒退到 offset 0),行窗口缓存按 path:lineCount 分片 LRU 防跨文件串台,Rust 行窗口读取由逐字节热循环改为按块批量扫描',
          en: 'Fixed wrong lines on large files: the anchor contract between front and back end is now a { line, offset } object (tuples made anchors always fall back to offset 0), the line-window cache is sharded by path:lineCount in an LRU to avoid cross-file bleed, and Rust line-window reads scan in blocks instead of a byte-at-a-time hot loop',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复设置项写入恒失败:前端配置键名与 Rust 线格式不一致(toolPrefs / fontSize / maxHistory / confirmOnClear 实为 tool_prefs / font_size / max_history / confirm_on_clear),config_set 报 invalid config path 且读侧静默取默认值;工具偏好(如 JSON 缩进)改按整槽写入,保留同一偏好槽内的其它设置',
          en: 'Fixed settings writes that always failed: frontend config keys disagreed with the Rust wire format (toolPrefs / fontSize / maxHistory / confirmOnClear are really tool_prefs / font_size / max_history / confirm_on_clear), so config_set returned invalid config path while reads silently fell back to defaults; tool preferences (e.g. JSON indent) are now written per slot, keeping other preferences in the same slot',
        },
      },
    ],
  },
  {
    version: '0.3.2',
    date: '2026-09-18',
    summary: {
      zh: '文本比较 / 文件对比的并排差异改用 Monaco 原生 advanced 算法(隐藏 DiffEditor 优先、jsdiff 兜底),词级精度与行内对比同源;修复同块内被配对到非相邻行的词级高亮丢失',
      en: 'Side-by-side diff in text compare / file compare now uses Monaco native advanced algorithm (hidden DiffEditor first, jsdiff fallback), word-level precision shares the inline diff source; fixed lost word highlights for lines paired to non-adjacent rows',
    },
    changes: [
      {
        category: 'refactor',
        description: {
          zh: '并排差异算法改用 Monaco 原生 advanced:常驻隐藏 DiffEditor 优先计算字符级 innerChanges,不可用/超时回退 jsdiff 同步/Worker 快慢路径;分组与词级精度与行内原生 DiffEditor 同源,同 hunk 内无关增删不再被硬配成"修改行";移除旧的 src/lib/diff.ts,差异计算统一到 text-diff 服务',
          en: 'Side-by-side diff switched to Monaco native advanced: a persistent hidden DiffEditor computes character-level innerChanges first, falling back to jsdiff sync/worker paths when unavailable or on timeout; grouping and word-level precision share the inline DiffEditor source, so unrelated add/delete in one hunk are no longer forced into "modified" pairs; removed the old src/lib/diff.ts, unifying diff into the text-diff service',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复并排模式词级高亮丢失:删除行被语义配对到非相邻新增行(中间夹纯插入)时,余量行此前按位置窗口裁剪会丢掉行内高亮,现按 charChanges 绝对行号覆盖整块渲染,与 VSCode 原生 DiffEditor 对齐',
          en: 'Fixed lost word-level highlights in side-by-side mode: when a removed line is semantically paired to a non-adjacent added line (with a pure insertion between), surplus lines previously had inline highlights clipped away by a positional window; spans are now rendered by charChanges absolute line numbers across the whole block, matching VSCode native DiffEditor',
        },
      },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-09-16',
    summary: {
      zh: 'Markdown 预览重构为所见即所得 Markdown 编辑器(TipTap 内核:多 Tab、工具栏、三视图、大纲、打字机/专注模式、导出);JSON 格式化器六项增强(嵌套展开、时间戳互转、JMESPath、对比双侧、历史固定、剪贴板填充);修复 tauri dev 空等前端',
      en: 'Markdown preview rebuilt as a WYSIWYG Markdown editor (TipTap core: multi-tab, toolbar, three views, outline, typewriter/focus modes, export). JSON formatter six upgrades (nested expansion, timestamp conversion, JMESPath, two-sided compare, pinned history, clipboard fill). Fixed tauri dev waiting on the frontend',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: 'Markdown 编辑器全面升级(TipTap 所见即所得内核):多 Tab 文档管理与持久化、富文本格式工具栏与快捷键、分栏/编辑/预览三视图、大纲导航、打字机/专注写作模式、本地草稿自动保存、表格/代码块/公式/Mermaid 图渲染、图片预览与远程图片加载控制、导出 HTML/Markdown/打印/PDF、文件打开/保存/重命名与冲突处理、中英双语完整覆盖',
          en: 'Markdown editor overhaul (TipTap WYSIWYG core): multi-tab document management with persistence, rich-text toolbar and shortcuts, split/edit/preview views, outline navigation, typewriter/focus writing modes, local-first draft autosave, tables/code blocks/math/Mermaid rendering, image preview with remote-image loading control, export to HTML/Markdown/print/PDF, open/save/rename with conflict handling, full zh/en i18n coverage',
        },
      },
      {
        category: 'feature',
        description: {
          zh: 'JSON 格式化器六项增强:嵌套 JSON 字符串一键展开为对象/数组并写回输入、文档内时间戳与可读时间双向批量互转、新增 JMESPath 查询引擎(支持过滤与函数)、对比视图双侧展示、历史记录固定(pin)免于淘汰、空文档检测到剪贴板 JSON 时提示一键填入',
          en: 'JSON formatter six upgrades (inspired by Json-Assistant): expand nested JSON strings into objects/arrays in place, batch-convert timestamps and readable dates both ways, new JMESPath query engine with filters and functions, two-sided compare view, pin history entries against eviction, clipboard JSON detected on empty docs offers one-click fill',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: 'Markdown 预览工具重构为 Markdown 编辑器(toolId 由 `markdown_preview` 迁移为 `markdown_editor`),新增旧 ID 迁移逻辑,既有收藏与历史记录自动兼容',
          en: 'Markdown preview rebuilt as Markdown editor (toolId migrated from `markdown_preview` to `markdown_editor`) with legacy-id migration so existing favorites and history keep working',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复 `pnpm tauri dev` 偶发空等前端:Vite dev server 强制监听 IPv4,避免 localhost 解析到 IPv6 时 Tauri 连不上 devUrl',
          en: 'Fixed `pnpm tauri dev` occasionally hanging while waiting for the frontend: Vite dev server now binds IPv4 explicitly, avoiding devUrl connection failures when localhost resolves to IPv6',
        },
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-09-15',
    summary: {
      zh: 'Markdown 预览六批增强:hljs 代码块 LRU 缓存、Typora 图片尺寸语法与 Ctrl+滚轮缩放、任务勾选写回源码、拖拽图片落盘插入 mdasset、预览区复制即 Markdown;ScrollArea 横向模式滚轮直通;Office Excel 工作表条改造',
      en: 'Markdown preview six-pack: hljs code-block LRU cache, Typora image size syntax with Ctrl+wheel zoom, task-toggle writes source back, dragged images saved as mdasset, preview copy-as-markdown. ScrollArea horizontal wheel-passthrough. Office Excel sheet-strip overhaul',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: 'Markdown 预览渲染管线增强:hljs 代码块 LRU 缓存(300 条 / 4MB,两阶段渲染 fast→complete 消除重复高亮开销);图片尺寸语法 `![alt](src "=300x200")`(宽高可单边,尺寸段从 title 末尾剥离)+ DOMPurify 白名单放行 width / height;任务列表 checkbox 挂 data-md-task + data-task-line,点击勾选精确替换对应源行 `[ ]`↔`[x]`',
          en: 'Markdown rendering pipeline: hljs code-block LRU cache (300 entries / 4MB, eliminates duplicate highlight work in fast→complete two-pass rendering); Typora image-size syntax `![alt](src "=300x200")` (single-side allowed, stripped from title) with DOMPurify whitelist for width/height; task checkboxes carry data-md-task + data-task-line so click replaces the source `[ ]`↔`[x]` exactly',
        },
      },
      {
        category: 'feature',
        description: {
          zh: 'Markdown 预览交互增强:拖拽图片文件到编辑器位图落盘资产目录并插入 mdasset:引用(Monaco 容器层截获);预览区复制即 Markdown 源码(Typora 行为,选区 HTML 经 turndown 回转写入剪贴板);图片 Ctrl+滚轮文内缩放(首次锚定 naturalWidth,等比 ±15% / 步,clamp 10%–600%)',
          en: 'Markdown preview interactions: dropped image files are saved as assets and inserted as mdasset: references (Monaco container-layer interceptor); copy-as-markdown (Typora behaviour, selection HTML → turndown → clipboard plain text); Ctrl+wheel zooms images in-place (anchored to naturalWidth, ±15%/step, clamp 10–600%)',
        },
      },
      {
        category: 'feature',
        description: {
          zh: 'ScrollArea 横向模式原生滚轮直通:Chrome 标签栏 / VSCode Tab 栏同款行为,纵向 delta 自动转横向滚动;无溢出不吞滚轮,已溢出时滚到两端也吞事件避免穿透到底下内容',
          en: 'ScrollArea horizontal wheel passthrough (Chrome tab / VSCode tab strip behaviour): vertical wheel delta converts to horizontal scroll; no interception when not overflowing; swallows at the ends to prevent event bleed-through',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: 'Office Excel 工作表条从原生 overflow-x-auto 换成共享 ScrollArea 横向模式(悬浮细条 + 滚轮直通)',
          en: 'Office Excel sheet strip: replaced raw overflow-x-auto with shared ScrollArea horizontal mode (hover thumb + wheel passthrough)',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复 SearchDialog 全量并行下「打开/输入时不自动高亮」测试 flaky(cmdk 内部 activeIndex 与 DOM 渲染顺序存在时序窗口,断言从 `selected === options[0]` 改为语义验证);修复 ToolPanel keepalive 测试全量并行超时(Monaco 懒加载串行 3 次在多 worker 抢 CPU 下超过 10s,放宽 LAZY_TIMEOUT 到 20s)',
          en: 'Fixed SearchDialog flaky test under full-parallel runs (cmdk activeIndex vs DOM order timing window; assertion changed from `selected === options[0]` to semantic verification). Fixed ToolPanel keepalive timeout (Monaco lazy-load serial ×3 exceeded 10s under worker CPU contention; LAZY_TIMEOUT raised to 20s)',
        },
      },
    ],
  },
  {
    version: '0.2.9',
    date: '2026-09-15',
    summary: {
      zh: 'Markdown 预览工具补全文件能力(文件菜单 / 保存 / 路径绑定 / 冲突三选),新增工具级标题栏菜单系统与快捷键归属守卫;内存优化批次:三缓存改双上限 LRU、keepalive 加权容量、流式 chunk 即时释放、mermaid 按图种类分块加载',
      en: 'Markdown preview gains full file capabilities (file menu, save, path binding, conflict dialog); new tool-scoped menubar system and shortcut ownership guard. Memory pass: three caches move to dual-limit LRU, weighted keepalive capacity, streaming chunks released on completion, mermaid split into per-diagram chunks',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: 'Markdown 预览文件能力:左上角「文件」菜单(新建/打开/保存/另存为/关闭)+ Ctrl+O / Ctrl+S / Ctrl+Shift+S;打开的文档绑定磁盘路径直接写回,保存带 mtime 乐观校验(外部修改弹覆盖/对比/重读三选);拖放与系统关联打开的 .md 同样绑定路径;Tab 名展示文件名、未保存带 dirty 圆点;切回 Tab 检测外部修改提前提示',
          en: 'Markdown preview file support: top-left File menu (new/open/save/save-as/close) with Ctrl+O / Ctrl+S / Ctrl+Shift+S; opened documents bind to disk paths and save in place with mtime optimistic check (conflict offers overwrite/compare/reload); drag-drop and system-open .md files bind paths too; tab shows filename with a dirty dot; switching back to a tab detects external modification early',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '工具级标题栏菜单系统:工具可向标题栏注册自己的菜单(首个接入:Markdown 预览「文件」菜单),keepalive 多工具并存时按激活归属正确展示/重放/清理',
          en: 'Tool-scoped menubar system: tools can register their own menus into the titlebar (first consumer: Markdown preview File menu); under keepalive coexistence menus are shown/replayed/cleaned by the active tool',
        },
      },
      {
        category: 'feature',
        description: {
          zh: 'useToolShortcut 快捷键归属守卫:keepalive 常驻工具的同类绑定不再互相误触,仅激活工具响应且非激活侧放行事件;文本编辑器与 Markdown 预览的 Ctrl+S 等编辑类快捷键接入',
          en: 'useToolShortcut ownership guard: same-key bindings of keepalive-resident tools no longer fire each other; only the active tool responds and inactive ones pass through; editor-style shortcuts like Ctrl+S adopted by text editor and Markdown preview',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '内存优化:新增字节 + 条数双上限 LRU 缓存模块,KaTeX 公式 / Mermaid SVG / 图片资产三个渲染缓存从「满额全清」改为逐条淘汰(热条目不再被全清丢掉,大图缓存受 32MB 字节上限约束);工具页 keepalive 容量改加权 LRU(内嵌 Monaco 的重型工具占 2 名额);流式任务完结即释放累计 chunk',
          en: 'Memory pass: new dual-limit (bytes + entries) LRU cache module; the KaTeX/Mermaid/image render caches evict entry-by-entry instead of clearing wholesale, with hot entries surviving and image data URLs bounded by 32MB; keepalive capacity becomes weighted LRU (Monaco-heavy tools cost 2 slots); streaming tasks release accumulated chunks on completion',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: 'mermaid 改官方分块入口按需加载:30+ 图表实现从 3.5MB 单包拆为按图种类的独立小 chunk,渲染哪种图才下载哪种实现;空闲预取不再拉整包',
          en: 'mermaid now uses the official chunked entry for on-demand loading: 30+ diagram implementations split from a 3.5MB bundle into small per-kind chunks, downloaded only when that diagram type renders; idle prefetch no longer pulls the whole package',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复 KaTeX 渲染输出配置拼写错误(htmlAndmathml → htmlAndMathml),此前配置从未生效;修复版本发布脚本在 Windows Git Bash 下多行内联 node -e 静默失效的问题',
          en: 'Fix KaTeX output config typo (htmlAndmathml to htmlAndMathml) which had silently fallen back to defaults; fix the version bump script silently no-oping on Windows Git Bash due to multiline inline node -e',
        },
      },
    ],
  },
  {
    version: '0.2.8',
    date: '2026-09-14',
    summary: {
      zh: 'DevToys 对标差距表收官:新增 TOML / YAML 格式化器、图片元数据查看器、公钥解析器、Smart Detection 与视频转 GIF,文本编辑器四批次升级与跨文件替换,文本比较工具落地,全库模糊搜索与性能基线达标',
      en: 'DevToys parity table completed: new TOML and YAML formatters, image metadata viewer, public key decoder, Smart Detection and video-to-GIF; text editor upgraded in four batches with cross-file replace; text compare tool shipped; fuzzy search across the app and performance baselines met',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: '新增 TOML 格式化器(toml_formatter):Rust 侧 Taplo 引擎 Document 级往返,保留注释/数组换行/表头结构;缩进 2/4 空格、键值对齐、键排序,非法输入给出行列定位 chip 可一键跳转',
          en: 'New TOML formatter (toml_formatter): Taplo-engine document round-trip on the Rust side preserving comments, array wrapping and table structure; 2/4-space indent, entry alignment and key sorting, with a line/column chip that jumps to the error',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增 YAML 格式化器(yaml_formatter):Document 级往返保留注释/锚点/块标量/多文档结构;缩进 2/4 空格、minify 单行压缩、递归键排序;错误行列定位 chip 与统计徽章(文档/键/深度)',
          en: 'New YAML formatter (yaml_formatter): document round-trip preserving comments, anchors, block scalars and multi-document structure; 2/4-space indent, single-line minify and recursive key sorting; error line/column chips plus stats badges (documents/keys/depth)',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增图片元数据查看器(image_metadata):PNG/JPEG/WebP/GIF/BMP 五格式字节直读,EXIF 相机字段分组展示,左右分栏拖放预览,一键复制报告;纯前端本地解析零 IPC',
          en: 'New image metadata viewer (image_metadata): byte-level parsing for PNG/JPEG/WebP/GIF/BMP, grouped EXIF camera fields, split-pane drop preview and one-click report copy; fully local parsing with zero IPC',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增公钥解析器(public_key_decoder):RSA/EC/Ed25519 公私钥 PEM 本地解析,SPKI/PKCS#8/SEC1 三层 ASN.1 直解,展示算法/位数/曲线/模数与 SPKI SHA-256 指纹(与 openssl 口径一致);剪贴板嗅探新增公钥/私钥 PEM 命中;私钥不出本机',
          en: 'New public key decoder (public_key_decoder): local RSA/EC/Ed25519 PEM parsing with direct SPKI/PKCS#8/SEC1 ASN.1 decoding; shows algorithm, bit size, curve, modulus and SPKI SHA-256 fingerprint matching openssl; clipboard detection now recognizes public/private key PEM; private keys never leave the machine',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '剪贴板智能识别升级为 Smart Detection:嗅探 8 种格式(新增完整 URL→二维码、时间戳、hex 哈希摘要),无歧义格式置顶;主区顶部提示条一键跳转目标工具并预填剪贴板原文,证书/JWT/时间戳三工具已接接收端;默认关闭、关闭态零剪贴板读取不变',
          en: 'Clipboard detection upgraded to Smart Detection: 8 sniffed formats (adding full URL, timestamps and hex digests) with unambiguous hits ranked first; a top banner jumps to the target tool with the clipboard text prefilled, with certificate/JWT/timestamp receivers wired; off by default and zero clipboard reads while off, unchanged',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增视频转 GIF 工具(video_to_gif):时间轴片段截取、帧率与输出宽度可调,自研 GIF89a 编码器(中位切分调色板 + LZW,零新依赖),Pillow 交叉验证像素吻合',
          en: 'New video-to-GIF tool (video_to_gif): timeline range clipping with adjustable FPS and output width, powered by an in-house GIF89a encoder (median-cut palette + LZW, zero new dependencies), pixel-verified against Pillow',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增文本比较工具(text_compare):EOL 归一、差异导航 F7、行内差异与未变更区折叠、相似度统计、导出 .patch、WinMerge 式差异块逐块拷贝、忽略行尾空白与大小写选项、对齐式同步滚动;拖放填充与大文件防护',
          en: 'New text compare tool (text_compare): EOL normalization, F7 diff navigation, inline diff with collapsed unchanged regions, similarity stats, .patch export, WinMerge-style block copy, ignore-trailing-whitespace and ignore-case options, and aligned sync scrolling; drag-drop fill with large-input guards',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '文本编辑器四批次升级:位置历史(Alt+方向键)、编辑器设置面(括号着色/缩进参考线/缩略图等 7 项热更新)、文件树右键新建/重命名/删除(沙箱校验+Tab 自动重定向)、跨文件查找替换(正则捕获组 $1 反向引用)、大文件搜索大小写口径切换与外部修改激活轮询',
          en: 'Text editor upgraded in four batches: position history (Alt+arrows), a settings panel (bracket colorization, indent guides, minimap and more, hot-reloaded), tree context-menu create/rename/delete with sandboxing and tab retargeting, cross-file find & replace (regex $1 capture groups), plus large-file search case toggling and external-change polling on tab activation',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '文本处理工具全面增强:查找替换/提取器(URL/邮箱/IP/日期预设)/词频统计、全角半角转换、行编号、自然排序等纯函数库(text-ops);列表比对器新增计数模式;ConfigRow caption 微标签与弹性布局契约落地;输入框等非编辑器控件统一 UI 字体',
          en: 'Text utilities overhauled: find & replace, extractors (URL/email/IP/date presets), word frequency, full/half-width conversion, line numbering and natural sort on a pure text-ops core; list comparer gained a counts mode; ConfigRow got caption micro-labels and a flexible layout contract; non-editor controls unified on the UI font',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '命令面板/侧栏/全局搜索升级 fzf 风格模糊匹配:子串优先档 + 缩写子序列兜底,jsf 这类缩写直达 JSON 格式化器;零新依赖,三处搜索同口径',
          en: 'Command palette, sidebar and global search upgraded to fzf-style fuzzy matching: substring tier plus abbreviation-subsequence fallback, so "jsf" jumps straight to the JSON formatter; zero new dependencies with one shared ranking across all three surfaces',
        },
      },
      {
        category: 'feature',
        description: {
          zh: 'PDF 编辑器页面级操作:页码范围提取为新 PDF、页面导出 PNG/JPEG、Tab 栏「合并全部」;图片转换器与 PNG 压缩器支持多文件批量处理(共享队列/失败不中断/节省统计);哈希工具新增文件模式(流式分块 + 取消);CSV/TSV 下载统一 UTF-8 BOM,Excel 双击中文不乱码',
          en: 'PDF editor page operations: range extraction to a new PDF, PNG/JPEG page export and "merge all" from the tab bar; image converter and PNG compressor gained multi-file batch mode (shared queue, fail-safe, savings stats); the hash tool added a file mode (streaming chunks + cancel); CSV/TSV downloads embed a UTF-8 BOM so Excel opens Chinese correctly',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '正则工具常用模板库:24 模板 × 5 分类(URL/时间/数字/文本/代码),前端面板与 Rust 集成测试共读单一 JSON 数据源;重复行检测器支持 TSV 导出;Base64 解码默认宽松化(剔空白/补 padding/嗅探字母表)并保留严格模式开关',
          en: 'Regex tool template library: 24 templates in 5 categories (URL/time/number/text/code) from a single JSON source shared with Rust integration tests; duplicate-line detector gained TSV export; Base64 decode is lenient by default (strip whitespace, pad, sniff alphabet) with a strict-mode switch',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '六工具巡检修复:QR 码生成失败不再静默(超容量显式失败占位)、UUID 数量兜底与快捷键接线、密码熵计算与易混淆池同源、乱数假文重新生成按钮与数量钳制、HMAC 密钥提示清理;FolderAnalyzer 纯浏览器环境挂载崩溃修复;颜色转换器结果区改可拖分栏',
          en: 'Six-tool sweep fixes: QR generation failures no longer silent (over-capacity shows an explicit failure state), UUID count fallback and shortcut wiring, password entropy aligned with the effective pool, lorem re-generate button with count clamping and HMAC hint cleanup; fixed FolderAnalyzer crash in plain browsers; color converter result pane became a resizable split',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '性能指标体系落地:criterion 引擎基准(小输入 23.6µs / 1MB 38.9ms)、IPC 执行路径基准(1MB 实测 17.9-28.8ms,两倍余量)、前端数据层 bench、release 冷启动热缓存 164ms 与主进程 33MB 全部达标;主二进制接入 mimalloc 分配器(A/B 实测空闲持平);PRD 18 DevToys 差距表全部勾销收官',
          en: 'Performance metrics landed: criterion engine benchmarks (23.6µs small / 38.9ms 1MB), IPC path benchmarks (17.9-28.8ms at 1MB, 2x headroom), frontend data-layer benches, and release baselines all met (164ms warm start, 33MB main process); mimalloc allocator adopted for the main binary (A/B idle parity); the PRD 18 DevToys parity table is fully closed out',
        },
      },
    ],
  },
  {
    version: '0.2.7',
    date: '2026-09-10',
    summary: {
      zh: '新增 NanoID/HMAC/OTP/AES 四个加密工具,Markdown 编辑器全量升级,文件本地历史与保存冲突防护,大文件流式搜索与 JSON 错误定位修复',
      en: 'Four new crypto tools (NanoID/HMAC/OTP/AES), a full Markdown editor upgrade, file local history with save-conflict protection, large-file streaming search and JSON error location and fixes',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: '新增 4 个加密安全域工具:NanoID 生成器、HMAC 计算器、TOTP/HOTP 一次性密码(OTP)生成器、AES 加解密;左右分栏布局,RFC 官方测试向量保障正确性',
          en: 'Four new crypto tools: NanoID generator, HMAC calculator, TOTP/HOTP one-time-password generator and AES encrypt/decrypt; split-pane layouts with RFC official test vectors guaranteeing correctness',
        },
      },
      {
        category: 'feature',
        description: {
          zh: 'Markdown 编辑器全量升级:聚焦模式、远程图片加载开关;GitHub 警报、==高亮==、Front Matter、emoji 短码扩展语法;本地图片资产系统(粘贴截图自动保存、mdasset: 引用解析);另存 Markdown、打印导出 PDF;双击预览跳转编辑器对应行',
          en: 'Markdown editor fully upgraded: focus mode and a remote-image toggle; GitHub alerts, ==highlights==, front matter and emoji shortcodes; a local image asset system (pasted screenshots saved automatically with mdasset: references); save-as Markdown and print-to-PDF; double-clicking the preview jumps to the matching editor line',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '文件本地历史与保存冲突防护:覆盖保存前由 Rust 快照旧内容(每文件 20 版),Tab 右键「历史版本」支持对比当前/恢复/清空,清空二段确认、列表完整键盘操作;保存前 mtime 校验,文件被外部修改拒绝盲写,冲突弹覆盖/对比/重读三选',
          en: 'File local history and save-conflict protection: Rust snapshots the previous content before overwrite-saves (20 versions per file); the tab "History" menu compares, restores or clears with a two-stage confirm and full keyboard support; a pre-save mtime check refuses blind writes when the file changed on disk, offering overwrite/compare/reload',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '文本编辑器升级:10GB+ 大文件流式全文搜索(Rust 跨块扫描、进度事件、命中计数、点击虚拟定位跳转);全局搜索补大小写/整词/正则三切换钮,正则实时纠错;Monaco model 池化(切 Tab 不重挂载,undo 栈与视图状态存活);菜单九键真绑定、Ctrl+Tab 标签导航、恢复关闭标签栈',
          en: 'Text editor upgrades: 10GB+ streaming full-text search (Rust cross-chunk scanning, progress events, hit counts and click-to-jump); global search gained case/whole-word/regex toggles with live regex error checking; Monaco model pooling (no remount on tab switch, undo stacks and view state survive); true menu key bindings, Ctrl+Tab tab navigation and a closed-tab restore stack',
        },
      },
      {
        category: 'feature',
        description: {
          zh: 'JSON 格式化器四连增强:零依赖扫描器定位 11 类错误到行列(编辑器波浪线 + 跳转 chip,显式修复如实呈现报告);单遍历结构统计与大数字丢精度警示;转换菜单新增 CSV 输出(RFC 4180);树视图行内 JSONPath 复制与 URL/颜色/日期内容推断 chip',
          en: 'JSON formatter four-part enhancement: a zero-dependency scanner pinpoints 11 error classes to line/column (editor squiggles plus jump chips, explicit fix buttons reporting exactly what changed); single-pass structure stats with big-number precision warnings; CSV output added to the convert menu (RFC 4180); inline JSONPath copy and URL/color/date inference chips in the tree view',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复 URL 解码把 query 段 + 误留为字面加号(按表单语义还原为空格);修复后端 JSON 键序重排(serde_json 启用 preserve_order 与前端一致);修复 JSON 显式修复后输入框报错残留与窄窗口标题栏按钮裁切;修复 WebView2 下标题栏动作区滚动条常驻',
          en: 'Fixed URL decoding leaving a literal + in query strings (restored as spaces per form semantics); fixed backend JSON key reordering (serde_json preserve_order now matches the frontend); fixed leftover squiggles after explicit JSON repair and title-bar button clipping in narrow windows; fixed a persistent scrollbar in the title-bar action area under WebView2',
        },
      },
    ],
  },
  {
    version: '0.2.6',
    date: '2026-09-07',
    summary: {
      zh: '新增 PDF 编辑器与 Office 文档编辑器,文本编辑器 10GB+ 大文件查看,NSIS 安装版自动更新,十余个工具对标成熟方案升级',
      en: 'New PDF editor and Office document editor, 10GB+ large-file viewing in the text editor, NSIS auto-update, and a dozen tools upgraded to match mature apps',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: '新增 PDF 编辑器:多 Tab 阅读、AcroForm 表单填写与导出(扁平化)、文本标注叠加编辑(矩形/高亮/自由画笔/文字);系统打开 .pdf 文件自动分流至该工具;标注坐标按页内比例归一化,缩放后不错位',
          en: 'New PDF editor: multi-tab reading, AcroForm form filling with flattened export, and annotation overlays (rectangle/highlight/freehand/text); system .pdf opens route to the tool; annotation coordinates are normalized per-page so they stay aligned after zooming',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '新增 Office 文档编辑器:Excel(.xlsx)多 Sheet 查看与单元格定位、列内容完整展示,Word(.docx)段落文本编辑并导出;文件关联新增 pdf/docx/xlsx 等扩展',
          en: 'New Office document editor: Excel (.xlsx) multi-sheet viewing with cell locating and full-width columns, Word (.docx) paragraph text editing with export; file associations add pdf/docx/xlsx and more',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '文本编辑器支持 10GB+ 大文件只读查看:后端行索引扫描 + 锚点式行窗口按需读取,前端虚拟滚动;文本探测对齐 VSCode 修复 .dat/UTF-16 等文件无法打开;二进制文件提供「仍要打开」兜底',
          en: 'The text editor views 10GB+ files read-only: backend line-index scanning with anchored line-window reads plus virtual scrolling on the frontend; text detection aligned with VSCode fixes .dat/UTF-16 files; binary files get an "open anyway" fallback',
        },
      },
      {
        category: 'feature',
        description: {
          zh: 'NSIS 安装版支持应用内自动更新:更新器区分安装类别,系统安装版不再被误导跳转手动下载',
          en: 'In-app auto-update for NSIS installs: the updater distinguishes install types so system installs are no longer misdirected to manual downloads',
        },
      },
      {
        category: 'feature',
        description: {
          zh: 'JSON 格式化器支持多格式输入:自动嗅探 YAML / TOML / JSON5 / Properties / URL 参数并转 JSON 处理,移除独立 JSON↔YAML 工具',
          en: 'The JSON formatter accepts multiple input formats: auto-detects YAML / TOML / JSON5 / Properties / URL query strings and converts them to JSON; the standalone JSON↔YAML tool was removed',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '十余个工具对标成熟方案升级:证书解码器结构化重构(分区卡片/自签名检测/ASN.1 全文)、GZip 文件模式、HTML 三级编码、Basic Auth 双向化、JWT 实时解析、SQL 十二种方言、XML 保留声明与 XSD 真实校验(xmllint-wasm)、图片转换缩放合成、PNG 并排对比,以及 Cron/IP 子网/JSON 表格/进制转换等六个纯前端工具全面增强',
          en: 'A dozen tools upgraded to match mature apps: certificate decoder restructured (section cards, self-signed detection, ASN.1 dump), GZip file mode, HTML three-level encoding, bidirectional Basic Auth, live JWT parsing, 12 SQL dialects, XML declaration preservation and real XSD validation (xmllint-wasm), image-converter scaling/compositing, PNG side-by-side compare, plus full upgrades to six pure-frontend tools (Cron, IP subnet, JSON table, base converter and more)',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '布局与视觉统一:证书/GZip/HTML/JWT 改左右分栏,工具标题栏统一 26px 基准,二维码模式改配置行分段切换,输入框统一界面字体(编辑器保留代码字体)',
          en: 'Layout and visual unification: certificate/GZip/HTML/JWT moved to split panes, tool title bars unified at the 26px baseline, QR mode switched to a config-row segmented control, inputs use the UI font (editors keep the code font)',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复 Base64 工具 ScrollArea 打断高度链的预览异常;窄屏下编辑器路径面包屑溢出;IPC 嵌套错误载荷丢失真实消息;cmdk 结果集重挂载自动高亮首项的污染;Excel 切表内容错乱;纵向面板组白屏(适配 react-resizable-panels v4)',
          en: 'Fixed Base64 preview broken by ScrollArea interrupting the height chain; editor path-breadcrumb overflow on narrow screens; IPC nested error payloads swallowing real messages; cmdk auto-highlighting the first item on remount; Excel sheet-switch garbled content; vertical panel-group white screens (react-resizable-panels v4)',
        },
      },
    ],
  },
  {
    version: '0.2.5',
    date: '2026-09-03',
    summary: {
      zh: '正则测试工具重构增强、文本比较与 Markdown 预览多 Tab 工作区、JSONPath 与文本统计合并、二维码解码与导出,以及编辑器与输入控件体验优化',
      en: 'Rebuilt regex tester, multi-tab workspaces for text compare and Markdown preview, merged JSONPath and text statistics, QR decode and export, plus editor and input-control polish',
    },
    changes: [
      {
        category: 'feature',
        description: {
          zh: '正则测试工具重构增强:新增 Rust 后端(regex_lab)一次调用返回 匹配/解释/替换/分组/耗时 全量数据;界面改为主区三栏布局(编辑器 | 模式工作区 | 解释+快速参考),新增逐 token 解释树、可搜索并点击插入的快速参考、匹配条目 hover 与编辑器选区联动,支持正则单元测试(用例集一键运行)与代码生成',
          en: 'Rebuilt regex tester with a Rust backend (regex_lab) that returns match/explain/replace/group/timing in one call; the UI becomes a three-pane layout (editor | mode workspace | explain+quick reference), adding a per-token explain tree, a searchable click-to-insert quick reference, matcher/editor hover-selection linking, regex unit tests (one-click case runs) and code generation',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '文本比较与 Markdown 预览多 Tab 化:二者工作区对齐 JSON 格式化器多文档 Tab 栏,支持文档增删/固定与持久化、激活 Tab 自动滚入视野、悬浮横向滚动条、关闭确认小 Popover 与键盘导航,多文档间互相独立',
          en: 'Text compare and Markdown preview gain multi-tab document workspaces modeled on the JSON formatter: add/remove/pin/persist docs, active-tab auto-scroll-into-view, floating horizontal scrollbar, popover close confirmation and keyboard navigation',
        },
      },
      {
        category: 'feature',
        description: {
          zh: 'JSON 格式化器整合 JSONPath 查询:新增 文本/树/JSONPath 三视图,提供表达式输入、结果展示与复制,删除独立的 JSONPath 测试工具;并新增转义/去除转义功能',
          en: 'JSONPath querying integrated into the JSON formatter with a text/tree/JSONPath view switcher (expression input, results and copy); the standalone JSONPath tester was removed; escape/unescape transforms were added',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '文本处理工具合并文本统计:编辑器底栏新增去空白字符指标与一键复制统计汇总,删除独立文本统计工具;并新增去除转义功能',
          en: 'Text statistics merged into the text processor: the editor bottom bar adds a chars-no-spaces metric and a copy-stats action, replacing the standalone text statistics tool; an unescape transform was added',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '二维码工具新增解码与导出:可粘贴/打开二维码图片解析内容并复制,支持 PNG / SVG 格式下载导出',
          en: 'QR code tool adds decoding and export: paste or open an image to decode and copy its content, and download the QR as PNG or SVG',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '全局及编辑器内链接可点击处理:气泡/提示内的链接可直接点击打开',
          en: 'Clickable links across the app and inside the editor: links in tooltips and inline hints open directly',
        },
      },
      {
        category: 'feature',
        description: {
          zh: '输入控件视觉增强:输入框/多行/下拉/字体选择器统一提升边框对比度与背景层级,解决弱对比下难以分辨的问题',
          en: 'Enhanced input control visuals: input/textarea/select/font picker raise border contrast and background distinction so controls stay clearly visible',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复编辑器切换文件时 Monaco "Unbound disposable" 上下文导致的渲染错误',
          en: 'Fixed a Monaco "Unbound disposable" context render error when switching editor files',
        },
      },
      {
        category: 'fix',
        description: {
          zh: '修复全局搜索文本模式的专属无障碍描述;保留 codicon 图标资源防止构建误删导致图标缺失',
          en: 'Fixed a dedicated accessibility label for search text mode; preserved codicon icon assets so builds no longer drop them and break icons',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '命令面板与编辑器语言选择器统一重构为 QuickPick 组件,统一弹出的命令对话框弹层并优化交互体验',
          en: 'Command palette and the editor language picker were unified onto a shared QuickPick component, consolidating the command dialog and improving interaction',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '标题栏布局调整:品牌居左、工具名居中;窗口控制图标重绘为 Windows 11 风格;统一 title 提示与查找组件浮层样式',
          en: 'Titlebar layout adjusted: brand left, tool name centered; window control icons redrawn in a Windows 11 style; unified title tooltips and find-widget overlay styling',
        },
      },
      {
        category: 'refactor',
        description: {
          zh: '侧边栏固定的文本编辑器支持在新窗口打开;多个工具(CodeEditor 标题栏等)固定高度与输入控件样式进一步统一',
          en: 'The pinned text editor in the sidebar can open in a new window; CodeEditor title-bar heights and input-control styles were further unified across tools',
        },
      },
      {
        category: 'chore',
        description: {
          zh: '新增 Rust regex_lab 模块(匹配/解释/替换/单测/代码生成/调试)并配套 IPC 命令与单测',
          en: 'Added the Rust regex_lab module (match/explain/replace/tests/codegen/debug) with IPC commands and unit tests',
        },
      },
    ],
  },
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
