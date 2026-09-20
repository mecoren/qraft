# Changelog

All notable changes to Qraft will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.4] - 2026-09-20

### Added

- 编辑器缩进统一收口到设置:文本编辑器新增「缩进字符」(空格 / Tab),JSON 格式化器新增「使用 Tab 缩进」开关
- 文本编辑器与 JSON 格式化器支持按文件 / 文档单独覆盖缩进方式与宽度:覆盖后本文件不再跟随全局设置,只有改动设置才会影响其余文件;编辑器状态栏缩进菜单新增「跟随设置」清除覆盖,JSON 格式化器顶部新增文档级缩进选择器(跟随态标注当前全局值)

### Changed

- JSON 格式化器前后端分流阈值按实测从 200KB 提升到 2MiB(2MiB 以内前端 `JSON.stringify`,超过交 Rust 执行),并消费后端随 `extra` 返回的结构统计,不再重复解析一遍输出
- Rust JSON 工具收敛:`sort_keys` 改为递归排序、缩进参数归一化(与前端同口径,非法值统一回落 2 空格)、删除不可达的流式路径

### Fixed

- 修复制表符缩进的 JSON 文档被误判语法错误、以及「一键修复」在这类文档上失效:诊断与修复把 Tab 计入 JSON 空白字符
- 修复设置页的 JSON 缩进偏好保存后工具侧不生效,以及缩进宽度在前后端分流两侧输出不一致(0 等非法值统一回落)

## [0.3.3] - 2026-09-19

### Added

- 文本编辑器感知文件的外部变更:后端新增 `notify` 父目录 watcher(`fs_watch_open_files` 注册 + `fs:external-change` 事件),打开的文件被其它程序改写或删除时 toast 提示;事件只带路径,是否算外部修改由前端按 mtime 基准复核,并保留激活时比对作为 watcher 不可用 / 离线改动时的兜底
- 文件在打开后被外部删除时保存不再失败:后端把「文件已消失」单独分流为 `ERR_FILE_NOT_FOUND`,前端去掉并发校验基准重试一次、在原路径重建文件,提示语换「已重新创建」

### Changed

- 保存链路全面改原子写入(目标同目录临时文件 + fsync + rename):覆盖写回、按编码保存、另存为与 `history.jsonl` 裁剪不再因磁盘满 / 崩溃残留半截文件,历史裁剪改为写成功才更新计数
- 编辑器工作区持久化防抖按载荷大小自适应(500 / 2000 / 5000ms,与 JSON、文本比较、Markdown 同策略);Rust 侧 `config_set` 去掉为拼事件 payload 而做的整份配置预读,`tool_prefs.<name>` 增加 HashMap 直写快路径
- 大文件行索引扫描与全文搜索按 scanId 支持取消,切 Tab / 关闭视图后不再继续空跑
- 打开拖放与系统关联进来的文件合并为一次读取(不再先探测二进制再重读)
- 「检查更新」从设置页迁入「关于」弹窗,改为版本徽标行的胶囊小按钮
- `EditorWorkbench.tsx` 按内聚块拆为 11 个 hook 与子组件(约 2400 行降至约 940 行,行为不变)

### Fixed

- 修复保存丢脏竞态:异步落盘期间的新输入不再被误判已保存(Markdown 编辑器按写入快照回写、代码编辑器 `markSaved` 收写盘快照、PDF 编辑器用编辑序号 `rev` 守卫)
- 修复编辑器逐键性能:状态栏统计经 deferred 降级、码点计数零分配、JSON 探测只解析头部、Monaco options 稳定引用,消除每次按键的全文 O(n) 扫描
- 修复大文件读取错行:前后端校准点统一为 `{ line, offset }` 对象(原按元组消费致锚点恒退到 offset 0),行窗口缓存按 `path:lineCount` 分片 LRU 防跨文件串台,Rust 行窗口读取由逐字节热循环改为按块批量扫描
- 修复 Monaco model 池化下的全局泄漏:工作台卸载时释放 `inmemory://tab/*` model
- 修复设置项写入恒失败:前端配置键名与 Rust 线格式不一致(`toolPrefs` / `fontSize` / `maxHistory` / `confirmOnClear` 实为 `tool_prefs` / `font_size` / `max_history` / `confirm_on_clear`),`config_set` 报 `invalid config path` 且读侧静默取默认值;工具偏好(如 JSON 缩进)改按整槽写入以保留同槽其它偏好

