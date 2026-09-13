# Image Metadata 工具实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增纯前端 `image_metadata` 工具:拖入/选择图片文件,本地解析 PNG/JPEG/WebP/GIF/BMP 的容器元数据(尺寸/位深/颜色类型/EXIF/chunk 表),左侧预览右侧结构化结果,PRD 18「Image Metadata」差距项闭环。

**Architecture:** 解析器 `image-metadata-utils.ts` 纯函数零依赖(DataView 直读字节),对五种格式做魔数嗅探分发;UI `ImageMetadata.tsx` 照 PngCompressor 的文件进入管线(拖放+选择,dataUrl 预览)但布局走 CertificateDecoder 式左右分栏(左预览右结果)。全部纯前端,`backendId` 缺省,不经 IPC。

**Tech Stack:** React 19 + Tailwind v4 + i18next;无新增 npm 依赖。

## Global Constraints

- toolId = `image_metadata`,三处一致(registry.ts / tool-catalog.ts / PRD 07 目录),纯前端无 `backendId`
- zh-CN 源语言,en-US 同步补齐(`src/en-locale-sweep.test.tsx` 强制)
- 双语 i18n 片段:`src/i18n/locales/tools/image_metadata.{zh,en}.json`,扁平全前缀键 `tools.image_metadata.*`
- 图标 Lucide(`ImageIcon` 已在 catalog 图标集),归 `graphic` 分类
- 搜索锚点在 `src/lib/search-anchors.ts` 声明并在组件标注 `data-search-anchor`
- 测试夹具为 Pillow/Node 真实生成的字节(base64 嵌入源文件),真值已预计算固化

## 夹具真值表(2026-09-13 一次性校准,测试断言直接引用)

| 夹具 | 来源 | 关键真值 |
|---|---|---|
| PNG | Pillow RGBA8 + dpi=(72,72) | 300x200, bitDepth 8, colorType 6(RGBA), interlace 0, pHYs 2835px/m → 72 DPI, chunk 序列 IHDR/pHYs/IDAT/IEND |
| JPEG(EXIF) | Pillow 640x480 纯色 | 640x480, APP0(JFIF)+APP1(EXIF) 并存;EXIF 端序 MM;Make=QraftCam, Model=QR-100, Orientation=6, DateTime=2026:09:13 10:00:00, ExposureTime=3500000/1000, FNumber=28/10, ISO=200, FocalLength=5000/1000, ExifVersion=0231 |
| WebP lossy | Pillow q=80 | 320x200, VP8 chunk;尺寸 LE32: w=bits0-13, h=bits16-29(经验布局,Pillow 4 组尺寸交叉验证) |
| WebP lossless | Pillow lossless | 320x200, VP8L chunk;sig 字节 0x2F + LE32(w14\|h14\|alpha1\|version3) |
| GIF | Pillow | GIF87a, 320x200, flags 0x81(GCT=4 色), bgIndex 0, aspect 0 |
| BMP | Pillow 24bpp | BITMAPINFOHEADER(40B), 320x200, 24bpp, fileSize 192054, dataOffset 54, 自底向上 |

Pillow EXIF 怪癖(已知宽容项):RATIONAL 写成 type=4 LONG 对(cnt=2),值区为 [num, den];标准相机 EXIF 是 type=5。解析器两种都按 num/den 渲染。

## Task 1: 解析库 image-metadata-utils.ts(TDD)

**Files:**
- Create: `src/tools/image-metadata-utils.ts`
- Test: `src/tools/image-metadata-utils.test.ts`

**Interfaces (Produces):**

