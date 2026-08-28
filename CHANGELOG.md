# Changelog

All notable changes to Qraft will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-28

### Added

- 工具弹出新窗口(pop-out,对标 DevToys 2.0):任意工具可弹出为独立系统窗口,弹窗加载同一前端入口(`index.html?popout=<toolId>`)的轻量根组件 PopoutApp;快照式状态一致性——弹窗与主窗口共享 localStorage 持久层,关闭弹窗时把弹窗内的最后编辑回写主窗口(主窗口据此重新水合);三处入口:标题栏工具名旁弹出按钮、命令面板「在新窗口打开当前工具」、侧栏工具右键菜单;每工具单实例(重复打开自动聚焦);text_compare / text_editor / markdown_preview 预置窗口尺寸;9 个 capability 文件追加 `popout-*` 窗口通配放行 IPC
- 文本比较工具全量重构:对齐 JSON 格式化器工作区样式(多 Tab 增删与持久化、按输入内容派生 Tab 名),移除全屏功能;差异展示与 VSCode 原生 DiffEditor 对齐——行级红/绿背景、词级强调色高亮、行号槽左缘色条+行号加粗、右缘概览标尺红/绿刻度
- 新增共享差异对比视图组件 TextDiffView(双编辑器并排/行内布局、差异高亮、统计徽标 +n/−n/~n、同步滚动、行内模式修改侧可编辑),文本比较工具与文本编辑器「文件对比」共用;文件对比按文件扩展名自动推断语言(替代硬编码纯文本)

### Changed

- 差异计算 Web Worker 化:TextDiffView 的差异计算迁移至 Web Worker(小输入走同步快路径,阈值 30k 字符),大文档对比不再阻塞 UI(实测长任务 140 次/54s → 0 次)
- 全量工具样式统一至 JsonFormatter 基准:统一工具 shell 样式(圆角边框卡片、扁平顶部配置区 ConfigSection、滚动内容区、次级卡片规范),40+ 工具面板视觉一致
- 系统级文件打开与 hydrate 合并:从系统/文件关联打开文件时不再清空编辑器的打开文件列表,改为与持久化历史 Tab 合并水合(修复关闭项目后打开其他文件导致 Tab 列表丢失的问题);新增 openLocalFileFromSystem 入口区分用户主动与系统自动打开
- 移除 url_codec 独立工具:URL 编码/解码能力整合进 JSON 格式化器(JsonFormatter),并同步更新剪贴板智能探测、工具目录、搜索锚点与测试
- 编辑器未保存确认由居中对话框(AlertDialog)改为锚定小 Popover,与关闭 Tab/清空历史/删除单条历史三处确认交互统一

### Fixed

- 修复 Rust clippy `redundant-clone` 警告(弹窗销毁事件广播载荷),CI `-D warnings` 门禁通过
- 全量代码通过 Prettier 格式检查与 ESLint,22 个文件完成格式统一

## [0.1.5] - 2026-08-27

### Added

- 界面中英双语(i18next 全量落地):设置页新增界面语言切换;侧栏/命令面板/设置/关于/欢迎页/全局搜索锚点及全部工具面板文案双语;文本编辑器全组件(Tab 栏/右键菜单/左侧栏/Diff 视图/未保存对话框)双语;目录元数据 LocalizedText 与搜索索引双语命中(语言切换后重建);Monaco 内置 UI 随应用语言切换
- 新增 5 个工具:文本统计(字符/词数/行数/字节)、ULID 生成器(Crockford Base32,时间有序)、Basic Auth 生成器(UTF-8 安全)、IPv4 子网计算器(离线本地计算)、JSON↔CSV 转换器(RFC 4180 状态机解析)
- 跨工具传值(send-to):输出区新增发送菜单与接收通道,JSON 格式化器/Base64 转换器/哈希计算器率先接入
- 剪贴板智能探测(smart-detect,默认关闭 opt-in):探测剪贴板类型(JSON/JWT/Base64/PEM/URL),命中时在命令面板给出推荐
- 工具全局快捷键:全局接线 Ctrl+Enter 执行 / Ctrl+L 清空 / Ctrl+Shift+C 复制,配套工具动作注册表(execute/clear/copy);JSON 格式化器、Base64 转换器、哈希计算器等已接入
- 文本编辑器增强:Markdown 分屏预览与视图模式切换、状态栏实时文件大小(B/KB/MB/GB)、Tab 支持重命名与固定、编辑器字号跟随设置档位
- 文件夹分析器界面落地:扫描/搜索/单文件解析三模式结果面板(shadcn 表格 + Monaco 查看器)、拖入路径只读授权、流式任务防串扰

