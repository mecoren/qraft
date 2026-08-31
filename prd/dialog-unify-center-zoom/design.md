# 设计文档 —— 搜索类对话框统一组件 + 纯中心缩放动画

## 1. 需求理解

把三个「搜索/选择」类对话框统一成同一套组件,统一「从中间直接放大」的开启动画:

* `SearchDialog`(全局查找/功能+文本搜索)

* `CommandPalette`(命令面板)

* `EditorLanguagePicker`(选择语言模式,仿 VSCode Quick Pick)

三者目前共享 `dialog.tsx` 的 `DialogContent`,但各自手写外壳,存在重复;打开动画是「缩放 + 从上方滑入」的组合,不满足「从中间直接放大」。

## 2. 现状与关键事实

* 三个组件全部基于 Radix `Dialog`,结构为:`Dialog → DialogContent → ...`。

* `SearchDialog` / `CommandPalette` 用 cmdk `Command`;`EditorLanguagePicker` 用普通 `Input` + `ScrollArea`(非 cmdk,无键盘上下键导航)。

* `command.tsx` 已存在一个很薄的 `CommandDialog`(仅 `Dialog + DialogContent + Command`),`SearchDialog` 并未复用它。

* 动画定义在 [dialog.tsx](c:/Develop/project/00_AI/qraft/src/components/ui/dialog.tsx) 的 `DialogContent`。**它是所有居中对话框(如 SettingsDialog / RenameDialog / AboutDialog)的公共底座**,改动画会影响全局 —— 这是期望的「统一动效语言」,已与用户确认。

### 2.1 动画根因分析

当前 `DialogContent` 关键类:

```
left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%]
data-[state=open]:zoom-in-95
data-[state=open]:slide-in-from-left-1/2        → enter translateX = -50%
data-[state=open]:slide-in-from-top-[48%]       → enter translateY = -48%
```

`tailwindcss-animate` 的 enter keyframe 会用一个 `translate3d(enter-x, enter-y, 0) scale(enter-scale)` 覆盖最终态。因为基础定位靠 `translate-[-50%]`,而 **enter 的 translateY 写成 48%(与 50% 不一致)**,动画期间 translateY 会从 -48% 插值到 -50%,产生一段微小的向上滑动 + 缩放。这正是「不是从中间直接放大」的根因。

**纯中心缩放的正确做法**:让 enter/exit 的 translate 与基础居中的 translate **逐字节一致**,使动画期间唯一变化的属性是 `scale`,并显式 `origin-center` 让缩放以内容盒中心(即屏幕中心)为原点。

## 3. 设计决策

### 3.1 决策一:底座动画 → 纯中心缩放

修改 `dialog.tsx:44`,把 enter/exit 的 top translate 由 `[48%]` 统一为 `[50%]`(与 `translate-y-[-50%]` 对齐),并加 `origin-center`,其余(overlay fade、fade-in/out、zoom-in/out-95)不变。

* inert 态动画期间:translate 不变 → 视觉上只有 `scale: 0.95 → 1` 从内容中心放大,无位移。关闭反向缩小。

* overlay 仍保持 `fade-in/out`,背板淡入淡出不受影响。

### 3.2 决策二:统一「搜索对话框」壳组件

复用并强化 `command.tsx` 里已有的 `CommandDialog`,把它提升为「从全局查找提取」的通用搜索对话框外壳:

```tsx
interface CommandDialogProps extends DialogProps {
  header?: React.ReactNode;   // 顶部搜索区(可为空 → 走默认 CommandInput)
  footer?: React.ReactNode;   // 底部提示条(可选)
  contentClassName?: string;  // 宽度等 DialogContent 定制(如 max-w-3xl)
}
```

渲染结构(即 `SearchDialog` 的外壳骨架):