```ts
export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp';
export interface PngTextEntry { keyword: string; text: string; compressed?: boolean; language?: string }
export interface ExifEntry { tag: string; name: string; value: string }   // name 为 i18n 键工具侧翻译或规范英文名
export interface ImageMetadataReport {
  format: ImageFormat;
  formatLabel: string;          // 'PNG' | 'JPEG' | 'WebP' | 'GIF' | 'BMP'
  width: number | null;         // 横向主尺寸(像素)
  height: number | null;
  bitDepth: number | null;      // PNG 位深 / WebP 8 / BMP bpp / GIF 无
  colorInfo: string | null;     // PNG 颜色类型名 / JPEG 分量数 / BMP 压缩名
  interlaced: boolean | null;   // PNG/GIF
  frameCount: number | null;    // GIF 多帧(webp 动画不做)
  animate: boolean | null;     // GIF
  transparency: boolean | null; // PNG alpha / GIF 有透明
  dpi: number | null;          // PNG pHYs / JPEG JFIF 密度
  backgroundColor: string | null; // GIF 全局色板背景色 hex
  exif: ExifEntry[];           // JPEG APP1 / WebP EXIF chunk
  textEntries: PngTextEntry[]; // PNG tEXt/zTXt/iTXt
  pngChunks: { type: string; bytes: number }[]; // PNG chunk 清单
  error?: string;              // 解析失败原因(非抛错)
}
export function parseImageMetadata(bytes: Uint8Array): ImageMetadataReport;
```

- 嗅探顺序:PNG 89 50 4E 47 → JPEG FF D8 → RIFF+WEBP → GIF87a/89a → BM;不识别返回 `error` 报告(format 兜 'unknown' 时 format 字段可空字符串——**改**:未知格式直接返回 `{ error }` 且 format 置 'png' 无意义;接口加 `unknown` 不进 union,**决定**:解析失败返回 `error` 非空 + format='png' 之外——最终定:`ImageFormat` 增 `'unknown'`,formatLabel '-')
- PNG:IHDR(尺寸/位深/颜色类型 0/2/3/4/6 → 灰度/真彩/索引/灰度+alpha/真彩+alpha/交错)+ pHYs(pixelsPerMeter → DPI 四舍五入)+ tEXt/zTXt(pako? **不引依赖**——zTXt 跳过解压只标注 compressed:true,值显示 `[zlib 压缩]` 占位?**否**:CompressionStream 在 jsdom 不稳,直接用 `DecompressionStream('deflate')` 在浏览器可用但 jsdom 测试不可用。**决定**:zTXt 尝试 DecompressionStream 失败则标注原文压缩;为保测试稳定,zTXt 解压走 try/catch 降级)。iTXt(UTF-8)。chunk 全表(超 200 chunk 截断)
- JPEG:遍历 SOI 后 marker:APP0 JFIF(密度单位/DPI)、APP1 EXIF('Exif\0\0' 前缀;TIFF 双端序 II/MM;IFD0 + ExifSubIFD 0x8769 指针;渲染常见 tag 白名单 ~30 个:Make/Model/Orientation(1-8 旋转名)/DateTime/ExposureTime/FNumber/ISO/FocalLength/ExifVersion/Software/Artist/GPS 白名单不做)、SOF0/1/2/…(尺寸+分量数)、DQT 等 skip。Pillow type=4 cnt=2 宽容按 num/den
- WebP:RIFF 头 + 四 chunk:VP8(经验布局 w=LE32&0x3fff, h=(LE32>>>16)&0x3fff, 偏移 sync 9d012a 后)、VP8L(sig 0x2F 后 LE32 低14 高14)、VP8X(canvas w/h 24-bit LE 三个 3 字节段 +EXIF 标志)、EXIF chunk 复用 JPEG TIFF 解析
- GIF:逻辑屏幕块(尺寸/GCT 标志/背景色索引/GCT hex)+ 遍历块找 Image Descriptor 计帧数 + Graphic Control(透明色 → transparency)
- BMP:'BM' + 文件大小 + dataOffset + DIB 头(BITMAPINFOHEADER 40;宽高 i32,高为负=自顶向下;bpp;压缩 0=BI_RGB)

- [ ] **Step 1: 写失败测试**(夹具 base64 常量 + 每格式 1-3 用例 + 未知格式 + 边界截断)
- [ ] **Step 2: `pnpm vitest run src/tools/image-metadata-utils.test.ts` 验证红**
- [ ] **Step 3: 实现解析库**(纯函数,单文件,内部小工具 u16/u32/LE/BE reader)
- [ ] **Step 4: 跑测试绿**
- [ ] **Step 5: Commit** `feat(imgmeta): 纯前端图片元数据解析库(五格式字节直读)`

