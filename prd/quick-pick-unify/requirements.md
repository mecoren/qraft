# 需求文档 —— Quick Pick 一体化公共弹窗组件

## 1. 背景

「顶部搜索 + 中间列表 + 底部提示」类弹窗(全局查找、命令面板、语言模式、编码、行尾、缩进、转到行)
已共用 `CommandDialog` 壳,但列表行与底部提示仍是各弹窗手写(四套行实现、两套 footer 实现、
五个弹窗没有 footer),且壳为固定高度。

## 2. 目标

1. 提取**一体化公共组件 `QuickPickDialog`**:顶部搜索框固定,中间内容列表,底部操作逻辑提示;
   消费方只传数据项和回调,几乎不写 UI 代码。
2. 列表行统一为「左对齐主内容(一行/两行)+ 右对齐尾随信息」;一行/两行由使用方代码
   (`description` 是否传入)决定。
3. 对话框**高度随内容伸缩**:内容少则矮,多则封顶(约 60vh/560px)后列表内部滚动。
4. 七个弹窗全部迁移到公共组件,视觉与交互统一。

## 3. 范围

### 3.1 范围内

* `src/components/ui/command.tsx`:新增 `QuickPickDialog` + `QuickPickItem`/`QuickPickGroup` 类型,
  移除旧 `CommandDialog` 导出(`Command` 原语族保留,font-picker 在用)。
* 迁移消费方:`SearchDialog.tsx`、`CommandPalette.tsx`、`EditorLanguagePicker.tsx`、
  `code-editor-quick-picks.tsx`(Encoding / Eol / Indent / GotoLine)。
* i18n:新增 `chrome.command_footer.navigate/confirm/close/count`(zh/en);
  删除迁移后无引用的 `chrome.search_dialog.navigate/jump/close/results_count`、
  `chrome.palette.footer_navigate/footer_open/footer_close/footer_count`。
* 测试:重写 `command.test.tsx` 为新组件单测;更新受影响断言
  (`CommandPalette.test` Enter 文案「跳转」→「确认」)。

### 3.2 范围外

* 各弹窗业务逻辑(搜索过滤、跳转、编码应用、两级导航状态机)。
* 居中缩放动画、overlay 样式(上一期已统一)。
* font-picker(Popover 形态,不用 `CommandDialog` 壳)。

## 4. 功能需求

### 4.1 一体化结构

| 需求点 | 说明 |
| --- | --- |
| FR-1 | 顶部搜索框固定不滚动;支持受控(`value`/`onValueChange`)与非受控两种用法 |
| FR-2 | 输入框前导槽 `leading`(全局查找的模式切换按钮组)与输入框下方提示行 `hint`(转到行的范围提示) |
| FR-3 | 中间内容列表:分组(`heading`)+ 数据项,由消费方以数据驱动方式传入 |
| FR-4 | 底部操作提示条:统一 `↑↓ 导航 / Enter 确认 / Esc 关闭` kbd 样式 + 可选右侧计数 |
| FR-5 | 搜索框与底部提示条位置固定,只有中间内容区参与伸缩/滚动 |

### 4.2 统一行(数据项渲染)

| 需求点 | 说明 |
| --- | --- |
| FR-6 | `description` 传入时渲染两行(主文本 + 灰字次行),否则单行 |
| FR-7 | `checkColumn` 为 true 时渲染行首打勾列;勾的显隐跟随 `selected`,未勾时占位对齐 |
| FR-8 | `selected` 为 true 时行持久高亮(`bg-accent font-medium`) |
| FR-9 | `trailing` 右对齐;`trailingStyle="badge"` 为 muted 徽标,`"hint"` 为灰字 |
| FR-10 | `leading` 图标槽渲染在勾列之后、文本之前 |
| FR-11 | 行样式满宽平铺 `rounded-none px-3 py-1.5`;透传 value/onSelect/disabled/data-testid |

### 4.3 高度行为

| 需求点 | 说明 |
| --- | --- |
| FR-12 | 对话框高度随内容伸缩:`h-auto` + `max-h-[min(60vh,560px)]` |
| FR-13 | 内容超过上限时仅列表内部滚动,搜索框与 footer 保持可见、位置固定 |

### 4.4 迁移与契约

| 需求点 | 说明 |
| --- | --- |
| FR-14 | 七个弹窗全部改用 `QuickPickDialog`;`ToolRow`/`PickRow`/`CheckSlot` 等私有行实现删除 |
| FR-15 | 原先没有 footer 的五个弹窗(语言/编码/行尾/缩进/转到行)补上统一 footer |
| FR-16 | 各弹窗对外 props 签名、`data-testid` 契约、键盘行为、过滤策略全部保持不变 |
| FR-17 | 自定义渲染(行号、匹配高亮、分组标题徽标、空态、列表附注)通过 ReactNode 槽位表达 |

## 5. 验收标准

1. `pnpm test` 全绿(含重写的 `QuickPickDialog` 单测与更新后的现有断言)。
2. `pnpm lint` 通过。
3. 人工验收(Tauri 窗口),七个弹窗逐一检查:
   - 结构统一:顶部搜索框、中间列表、底部快捷键提示;
   - 高度随内容伸缩,长列表内部滚动,搜索框/底部条固定;
   - 行布局统一:一行/两行、左对齐主内容、右对齐尾随信息(徽标/灰字);
   - 当前值打勾 + 高亮、键盘导航/回车/Esc 行为与迁移前一致;
   - 转到行:输入框 Enter 跳转、下方范围提示正常。
4. 视觉回归点:SearchDialog 功能行满宽平铺;CommandPalette Enter 提示为「确认/Confirm」;
   所有弹窗高度不再固定为 60vh。

## 6. 依赖与风险

* 依赖现有 cmdk 键盘导航与 Radix Dialog,无新增外部依赖。
* 风险:高度行为变化影响全部弹窗观感(需求确认项);删除 i18n 键需确认无残留引用;
  空态过扁时给最小高度兜底。