```
<Dialog>
  <DialogContent contentClassName ...(继承纯中心缩放动画)>
    <Command>
      {header ?? <CommandInput />}   // 顶部:搜索框 / 模式切换+输入
      {children}                     // 结果列表:由各调用方用 CommandList/Command 项自行组织
      {footer}                       // 底部快捷键提示条
    </Command>
  </DialogContent>
</Dialog>
```

理由:

* 三个组件高度相似的「通用外壳」就是 `Dialog + 居中内容 + 顶部搜索 + 结果列表 + 底部提示`;把这段抽成壳,符合「都用全局查找提取出来的这个组件」。

* `grid/children` 结构让各调用方保留自己的结果渲染逻辑(SearchDialog 的分组/文本模式、CommandPalette 的群组、语言选择器的语言项),避免过度抽象。

* cmdk 版 `CommandInput`/`CommandList` 自带键盘导航与统一样式,`EditorLanguagePicker` 借此补齐上下键导航。

### 3.3 决策三:三个消费方迁移

| 组件                     | 迁移方式                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `CommandPalette`       | 直接用壳组件,默认 `CommandInput`(符合现状),children 放现有 group,无 footer。                                                             |
| `SearchDialog`         | 用壳组件,`header` 传入「模式切换 + 受控搜索输入」,children 放两种模式的结果列表,`footer` 传现有快捷键/结果计数条。                                              |
| `EditorLanguagePicker` | 改造成 cmdk:壳组件 + `header` 传「标题栏 + CommandInput」,children 用 `CommandList` + `CommandItem`(保持现有 i18n 文案与 `data-testid` 契约)。 |

### 3.4 兼容与契约

* 保留三个组件各自的 props 签名(`open / onOpenChange` 等),调用方(App / EditorWorkbench)无需改动。

* 保留 `data-testid` 契约:`editor-language-picker`、`-search`、`-list`、`-lang-<id>`;`CommandItem` 会透传额外 HTML props,故 `data-*` 可沿用。

* 保留 i18n 键(`tools.text_editor.select_language_mode`、`picker_search_placeholder`、chrome.\* 等),不新增/删键。

## 4. 实现步骤(≤5 步)

1. **红测先行(动画)**:新增/调整 `dialog` 相关测试断言 enter class 包含 `origin-center` 且 top translate 为 `[50%]`、不再含 `[48%]`;跑红→改 `dialog.tsx`→绿。
2. **壳组件**:强化 `command.tsx` 的 `CommandDialog`(加 `header/footer/contentClassName` 槽位),补一个最小单元测试(给定 slots 正确渲染)。
3. **迁 CommandPalette / SearchDialog**:各自改用壳组件,保持既有测试(SearchDialog.test / CommandPalette.test / palette.detect / tool-popout-entries / App 集成 / en-locale-sweep)通过。
4. **迁 EditorLanguagePicker**:改造成 cmdk 壳,补齐键盘导航,保持 language 选择交互;跑 EditorLeftSidebar/EditorTabsBar/CodeEditor 相关测试。
5. **全量回归**:`pnpm test` + 相关 smoke,人工在 Tauri 窗口验证三个对话框「从中间放大」。

## 5. 边界条件与风险

* **动画影响面广**:改 `dialog.tsx` 会作用于所有居中对话框(Settings/Rename/About 等)。选纯中心缩放是用户确认的统一动效,视觉更克制;若有工具主内容偏置的对话框需复核其 `contentClassName` 覆盖。

* **`prefers-reduced-motion`**:globals.css 已全局压缩动效,无需额外处理。

* **EditorLanguagePicker 行为变化**:由普通 Input 改 cmdk,ESC/focus/键盘交互更贴近 VSCode,但 `hideCloseButton` 语义不同(壳组件默认带右上角关闭钮)。如需保持无关闭钮,给壳组件加 `hideCloseButton` 透传。

* 文本模式结果列表 `max-h-[60vh]` 等尺寸定制一律走 `listClassName`/`contentClassName` 透传,不写死进壳。