## Task 2: ImageMetadata.tsx UI + 注册 + i18n

**Files:**
- Create: `src/tools/ImageMetadata.tsx`
- Test: `src/tools/ImageMetadata.test.tsx`
- Modify: `src/tools/registry.ts`(registerTool)
- Modify: `src/lib/tool-catalog.ts`(graphic 分类,EN_TOOLS)
- Modify: `src/lib/search-anchors.ts`(image_metadata 锚点)
- Create: `src/i18n/locales/tools/image_metadata.zh.json` + `.en.json`

**Interfaces (Consumes):** Task 1 的 `parseImageMetadata` / `ImageMetadataReport`。

**UI 契约:**
- 外层 shell 卡片 + `ResizablePanelGroup orientation="horizontal"` 左右分栏(照 CertificateDecoder):
  - 左:非编辑器「预览框」——26px 标题栏(文件名+打开/清除动作)+ `div.min-h-0 flex-1 overflow-auto` flex 居中 `<img>`(dataUrl,CSP 安全)+ 空态 FileImage 图标提示;整面板支持拖放(dragOver 高亮);文件 input 隐藏 `accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp"`
  - 右:26px 标题栏(「解析结果」+ 复制动作 CopyAction)+ 滚动区:文件信息段(名称/大小/格式徽标)→ 结构段(尺寸/位深/颜色/交错/DPI/透明/帧数,照 cert Field 行 w-40 label)→ EXIF 段(仅 JPEG/WebP 有,Field 行表)→ PNG 文本段 → chunk 清单表(仅 PNG,两列 type/bytes)→ 错误态 role=alert destructive 卡
- 复制动作用 `reportToText` 风格纯文本(reportToText 函数放 utils,i18n 标签注入)
- testid 前缀 `im-`:im-dropzone/im-preview/im-open/im-clear/im-output/im-error/im-field-* 等
- data-search-anchor:`image_metadata:preview`(左面板)、`image_metadata:output`(右面板)
- i18n 键(双语同步):title_preview/title_output/section_file/section_structure/section_exif/section_text/section_chunks/label_*/empty_hint/unsupported/drop_hint/badge_png…(格式名不翻译,直接 formatLabel)/orientation 名(1-8)/copy_nocolor 等

- [ ] **Step 1: 写失败 UI 测试**(渲染空态、mock 文件进入显示预览+解析结果、错误文件错误卡、registry 注册断言)
- [ ] **Step 2: 红**
- [ ] **Step 3: 实现 UI + 三处注册 + i18n + 锚点**
- [ ] **Step 4: 绿 + `pnpm typecheck` + `pnpm lint`**
- [ ] **Step 5: Commit** `feat(imgmeta): 图片元数据查看器 UI(左右分栏/拖放/EXIF 分组)`

## Task 3: 全量验证 + 浏览器实测 + PRD 勾销

- [ ] `pnpm test`(全量)、`pnpm typecheck`、`pnpm lint`、`pnpm format` 全绿
- [ ] 浏览器实测(pnpm dev + IAB/CDP 通道,参照既有 qraft-iab-browser-ui-testing 记忆):PNG 预览+chunk 表、JPEG EXIF 全字段真值、GIF/BMP/WebP、错误文件、非图片拒收
- [ ] PRD 18 表格 Image Metadata 行勾销 + PRD 07 目录补状态(如有状态列)
- [ ] Commit docs + 记忆沉淀

## Self-Review 结论

- 规格覆盖:PRD 07 `image_metadata`(EXIF/尺寸/格式)✓;DevToys 对标项 ✓
- 无占位符;接口在两个 Task 间签名一致(`parseImageMetadata(bytes)` → `ImageMetadataReport`)
- 类型一致性:Task 1 Produces 即 Task 2 Consumes,逐字段核对无漂移
