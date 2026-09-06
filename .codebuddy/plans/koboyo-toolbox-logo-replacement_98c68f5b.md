---
name: koboyo-toolbox-logo-replacement
overview: 使用 Koboyo `toolbox` SVG 作为 Qraft 应用 logo,通过新增共享 `Logo` React 组件改造 SideNav/Titlebar/WelcomePage 三处 UI,并通过 SVG→PNG 栅格化 + `pnpm tauri icon` 重生成 src-tauri/icons 全套平台打包图标。
todos:
  - id: create-logo-component
    content: 使用 [skill:test-driven-development] 创建 Logo 组件并接入 SideNav、Titlebar、WelcomePage 三处品牌区
    status: completed
  - id: generate-icon-source
    content: 保存 assets/toolbox.svg,安装 sharp 并编写 scripts/generate-app-icon.js 生成 1024x1024 应用图标源图
    status: completed
  - id: regenerate-tauri-icons
    content: 运行 pnpm tauri icon assets/source-icon.png 重生成 src-tauri/icons 全套平台图标
    status: completed
    dependencies:
      - generate-icon-source
  - id: verify-and-review
    content: 运行 lint、typecheck、vitest 全量验证,并用 [skill:requesting-code-review] 做最终复核
    status: completed
    dependencies:
      - create-logo-component
      - regenerate-tauri-icons
---

## 产品概述

为 Qraft(本地优先的开发者工具箱,Tauri 桌面应用)从 Koboyo Icons 站点的 dev 图标集挑选一款图标作为应用 logo,并替换项目内全部应用级 logo 位置。已从 10 个候选(terminal、toolbox、wrench、cog、code、braces、command、box、bug-beetle、controller)中确认选用 **toolbox 工具箱** 图标(最贴合"开发者工具箱"定位)。

## 核心功能

- 新增共享 `Logo` React 组件:内嵌 Koboyo toolbox SVG(inline SVG,`fill="currentColor"` 跟随主题色)
- 替换三处 UI 品牌区:侧边栏品牌区(SideNav)、标题栏(Titlebar)、欢迎页 Hero(WelcomePage)
- 重新生成 Tauri 打包图标:以新图标栅格化为 1024×1024 源图,通过 `pnpm tauri icon` 重生成 `src-tauri/icons/` 全套平台图标(png/ico/icns/android/ios)
- 仅改动应用品牌位,不动工具级 lucide 图标

## 视觉效果