### Changed

- 收藏工具平铺至固定「文本编辑器」下方,去除收藏夹分类分组;固定编辑器不可收藏
- 性能优化:启动性能与 UI 打磨、大输入路径降阻塞与写放大治理(release 启用 LTO/strip)、ToolPanel keepalive 引入 LRU 容量上限、copy-monaco 裁剪不可达产物、空闲期预取 Markdown 工具重型 chunk;建立 json_formatter criterion 基准与 Windows 冷启动/内存基线测量脚本并挂钩发布清单
- 7 个工具的本地 formatError 收口为共享模块,统一 Rust 错误前缀剥离
- 全局搜索海量命中护栏:单文件/全局收集上限、截断标记、超长行预览窗口与高亮范围限制

### Fixed

- 文本编辑器 Esc 键行为修复:快捷键监听改为可放行(return false 不再阻断传播),无面板打开且焦点在编辑器时 Esc 正确交给 Monaco 关闭查找替换框;Monaco 查找框关闭按钮悬浮提示改由捕获阶段委托监听抑制,避免与 HMR 冲突
- 快捷键忽略长按自动重复事件(e.repeat),防止连发
- 工具执行历史落库与 history_added 事件链路打通
- 自定义 accent 颜色对比度防护与复制反馈统一
- 测试并行抖动治理(超时窗口放宽至 10s)

### Security

- 接入 pnpm audit 门禁并升级 dompurify
- 支持 prefers-reduced-motion 减弱动态效果(a11y)

## [0.1.0] - 2026-07-25

### Added

- 三层架构(Rust Core / Tauri Shell / React UI),依赖方向单向向下
- `Tool` trait 与 `ToolRegistry`(`inventory` 编译期注册)
- `ToolExecutor`(超时隔离 + panic 隔离)
- `ConfigStore` 与 `HistoryStore`(应用专属目录,原子写入)
- 10 个 P0 工具:
  - `json_formatter`:JSON 美化与压缩
  - `json_minifier`:JSON 压缩至单行
  - `base64_codec`:Base64 编码/解码
  - `url_codec`:URL 编码/解码
  - `jwt_parser`:JWT header/payload 解析
  - `uuid_generator`:UUID v4 生成
  - `hash_calculator`:MD5/SHA-1/SHA-256/SHA-512/BLAKE3
  - `timestamp_converter`:Unix 时间戳与日期互转
  - `color_converter`:HEX/RGB/HSL 互转
  - `regex_tester`:正则匹配与捕获组展示
- React UI:侧边导航、Split View 工具面板、命令面板(Ctrl+K)、历史记录面板、设置面板、暗色主题
- Tauri Shell IPC:工具执行、配置、历史、剪贴板、文件系统(授权路径)、应用级
- 安全机制:CSP `default-src 'self'`、文件系统授权路径、剪贴板显式触发、零网络原则(仅 updater 例外)
- Tauri Updater 自动更新(签名验证)
- 三平台打包:Windows NSIS+MSI、macOS DMG Universal Binary、Linux AppImage+deb
- GitHub Actions CI/CD:PR 构建验证 + tag 触发三平台矩阵发布
- SBOM 生成(CycloneDX,Rust + npm)并附加到 Release
- `cargo audit` + `pnpm audit` 强制审计(漏洞阻止发布)
- 发布前冒烟测试 Checklist(`docs/release-checklist.md`)
- 版本号同步脚本(`scripts/bump-version.sh`)

### Performance

- 冷启动时间 <500ms
- 空闲内存 <150MB
- 10MB JSON 解析 <500ms
- 包体积 <30MB(三平台)

### Security

- Tauri Updater 签名验证(ed25519)
- MVP 阶段:Windows/macOS 使用占位签名(ad-hoc),正式发布需 EV 证书与 Apple Developer ID

[0.2.0]: https://github.com/qraft/qraft/compare/v0.1.5...v0.2.0
[0.1.5]: https://github.com/qraft/qraft/compare/v0.1.2...v0.1.5
[0.1.0]: https://github.com/qraft/qraft/releases/tag/v0.1.0
