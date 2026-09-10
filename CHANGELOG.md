# Changelog

All notable changes to Qraft will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.7] - 2026-09-10

### Added

- 新增 4 个加密安全域工具:NanoID 生成器、HMAC 计算器、TOTP/HTOP 一次性密码(OTP)生成器、AES 加解密;左右分栏布局,RFC 官方测试向量保障正确性
- Markdown 编辑器全量升级:聚焦模式、远程图片加载开关;GitHub 警报、==高亮==、Front Matter、emoji 短码等扩展语法;本地图片资产系统(粘贴截图自动保存、`mdasset:` 引用解析);另存 Markdown、打印导出 PDF;双击预览跳转编辑器对应行(VSCode 式联动)
- 文件本地历史:覆盖保存前由 Rust 快照旧内容,每文件保留 20 版;Tab 右键「历史版本」列出快照,支持对比当前、恢复内容、清空历史;清空前二段确认防误删,列表支持完整键盘操作(↑↓ 循环移动、Home/End 跳首末、Enter 直接开对比)
- 保存前 mtime 乐观校验:文件被外部程序修改后拒绝盲目写入,冲突时弹出覆盖 / 对比 / 重读三选,数据安全闭环
- 文本编辑器 10GB+ 大文件流式全文搜索:Rust 跨块流式扫描(大小写不敏感),进度事件 + 命中计数徽章,点击命中项虚拟定位跳转
- 全局文本搜索补齐匹配选项:大小写敏感、整词匹配、正则三切换钮,统一口径贯通列表、行内高亮与编辑器 decoration;正则模式实时纠错,非法正则与「确实无匹配」区分提示
- 文本编辑器快捷键批次:菜单九键真绑定(保存 / 关闭 Tab / 切换 Tab 等)、Ctrl+Tab 标签导航、恢复关闭标签栈(Ctrl+Shift+T)
- Monaco model 池化:切 Tab 不再重挂载编辑器,undo 栈与视图状态跨切换存活,关闭 Tab 才释放 model
- JSON 格式化器四连增强:
  - 错误定位与修复:零依赖扫描器定位 11 类错误到行列,编辑器波浪线跳转 chip,显式修复按钮如实呈现修复报告(歧义输入拒绝猜测)
  - 统计面板:单遍历输出节点/数组/字符串等结构统计,大数字丢精度警示条,格式化主路径接入统计徽标
  - 转换菜单新增 CSV 输出:对象数组经 RFC 4180 序列化导出,列取键并集
  - 树视图增强:行内 JSONPath 复制按钮,URL / 颜色 / 日期内容推断预览 chip(色块内联渲染、点击复制原值)

### Fixed

- 修复 URL 解码把 query 段 `+` 误留为字面加号的问题:按表单语义还原为空格,path 字面 `+` 保留,`%2B` 仍可解出字面加号
- 修复后端 JSON 格式化键序重排:serde_json 启用 preserve_order,与前端 JSON.stringify 保持插入序一致
- 修复 JSON 显式修复后输入框波浪线报错残留;报错 chip 紧凑化(L3:C3 格式),窄窗口下标题栏溢出按钮不再裁切
- 修复 WebView2 下编辑器标题栏动作区竖向滚动条常驻、按钮被挤 0 宽的问题

## [0.2.6] - 2026-09-07

### Added

- PDF 编辑器(新工具):多 Tab 阅读、AcroForm 表单填写与导出(扁平化)、文本标注叠加编辑(矩形/高亮/自由画笔/文字),系统打开 .pdf 文件分流至该工具;标注坐标归一化为页内比例,缩放后不错位
- Office 文档编辑器(新工具):Excel(.xlsx)多 Sheet 查看、单元格定位与截断列完整展示;Word(.docx)段落文本编辑并导出 docx;文件关联新增 pdf/docx/xlsx 等扩展
- 文本编辑器 10GB+ 大文件只读查看:Rust 侧行索引扫描 + 锚点式行窗口按需读取,前端虚拟滚动平滑浏览;文本探测对齐 VSCode(修复 .dat/UTF-16 等文件无法打开);三入口二进制兜底「仍要打开」与大文件保护
- NSIS 安装版自动更新:更新器区分安装类别,系统安装版不再被误导跳转手动下载
- JSON 格式化器多格式输入:支持 YAML / TOML / JSON5 / Properties / URL 参数输入嗅探并转为 JSON 处理,移除独立 JSON↔YAML 工具
- 六个纯前端工具对标成熟方案全面升级:Cron 解析器(五字段描述 + 下次执行时间)、IPv4 子网计算器、JSON 数组表格、JSON↔CSV 转换器、数字进制转换器、IP 解析器
- 证书解码器结构化重构:分区卡片、状态徽章、自签名检测、ASN.1 全文展示
- GZip 工具新增文件模式:拖入文件压缩/解压并下载 .gz 产物
- HTML 编解码三级编码模式与自实现实体解码器;Basic Auth 双向化(解码 + 生成);JWT 解析纯前端实时化(对标 jwt.io);SQL 格式化方言扩至 12 种并支持 minify 与 Tab 缩进;XML 序列化保留声明/DOCTYPE/CDATA;XML XSD 校验接入 xmllint-wasm(真实 libxml2);图片转换器缩放/背景合成/质量滑杆;PNG 压缩器并排对比视图
- 时间戳/颜色转换器实时化并增强 Rust 后端解析(支持更多输入格式)