- 手绘风格的白色工具箱图形,在靛蓝(#6366F1)品牌色块/渐变背景上呈现,与现有侧边栏品牌区 `bg-primary text-primary-foreground` 风格一致;标题栏中随 muted 文字色显示;欢迎页 Hero 中随渐变前景色显示。

## 技术栈

- 前端:React 19 + TypeScript + Tailwind CSS v4(沿用现有项目栈)
- 桌面壳:Tauri v2,复用既有 `pnpm tauri icon assets/source-icon.png` 图标生成工作流(见 `prd/plans/06-distribution-packaging.md`)
- 图标栅格化:Node.js 22 + `sharp`(新增 devDependency,负责 SVG→PNG 渲染合成)

## 实现方案

1. **共享 Logo 组件**:新建 `src/components/Logo.tsx`,把 Koboyo toolbox SVG 的两条 path 内嵌为 JSX,`viewBox="0 0 220 166"`、`fill="currentColor"`,通过 `className` 由调用方控制尺寸与颜色;组件 `aria-hidden`(装饰性,伴随文字 "Qraft" 出现)。Koboyo 图标免费可商用无需署名。
2. **三处 UI 接入**:

- `SideNav.tsx` 第 106 行:品牌色块内 `LayoutGrid` → `<Logo className="size-4" />`,并清理 `LayoutGrid` import(仅该处使用)
- `Titlebar.tsx`:在 `.titlebar-drag` 内、`titlebar-title` 前插入 `<Logo className="size-3.5 text-muted-foreground" />`,与标题文字同色、适配 32px 栏高,不干扰 `data-tauri-drag-region` 拖拽(非交互元素,事件冒泡到父级拖拽区)
- `WelcomePage.tsx` Hero:h1 外层改 flex 容器,左侧插入 `<Logo className="size-10 text-hero-foreground" />`;`welcome-hero` testid 在父容器不受影响;`LayoutGrid` 仍需保留(用作 KPI 分类卡图标)

3. **打包图标重生成**:保存原始 SVG 至 `assets/toolbox.svg` 作为栅格化单一来源;新增 `scripts/generate-app-icon.js` 用 sharp 合成 1024×1024 PNG(#6366F1 底色 + 白色字形,居中约 72% 宽,保持 220:166 比例),覆盖 `assets/source-icon.png`;随后执行 `pnpm tauri icon assets/source-icon.png` 就地重生成 `src-tauri/icons/` 全套图标,`tauri.conf.json` 的 `bundle.icon` 路径保持不变。
4. **清理**:删除已无用的 `scripts/generate-placeholder-icon.js`(纯色占位脚本,被新脚本取代)。

## 实现要点

- **单一来源**:UI 组件内嵌 path 与 `assets/toolbox.svg` 源自同一 Koboyo 资源,两处均标注来源 URL 便于日后同步。
- **颜色继承**:SVG 使用 `currentColor`,侧边栏(白字/primary 块)、标题栏(muted-foreground)、Hero(hero-foreground)三处颜色自动适配,无需硬编码色值。
- **性能**:Logo 为静态纯内联 SVG,无运行时开销、无网络请求;sharp 仅作开发期一次性栅格化,不进前端 bundle。
- **可靠性**:sharp 在 Windows 通过 pnpm 自动下载预编译二进制(无需 node-gyp);若安装失败可回退为手动转换一次 PNG 到 `assets/source-icon.png` 后继续执行 `tauri icon`。
- **防回归**:CSP 无需调整(inline SVG 不触发 `img-src`);仅动 3 个组件品牌区,不触碰工具级 lucide 图标与既有布局结构。

## 架构设计

本改动为局部品牌替换,无需引入新架构模式,遵循现有"组件复用 + 单一数据流"约定:Logo 组件为纯展示组件,通过 props(className)被 SideNav/Titlebar/WelcomePage 复用;图标源文件资产(`assets/`)+ 生成脚本(`scripts/`)沿用现有占位图标管线模式。

## 目录结构

```
project-root/
├── assets/
│   ├── source-icon.png            # [MODIFY] 脚本重新生成:1024×1024 靛蓝底白字 toolbox(tauri icon 输入源)
│   └── toolbox.svg                # [NEW] Koboyo 原始 SVG 存档(单一来源,供栅格化脚本读取)
├── scripts/
│   ├── generate-app-icon.js       # [NEW] sharp 脚本:读取 toolbox.svg → 合成 1024×1024 PNG → 覆盖 source-icon.png
│   └── generate-placeholder-icon.js  # [DELETE] 被新脚本取代
├── src/
│   ├── components/
│   │   ├── Logo.tsx               # [NEW] 共享品牌 Logo 组件(内嵌 toolbox path,fill=currentColor,className 透传)
│   │   ├── Logo.test.tsx          # [NEW] Logo 渲染与 className 透传测试
│   │   ├── SideNav.tsx            # [MODIFY] 品牌区 LayoutGrid → <Logo className="size-4" />,清理 import
│   │   ├── layout/
│   │   │   └── Titlebar.tsx       # [MODIFY] 标题前插入 <Logo className="size-3.5 text-muted-foreground" />
│   │   └── pages/
│   │       └── WelcomePage.tsx    # [MODIFY] Hero h1 前插入 <Logo className="size-10 text-hero-foreground" />(flex 布局)
├── src-tauri/
│   └── icons/                     # [REGEN] pnpm tauri icon 输出:32x32/128x128/icon.ico/icon.icns/android/ios 等
└── package.json                   # [MODIFY] devDependencies 增加 sharp
```

## 关键代码结构

`Logo` 组件核心签名(路径数据取自 `assets/toolbox.svg` 的两条 path,注释标注来源 URL):

```
interface LogoProps {
  className?: string;
}

/** Koboyo toolbox 图标(inline SVG,currentColor 跟随主题色) */
export function Logo({ className }: LogoProps): JSX.Element {
  return (
    <svg viewBox="0 0 220 166" fill="currentColor" aria-hidden className={className}>
      {/* 箱体 path */}
      {/* 锁扣 path */}
    </svg>
  );
}
```

`scripts/generate-app-icon.js` 合成逻辑(关键参数):1024×1024 画布,`#6366F1` 底色矩形 + `translate(tx, ty) scale(scale)` 包裹白色字形,`scale = (1024 * 0.72) / 220`,居中偏移 `tx = (1024 - 220*scale)/2`、`ty = (1024 - 166*scale)/2`。

## Agent Extensions

### Skill

- **test-driven-development**
- Purpose: 为 `Logo` 组件先写测试(渲染 SVG、className 透传、aria-hidden)再实现,确保三处品牌区改动有测试覆盖且不破坏现有 SideNav/App 测试套件
- Expected outcome: `Logo.test.tsx` 通过,`vitest` 全量测试保持绿色
- **requesting-code-review**
- Purpose: 改动完成后对 Logo 组件、三处接入点、图标生成脚本与依赖变更做最终代码复核
- Expected outcome: 发现并修正潜在问题(import 清理遗漏、颜色继承错误、脚本健壮性),保证改动质量与一致性
