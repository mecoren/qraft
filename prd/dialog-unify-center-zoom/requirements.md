# 需求文档 —— 搜索类对话框统一组件 + VSCode Quick Pick 动画

## 1. 背景与目标

应用内三个「搜索 / 选择」类对话框(全局查找、命令面板、选择语言模式)有重复的外壳代码,且打开动画与 VSCode Quick Pick 不一致。目标是:

1. 将三者统一成**同一个**搜索对话框外壳组件(由「全局查找」提取)。
2. 三者结构对齐 VSCode「选择语言模式」:**上面输入框,下面选择列表**。
3. 三者开启动画统一改为 **VSCode Quick Pick 风格**(缩放 0.95→1 + 上滑 10px + 淡入)。

## 2. 需求范围(RFC 2119 关键词)

### 2.1 动画统一 —— VSCode Quick Pick(直接影响 [dialog.tsx](c:/Develop/project/00_AI/qraft/src/components/ui/dialog.tsx))

- MUST:居中对话框 `DialogContent` 打开动画参考 VSCode `quick-input-scale-in`:以内容中心为原点、`scale 0.95 → 1` 放大 + `translateY(-10px) → 0` 上滑 + 淡入;关闭反向缩小 + 淡出。
- SHOULD:显式 `origin-center` 保证缩放原点在屏幕中心。
- SHOULD:水平方向保持 `translateX(-50%)` 始终对齐,不产生水平净位移;顶部位移量取 `[10px]`(VSCode 的 -10px)而非整体 `[50%]`。
- MUST:MUST 保留 overlay 的淡入淡出与内容 fade-in/out、zoom-in/out-95 的基础节奏(`duration-200`)。
- 注:此改动作用于**所有**居中对话框(Settings / Rename / About 等),属期望的统一动效。

### 2.2 统一外壳组件([command.tsx](c:/Develop/project/00_AI/qraft/src/components/ui/command.tsx) 的 `CommandDialog`)

- MUST:以「全局查找」的外壳为模板,强化现有 `CommandDialog` 为通用搜索对话框:
  - `header?`:顶部搜索区;缺省渲染默认 `CommandInput`。
  - `children`:结果列表,由调用方用 `CommandList`/`Command` 项自行组织。
  - `footer?`:底部提示条(可选)。
  - `contentClassName?` / `listClassName?`:宽度、列表最大高度等尺寸定制透传。
- MUST:壳组件继承 2.1 的 VSCode Quick Pick 动画,不做额外动画覆盖。
- MUST:壳组件默认结构即为「上输入框 + 下列表」:缺省 `header` 渲染 `CommandInput`(输入框在顶),`children` 为选择列表(在底),与 VSCode 选择语言模式一致。

### 2.3 三个消费方迁移

- MUST:`SearchDialog` 改用壳组件(`header` = 模式切换 + 受控搜索输入,`children` = 两模式结果列表,`footer` = 快捷键/结果计数提示条)。
- MUST:`CommandPalette` 改用壳组件(默认 `CommandInput`,`children` = 现有分组,无 `footer`)。
- MUST:`EditorLanguagePicker` 改造为 cmdk 壳组件(`header` = 标题 + `CommandInput`,`children` = `CommandList` + `CommandItem`),补齐上下键键盘导航。
- MUST:三者对外 props 签名(`open` / `onOpenChange` 等)保持不变,App / EditorWorkbench 调用方不改动。
- MUST:preserve `data-testid` 契约(`editor-language-picker` / `-search` / `-list` / `-lang-<id>`)。
- MUST:preserve i18n 键(`chrome.search_dialog.*`、`chrome.palette.*`、`tools.text_editor.select_language_mode`、`picker_search_placeholder`),不新增/删键。

## 3. 验收标准

1. `dialog.tsx` 测试断言:enter class 含 `origin-center` 且 top translate 为 `[10px]`(VSCode 上滑量),不再含 `[50%]` / `[48%]`。
2. `CommandDialog` 单测覆盖 `header/footer/contentClassName` 三个槽位。
3. 以下测试全部通过(不降级、不删除现有断言):
   - `SearchDialog.test.tsx`
   - `CommandPalette.test.tsx`、`command-palette.detect.test.tsx`、`tool-popout-entries.test.tsx`
   - `App.test.tsx`、`integration.smoke.test.tsx`(Ctrl+K / Ctrl+Shift+F 打开)
   - `en-locale-sweep.test.tsx`
   - `EditorLeftSidebar.test.tsx` / `EditorTabsBar.test.tsx` / `CodeEditor.test.tsx`(语言选择)
4. 人力在 Tauri 窗口验证:三个对话框打开均为「上滑 10px + 放大」的 VSCode Quick Pick 动画(上输入框 + 下列表),语言选择器支持键盘上下键导航。

## 4. 非目标(明确不做)

- 不改变 SearchDialog 的功能/文本双模式、CommandPalette 的 Smart Detection 分组逻辑、语言选择器的当前语言高亮逻辑。
- 不引入新的视觉语言或新增 i18n 文案。
- 不改动工具内其它非居中要素(面板 / Popover 等)的动画。

## 5. 影响的测试文件清单

红测新增/调整:

- `src/components/ui/dialog.test.tsx`(或现有点位)→ 新增中心缩放类断言。
- `src/components/ui/command.test.tsx`(或现有点位)→ 新增 `CommandDialog` slots 断言。

回归(不应改动断言,仅确认通过):

- `SearchDialog.test.tsx` / `CommandPalette.test.tsx` / `command-palette.detect.test.tsx` / `tool-popout-entries.test.tsx`
- `App.test.tsx` / `integration.smoke.test.tsx` / `en-locale-sweep.test.tsx`
- `EditorLeftSidebar.test.tsx` / `CodeEditor.test.tsx`