### Changed

- 证书解码 / GZip / HTML / JWT 四工具改为左右分栏布局;正则测试工具三栏标题栏统一至 26px 项目基准;二维码模式切换改为配置行分段控件
- 输入框统一改用界面字体,仅编辑器保留代码字体
- Office / PDF 编辑器打开入口统一 FolderOpen 图标,Tab 栏改悬浮细滚动条
- 历史弹窗焦点控制优化;分隔条高亮恢复为仅自身悬停点亮

### Fixed

- 修复 Base64 工具 Radix ScrollArea 打断高度链导致的预览异常;文件区/预览区标题栏固定 26px 与工具栏恒等高
- 修复窄屏下文本编辑器路径面包屑换行溢出工具栏、遮盖 Tab 栏的问题
- 修复 IPC 嵌套 Tool 错误载荷未归一化,导致前端丢失真实错误消息的问题
- 修复 cmdk 结果集重挂载后自动高亮首项的污染(自增哨兵强制重置内部 value)
- 修复 Excel 切表内容错乱与列截断
- 适配 react-resizable-panels v4,修复纵向面板组白屏

## [0.2.5] - 2026-09-03

### Added

- 正则测试工具重构增强:新增 Rust 后端(regex_lab)一次调用返回匹配/解释/替换/分组/耗时全量数据;界面改为主区三栏布局(编辑器 | 模式工作区 | 解释 + 快速参考),新增逐 token 解释树、可搜索并点击插入的快速参考、匹配条目与编辑器选区联动,支持正则单元测试(用例集一键运行)与代码生成
- 文本比较与 Markdown 预览多 Tab 化:对齐 JSON 格式化器多文档 Tab 栏,支持文档增删/固定与持久化、激活 Tab 自动滚入视野、悬浮横向滚动条、关闭确认小 Popover 与键盘导航
- JSON 格式化器整合 JSONPath 查询:新增 文本/树/JSONPath 三视图,删除独立 JSONPath 测试工具;并新增转义/去除转义功能
- 文本处理工具合并文本统计:编辑器底栏新增去空白字符指标与一键复制统计汇总,删除独立文本统计工具
- 二维码工具新增解码与导出:可粘贴/打开二维码图片解析内容并复制,支持 PNG / SVG 下载
- 全局及编辑器内链接可点击处理
- 输入控件视觉增强:输入框/多行/下拉/字体选择器统一提升边框对比度与背景层级

### Changed

- 命令面板与编辑器语言选择器统一重构为 QuickPick 组件,统一弹层交互
- 标题栏布局调整:品牌居左、工具名居中;窗口控制图标重绘为 Windows 11 风格
- 侧边栏固定的文本编辑器支持在新窗口打开;多工具标题栏高度与输入控件样式统一

### Fixed

- 修复编辑器切换文件时 Monaco "Unbound disposable" 上下文渲染错误
- 修复全局搜索文本模式的专属无障碍描述;保留 codicon 图标资源防止构建误删

## [0.2.2] - 2026-08-29

### Added

- Windows 文件关联图标与应用内视觉统一:资源管理器中的关联图标改为与「打开的编辑器」标签栏同一套 material-icon-theme 图标(同一批 SVG,经 `scripts/generate-file-icons.mjs` 生成 16–256 七尺寸 ICO);文件关联按语言拆分为 22 个 ProgID(json/md/csv/log/xml/yaml/toml/配置/js/ts/jsx·tsx/py/rs/go/java/c/cpp/shell/sql/vue/svelte/txt),每个 ProgID 的 `DefaultIcon` 与应用内 `getFileIconName` 映射一一对应;安装完成广播 `SHCNE_ASSOCCHANGED` 即时刷新;历史遗留的 "Source Code File" 分组 ProgID 在安装/卸载时自动清理

### Changed

- NSIS 安装器改用项目定制模板 `src-tauri/windows/installer.nsi`(基于 tauri-cli v2.11.4 官方模板):检测到已安装旧版本时跳过「Uninstall before installing / Do not uninstall」选择页,直接覆盖安装以保留用户配置与数据;从 WiX(MSI) 迁移场景仍保留卸载流程
- 安装器与卸载器界面图标显式配置为项目 `icons/icon.ico`,消除 NSIS 默认占位图标

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

[0.2.7]: https://github.com/qraft/qraft/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/qraft/qraft/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/qraft/qraft/compare/v0.2.2...v0.2.5
[0.2.2]: https://github.com/qraft/qraft/compare/v0.2.0...v0.2.2
[0.2.0]: https://github.com/qraft/qraft/compare/v0.1.5...v0.2.0
[0.1.5]: https://github.com/qraft/qraft/compare/v0.1.2...v0.1.5
[0.1.0]: https://github.com/qraft/qraft/releases/tag/v0.1.0