## [0.3.2] - 2026-09-18

### Changed

- 文本比较与文件对比的并排差异算法改用 Monaco 原生 `advanced`:常驻隐藏 `DiffEditor` 优先计算(字符级 `innerChanges`),不可用/超时回退 jsdiff 同步/Worker 快慢路径;分组与词级精度与行内原生 DiffEditor 同源,同 hunk 内无关增删不再被硬配成"修改行"

### Fixed

- 修复并排模式下词级高亮丢失:删除行被语义配对到非相邻新增行(中间夹纯插入)时,余量行此前按位置窗口裁剪会丢掉行内高亮,现按 `charChanges` 绝对行号覆盖整块渲染,与 VSCode 原生 DiffEditor 对齐
- 移除旧的 `src/lib/diff.ts`,差异计算统一到 `text-diff` 服务

## [0.3.1] - 2026-09-16

### Added

- Markdown 编辑器全面升级(TipTap 所见即所得内核):多 Tab 文档管理与持久化、富文本格式工具栏与快捷键、分栏/编辑/预览三视图、大纲导航、打字机/专注写作模式、本地草稿自动保存、表格/代码块/公式/Mermaid 图渲染、图片预览与远程图片加载控制、导出 HTML/Markdown/打印/PDF、文件打开/保存/重命名与冲突处理、中英双语完整覆盖
- JSON 格式化器六项增强:嵌套层级展开/折叠、Unix 时间戳与日期互转、JMESPath 查询、对比视图双侧展示、历史记录固定(pin)、剪贴板内容一键填充

### Changed

- Markdown 预览工具重构为 Markdown 编辑器(toolId 由 `markdown_preview` 改为 `markdown_editor`),新增旧 ID 迁移逻辑,兼容既有收藏与历史记录

### Fixed

- 修复 `pnpm tauri dev` 偶发空等前端:Vite dev server 强制监听 IPv4,避免 localhost 解析到 IPv6 时 Tauri 连不上 devUrl

## [0.3.0] - 2026-09-15

### Added

- Markdown 预览六批增强(渲染管线 + 预览交互):
  - hljs 代码块 LRU 缓存(300 条 / 4MB,两阶段渲染 fast→complete 消除重复高亮开销)
  - 图片尺寸语法 `![alt](src.png "=300x200")`(宽高可单边,尺寸段从 title 末尾剥离)+ DOMPurify 白名单放行 width / height
  - 任务列表勾选写回源码(Typora 点击即勾选,精确替换对应源行 `[ ]`↔`[x]`)
  - 拖拽图片文件到编辑器位图落盘并插入 mdasset:引用(Monaco 容器层截获)
  - 预览区复制即 Markdown 源码(Typora 行为,选区 HTML 经 turndown 回转写入剪贴板)
  - 图片 Ctrl+滚轮文内缩放(首次锚定 naturalWidth,等比 ±15% / 步,clamp 10%–600%)
- ScrollArea 横向模式原生滚轮直通:Chrome 标签栏 / VSCode Tab 栏同款行为,纵向 delta 自动转横向滚动;无溢出不吞滚轮,已溢出时滚到两端也吞事件避免穿透到底下内容

### Changed

- Office Excel 工作表条从原生 overflow-x-auto 换成共享 ScrollArea 横向模式(悬浮细条 + 滚轮直通)

### Fixed

