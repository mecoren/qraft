---
name: 统一全部原生滚动区为悬浮ScrollArea方案
overview: 将应用内仍使用原生滚动条(常显、占布局)的 5 处滚动区域——历史记录面板、重复检测虚拟表格、二维码/图片转换/Base64 拖放区——统一替换为现有的 @/components/ui/scroll-area(Radix ScrollArea overlay 悬浮方案),使所有滚动条视觉与交互完全一致;Monaco 与弹层滚动条明确不在本次范围。
todos:
  - id: history-panel-scroll
    content: 将 HistoryPanel 虚拟列表滚动容器改为 ScrollArea + viewportRef,保持 useVirtualizer 逻辑
    status: completed
  - id: duplicate-detector-scroll
    content: 将 DuplicateDetector 表格虚拟滚动容器改为 ScrollArea + viewportRef,保持 rowVirtualizer 逻辑
    status: completed
  - id: dropzone-scroll
    content: 将 QrcodeTool/ImageConverter/Base64Codec 三个拖放区改为 ScrollArea,内部保留居中布局与 data-testid
    status: completed
  - id: regression-tests
    content: 用 [skill:test-driven-development] 运行相关测试集验证无回归并清理临时 bat/txt
    status: completed
    dependencies:
      - history-panel-scroll
      - duplicate-detector-scroll
      - dropzone-scroll
---

## 产品概述

将应用中所有滚动条统一为 Monaco/VSCode 风格的悬浮 overlay 方案:滚动条绝对悬浮于内容之上、不占独立布局;平时隐藏、hover 显示、拖拽中保持可见;轨道不拦截鼠标(pointer-events 穿透)、滑块可跟手拖拽;颜色随深浅主题自动适配。

## 核心功能

- 统一方案已由 `src/components/ui/scroll-area.tsx` 实现(轨道 pointer-events-none、滑块 pointer-events-auto、hover 加深、Radix type=hover 显隐),18 处已应用,无需改动。
- 本次将 5 处仍使用原生滚动条(常显、占布局)的区域替换为该统一方案:
- 历史记录面板(虚拟列表)
- 重复检测结果表格(虚拟列表)
- 二维码识别、图片转换、Base64 编解码三个拖放/预览区
- 明确不在范围:Monaco 编辑器滚动条(已是自绘 overlay 悬浮且颜色已随主题统一)、弹层滚动条(Select/DropdownMenu/Command)。

## 技术栈

- React 19 + Radix ScrollArea + Tailwind CSS(v4, globals.css 已含 `[data-slot="scroll-area-viewport"]` 隐藏原生滚动条规则)
- 复用现有 `src/components/ui/scroll-area.tsx`,不新建组件

## 实现方案

### 改造方式

直接复用已统一的基础组件 `ScrollArea`(已支持 `viewportRef` / `orientation` / `viewportClassName` props):

1. **HistoryPanel.tsx**(虚拟列表):将 `<div ref={parentRef} className="flex-1 overflow-auto">` 替换为 `<ScrollArea ref 不可用,改用 viewportRef={parentRef} className="min-h-0 flex-1">`。Radix Viewport 本身就是可滚动元素,`useVirtualizer({ getScrollElement: () => parentRef.current })` 逻辑保持不变,虚拟化行为不受影响。
2. **DuplicateDetector.tsx**(DuplicatesTable 虚拟表格):同样将 `<div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">` 替换为 `<ScrollArea viewportRef={scrollRef} className="min-h-0 flex-1">`,`rowVirtualizer` 的 `getScrollElement` 不变。
3. **QrcodeTool.tsx / ImageConverter.tsx / Base64Codec.tsx**(拖放/预览区):外层滚动容器替换为 `<ScrollArea className="min-h-0 flex-1 rounded-lg border ...">`,原 `data-testid` 移到 ScrollArea 上(组件透传 Root 属性);内部内容外包一层 `<div className="flex h-full items-center justify-center gap-2">`(ImageConverter 为 `flex-col`)保持居中布局,图片溢出时由 ScrollArea 悬浮滚动。

### 关键技术决策

- **viewportRef 转发**而非 `ScrollAreaPrimitive.Viewport` 直接 ref:现有 `scroll-area.tsx` 已封装该 prop,虚拟列表组件零逻辑改动即可接入。
- **保留 `min-h-0 flex-1` 高度约束**:ScrollArea Root 为 `relative overflow-hidden`,在 flex 列布局中必须保留 `min-h-0` 才能正确收缩并触发滚动。
- **性能**:虚拟列表(HistoryPanel/DuplicateDetector)仍只渲染可见行,ScrollArea 仅替换滚动容器,不引入额外渲染开销;Radix 内置 ResizeObserver 自动度量,无需手动监听。
- **防回归**:不触碰 Monaco、弹层及已统一区域;不改动 globals.css(viewport 隐藏原生滚动条规则已存在)。

## 目录结构

```
src/
├── components/
│   └── HistoryPanel.tsx                    # [MODIFY] 虚拟列表滚动容器改为 ScrollArea + viewportRef
├── tools/
│   ├── DuplicateDetector.tsx               # [MODIFY] DuplicatesTable 虚拟滚动容器改为 ScrollArea + viewportRef
│   ├── QrcodeTool.tsx                      # [MODIFY] 读取 Tab 拖放区改为 ScrollArea,内部居中布局保留
│   ├── ImageConverter.tsx                  # [MODIFY] 图片拖放区改为 ScrollArea,内部 flex-col 居中保留
│   └── Base64Codec.tsx                     # [MODIFY] 文件拖放/预览区改为 ScrollArea,内部居中布局保留
```

无新增文件;5 个文件均为滚动容器替换,组件结构与其他 18 处已统一区域完全一致。

## 回归验证

- 受影响测试:`src/components/HistoryPanel.test.tsx`、`src/tools/DuplicateDetector.test.tsx`、`src/tools/Base64Codec.test.tsx`(引用拖放区 testid)、`src/App.test.tsx`、`src/integration.smoke.test.tsx`
- Windows PowerShell 下用临时 bat 脚本运行 vitest(run 模式,重定向输出到 txt,读 ExitCode=0 后清理),避免 watch 超时

## Agent Extensions

### Skill

- **test-driven-development**
- 用途:改造前运行现有测试建立基线,改造后复用同一测试集验证无回归(HistoryPanel / DuplicateDetector / Base64Codec / App / smoke)
- 预期结果:5 处滚动区替换后全部既有测试通过,虚拟化与拖放行为不改变