- 修复 SearchDialog 全量并行下「打开/输入时不自动高亮」测试 flaky(cmdk 内部 activeIndex 与 DOM 渲染顺序存在时序窗口,断言从 `selected === options[0]` 改为语义验证)
- 修复 ToolPanel keepalive 测试全量并行超时(Monaco 懒加载串行 3 次在多 worker 抢 CPU 下超过 10s,放宽 LAZY_TIMEOUT 到 20s)

## [0.2.9] - 2026-09-15

### Added

- Markdown 预览工具文件能力补全:左上角「文件」菜单(新建/打开/保存/另存为/关闭)+ Ctrl+O / Ctrl+S / Ctrl+Shift+S 快捷键;打开的文档绑定磁盘路径直接写回,保存带 mtime 乐观校验(外部修改时弹覆盖/对比/重读三选);拖放与系统关联打开的 .md 文档同样绑定路径;Tab 名展示文件名、未保存改动带 dirty 圆点;切回 Tab 时检测到外部修改提前 toast 提示;关闭有未保存改动的文档走三选确认
- 工具级标题栏菜单系统(toolMenubarStore):工具可向标题栏注册自己的菜单(首个接入者 Markdown 预览「文件」菜单),keepalive 多工具并存时按激活归属正确展示/重放/清理
- useToolShortcut 工具级快捷键守卫:keepalive 常驻工具的同类绑定不再互相误触,仅激活工具响应且非激活侧放行事件;文本编辑器与 Markdown 预览的 Ctrl+S 等编辑类快捷键接入

### Changed

- 内存优化批次:新增字节 + 条数双上限 LRU 缓存模块,Markdown 渲染链的 KaTeX 公式 / Mermaid SVG / 图片资产 data URL 三个缓存从「满额全清」改为逐条淘汰(热条目不再被全清丢掉,大图缓存受 32MB 字节上限约束);工具页 keepalive 容量改为加权 LRU(内嵌 Monaco 的重型工具占 2 名额,Monaco 实例总量减半);流式任务完结即释放累计 chunk(数十 MB 输出不再驻留)
- mermaid 改官方分块入口按需加载:30+ 图表实现从 3.5MB 单包拆为按图种类的独立小 chunk,渲染哪种图才下载哪种实现,冷启动与首图渲染内存显著下降;空闲预取不再拉整包

### Fixed

- 修复 KaTeX 渲染输出配置拼写错误(htmlAndmathml → htmlAndMathml):此前配置从未生效,一直使用缺省输出模式
- 修复版本发布脚本 bump-version.sh 在 Windows Git Bash 下多行内联 node -e 静默失效的问题(package.json / tauri.conf.json 不被更新),改写为临时 .cjs 脚本执行

## [0.2.8] - 2026-09-14

### Added

- 新增 TOML 格式化器(toml_formatter):Rust 侧 Taplo 引擎 Document 级往返,保留注释/数组换行/表头结构;缩进 2/4 空格、键值对齐、键排序;非法输入给出行列定位 chip 可一键跳转
- 新增 YAML 格式化器(yaml_formatter):Document 级往返保留注释/锚点/块标量/多文档结构;缩进 2/4 空格、minify 单行压缩、递归键排序;错误行列定位 chip 与统计徽章
- 新增图片元数据查看器(image_metadata):PNG/JPEG/WebP/GIF/BMP 五格式字节直读,EXIF 相机字段分组展示,左右分栏拖放预览,一键复制报告;纯前端本地解析零 IPC
- 新增公钥解析器(public_key_decoder):RSA/EC/Ed25519 公私钥 PEM 本地解析,SPKI/PKCS#8/SEC1 三层 ASN.1 直解,展示算法/位数/曲线/模数与 SPKI SHA-256 指纹(与 openssl 口径一致);私钥不出本机
- 新增视频转 GIF 工具(video_to_gif):时间轴片段截取、帧率与输出宽度可调,自研 GIF89a 编码器(中位切分调色板 + LZW,零新依赖)
- 新增文本比较工具(text_compare):EOL 归一、差异导航 F7、行内差异与未变更区折叠、相似度统计、导出 .patch、WinMerge 式差异块逐块拷贝、忽略行尾空白与大小写选项、对齐式同步滚动;拖放填充与大文件防护
- 剪贴板智能识别升级为 Smart Detection:嗅探 8 种格式(新增完整 URL→二维码、时间戳、hex 哈希摘要),无歧义格式置顶;主区顶部提示条一键跳转目标工具并预填剪贴板原文,证书/JWT/时间戳三工具已接接收端;默认关闭、关闭态零剪贴板读取不变
- 文本编辑器四批次升级:
  - 位置历史(Alt+方向键,时间-行距合并 + 跨 Tab 恢复)、文件对比交换/导出补丁接入工作台、Tab 栏溢出下拉
  - 编辑器设置面:设置→文本编辑器新增「编辑器展示」区(括号着色/缩进参考线/缩略图/字号等 7 项热更新)
  - 文件树右键新建/重命名/删除(AuthorizedPaths 沙箱校验、重名冲突不覆盖、子树内已开 Tab 自动重定向)
  - 跨文件查找替换(正则 $1 反向引用,替换仅写内存经保存流程落盘可撤销);大文件搜索大小写口径切换;Tab 激活时外部修改轮询提示
- 文本处理工具全面增强:查找替换/提取器(URL/邮箱/IP/日期预设)/词频统计、全角半角转换、行编号、自然排序等纯函数库(text-ops);列表比对器新增计数模式
- 命令面板/侧栏/全局搜索升级 fzf 风格模糊匹配:子串优先档 + 缩写子序列兜底,`jsf` 这类缩写直达 JSON 格式化器;零新依赖,三处搜索同口径
- PDF 编辑器页面级操作:页码范围提取为新 PDF、页面导出 PNG/JPEG、Tab 栏「合并全部」
- 图片转换器与 PNG 压缩器支持多文件批量处理(共享队列/失败不中断/节省统计);哈希工具新增文件模式(流式分块 + 取消)
- 正则工具常用模板库:24 模板 × 5 分类,前端面板与 Rust 集成测试共读单一 JSON 数据源
- Base64 解码默认宽松化(剔空白/补 padding/嗅探字母表)并保留严格模式开关;重复行检测器支持 TSV 导出

### Fixed

- 六工具巡检修复:QR 码生成失败不再静默(超容量显式失败占位)、UUID 数量兜底与快捷键接线、密码熵计算与易混淆池同源、乱数假文重新生成按钮与数量钳制
- FolderAnalyzer 纯浏览器环境挂载崩溃修复;颜色转换器结果区改可拖分栏
- CSV/TSV 下载统一前置 UTF-8 BOM,Excel 双击打开中文不再乱码

### Changed

- 性能指标体系落地:criterion 引擎基准(小输入 23.6µs / 1MB 38.9ms)、IPC 执行路径基准(1MB 实测 17.9-28.8ms,两倍余量)、release 冷启动热缓存 164ms 与主进程 33MB 全部达标;主二进制接入 mimalloc 分配器;PRD 18 DevToys 差距表全部勾销收官
- 输入框等非编辑器控件统一 UI 字体;ConfigRow 落地 caption 微标签与弹性布局契约

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

[0.3.4]: https://github.com/qraft/qraft/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/qraft/qraft/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/qraft/qraft/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/qraft/qraft/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/qraft/qraft/compare/v0.2.9...v0.3.0
[0.2.9]: https://github.com/qraft/qraft/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/qraft/qraft/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/qraft/qraft/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/qraft/qraft/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/qraft/qraft/compare/v0.2.2...v0.2.5
[0.2.2]: https://github.com/qraft/qraft/compare/v0.2.0...v0.2.2
[0.2.0]: https://github.com/qraft/qraft/compare/v0.1.5...v0.2.0
[0.1.5]: https://github.com/qraft/qraft/compare/v0.1.2...v0.1.5
[0.1.0]: https://github.com/qraft/qraft/releases/tag/v0.1.0
