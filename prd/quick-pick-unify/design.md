# 设计文档 —— Quick Pick 一体化公共弹窗组件

## 1. 需求理解

把「顶部搜索框 + 中间结果列表 + 底部操作提示」这一类 Quick Pick 弹窗提取成**一个一体化公共组件**:
消费方只传数据项(主文本/次行描述/右侧尾随信息/是否打勾)和回调,几乎不写 UI 代码;
列表行支持一行/两行,由使用方代码决定;对话框**高度随内容伸缩**(内容少则矮、多则到上限后列表内部滚动),
搜索框固定在顶部。以全局搜索(SearchDialog)为参考组件,其余弹窗直接使用该公共组件。

## 2. 现状与关键事实

* `command.tsx` 的 `CommandDialog` 壳已统一(顶部输入固定 + `CommandList` 滚动 + footer 槽位),
  但消费方仍各自手写**列表行**(四套实现)与**底部提示条**(两套实现 + 五个弹窗没有 footer)。

* 行结构四处手写、语义同构(左侧勾/图标 + 主文本 [+ 次行],右侧 `ml-auto` 徽标/灰字):
  `SearchDialog` 功能行、`CommandPalette` 私有 `ToolRow`、`EditorLanguagePicker` 行、
  `code-editor-quick-picks.tsx` 私有 `PickRow`/`CheckSlot`。

* 高度现状:`CommandDialog` 固定 `h-[min(60vh,560px)]`;`GotoLineQuickPick` 已用 `h-auto` 例外。
  用户本期确认统一为「内容决定高度」。

* `CommandDialog` 的消费方就是这 7 个弹窗(font-picker 只用 `Command`/`CommandInput` 等原语,
  不用壳),因此可以**直接把壳升级为一体化组件**并替换,无其他牵连。

* 测试契约:`palette-footer`/`palette-footer-count` testid 与文案断言;快选弹窗 `-search/-list/-back/
  -hint/-apply/-width-*/-encoding-*/-eol-*/-reopen/-save`;语言选择器 `-search/-list/-lang-*/-auto`;
  `command.test.tsx` 现测旧壳的槽位。

* i18n:两个 footer 各有等价键(`chrome.search_dialog.navigate/jump/close/results_count` 与
  `chrome.palette.footer_*`),迁移后可删,新增通用键。

## 3. 设计决策

### 3.1 决策一:一体化组件 `QuickPickDialog`(挂在 `command.tsx` 导出,替换旧壳)

```tsx
/** 列表行数据项:一行/两行由 description 是否传入决定,完全由使用方代码控制 */
export type QuickPickItem = {
  key: string;                      // React key(必传,保证列表稳定性)
  value?: string;                   // cmdk 检索值(shouldFilter 时参与过滤)
  label: React.ReactNode;           // 主文本(第一行,truncate)
  description?: React.ReactNode;    // 次行描述(灰字);传入即两行结构
  leading?: React.ReactNode;        // 前导槽(勾列之后的图标:功能/语言图标、方向箭头)
  trailing?: React.ReactNode;       // 右侧尾随信息(右对齐)
  trailingStyle?: 'badge' | 'hint'; // badge=muted 徽标(分组名);hint=灰字(标识符),默认 hint
  checkColumn?: boolean;            // 是否渲染行首打勾列(未勾时占位对齐)
  selected?: boolean;               // 当前值:打勾(配合 checkColumn)+ 持久 bg-accent 高亮
  disabled?: boolean;
  onSelect?: () => void;
  testId?: string;                  // data-testid
  className?: string;               // 行级微调
};

export type QuickPickGroup = {
  key?: string;
  heading?: React.ReactNode;        // 分组标题(可为自定义节点,如文本搜索的「文件名 + 命中数」)
  items: QuickPickItem[];
};

export type QuickPickDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;                    // sr-only DialogTitle(无障碍)
  description?: string;             // sr-only DialogDescription
  placeholder?: string;
  leading?: React.ReactNode;        // 输入框前导槽(SearchDialog 模式切换按钮组)
  value?: string;                    // 受控查询;不传则 cmdk 内部管理(CommandPalette 用法)
  onValueChange?: (v: string) => void;
  shouldFilter?: boolean;           // cmdk 自过滤开关
  hint?: React.ReactNode;           // 输入框下方灰字提示行(GotoLine 范围提示)
  groups: QuickPickGroup[];
  empty?: React.ReactNode;          // 列表为空时展示(替代 CommandEmpty 内容)
  listFooter?: React.ReactNode;     // 列表底部附注(SearchDialog「命中过多」提示)
  count?: React.ReactNode;          // footer 右侧计数(不传不渲染)
  inputProps?: Omit<React.ComponentPropsWithoutRef<typeof CommandInput>,
    'value' | 'onValueChange' | 'placeholder' | 'leading'>; // inputMode/onKeyDown/autoFocus 等透传到输入框
  contentClassName?: string;        // 宽度定制(缺省 w-[48rem])
  hideCloseButton?: boolean;
  contentTestId?: string;
  inputTestId?: string;
  listTestId?: string;
  footerTestId?: string;            // 兼容 palette-footer 契约
};
```

渲染结构(即全局搜索的骨架,搜索框固定顶部):

```
Dialog → DialogContent(h-auto + max-h, 动画不变) → Command(shouldFilter)
  ├─ sr-only DialogTitle / DialogDescription
  ├─ CommandInput(leading / value / placeholder / inputProps)
  ├─ [hint?(border-b 灰字行)]
  ├─ CommandList(flex-1 min-h-0 滚动)
  │   ├─ groups.map → CommandGroup(heading) → items.map → CommandItem(统一行布局)
  │   ├─ empty → 空态节点
  │   └─ listFooter
  └─ CommandFooter(↑↓ 导航 / Enter 确认 / Esc 关闭 + count)
```

整体视觉示意(高度随内容伸缩,仅中间列表区变长):

```
┌──────────────────────────────────────────────┐
│  [模式切换] 🔍 搜索所有功能、工具、设置...        │  ← 顶部搜索框(固定)
├──────────────────────────────────────────────┤
│  分组标题                                      │
│  ✓ [图标] 主文本(一行行型)          右侧灰字  │  ← 单行行
│    [图标] 主文本                    [分组徽标] │
│    [图标] 主文本(两行行型)          右侧灰字  │  ← 两行行(description 传入)
│             次行描述(灰字,truncate)            │
│  …(仅此区域伸缩/滚动)                         │
├──────────────────────────────────────────────┤
│  ↑↓ 导航  Enter 确认  Esc 关闭       12 条结果 │  ← 底部提示条(固定)
└──────────────────────────────────────────────┘
```

统一行布局(组件内部渲染,不再单独导出行组件):

```
[CheckSlot(占位对齐)] [leading] [主文本 (+次行) flex-1 truncate] [trailing(ml-auto shrink-0)]
```

* 行样式满宽平铺 `rounded-none px-3 py-1.5`;`selected` 加 `bg-accent font-medium`。
* `SearchDialog` 功能行从 `px-2 py-2 rounded-sm` 收敛到统一满宽平铺,属预期视觉统一;
  `CommandPalette` 的 `ToolRow`、快选弹窗的 `PickRow`/`CheckSlot` 迁移后删除。

### 3.2 决策二:高度随内容伸缩

`DialogContent` 基础类由固定 `h-[min(60vh,560px)]` 改为 `h-auto max-h-[min(60vh,560px)]`:

* 内容少 → 对话框矮(搜索框 + 实际行数 + footer,如 GotoLine);内容多 → 封顶后 `CommandList`
  内部滚动,搜索框与 footer 始终固定。
* `CommandList` 维持 `flex-1 min-h-0 overflow-y-auto`,在自适应高度父级下即「占实际内容高,
  超限让位给滚动」。
* 该变化作用于全部 7 个弹窗(统一目标);`GotoLineQuickPick` 的 `h-auto` 例外不再需要。

### 3.3 决策三:公共底部提示条(组件内置,不再单独导出)

* 以 `SearchDialog` 现有 footer 为准:全 kbd 样式 `↑↓ 导航 / Enter 确认 / Esc 关闭`,
  `border-t px-4 py-2 text-xs text-muted-foreground`,`count` 以 `ml-auto` 右对齐。
* i18n 新增 `chrome.command_footer.navigate / confirm / close / count`(zh/en),
  迁移后删除 `chrome.search_dialog.navigate/jump/close/results_count` 与
  `chrome.palette.footer_*`(无其他引用)。
* 七个弹窗统一带 footer;原先没有的(语言/编码/行尾/缩进/转到行)为**新增能力**。
* `CommandPalette` Enter 文案变化:「跳转」→「确认」(en: Open → Confirm),测试同步更新。

### 3.4 决策四:七个消费方迁移(全部统一)

| 组件 | 迁移要点 |
| --- | --- |
| `SearchDialog` | `leading`=模式切换按钮组;受控 `value`;groups=功能模式按 kind 分组 / 文本模式按文件分组(heading=文件名+命中数,leading=行号,label=高亮行内容);`empty` 条件空态;`listFooter`=命中过多附注;`count`=total |
| `CommandPalette` | 非受控输入(不传 value)+ `shouldFilter`;groups=检测/工具/动作;`count`=工具总数(`palette-footer`/`palette-footer-count` testid 保留,count 包 span 传 testid);删 `ToolRow` |
| `EditorLanguagePicker` | 受控查询(关闭重置逻辑在 `onOpenChange` 包装里保留);单组列表,语言项 `checkColumn`+`selected`+`leading`=语言图标+`trailing`=(id);「自动检测」首项同样迁移 |
| `EncodingQuickPick` | 两级 `view` 状态留在消费方,按 view 计算不同 groups;「返回」=leading 箭头行;编码行 `checkColumn`+`selected`+`trailing`=id |
| `EolQuickPick` | 选项行 `checkColumn`+`selected`,trailing=描述灰字 |
| `IndentQuickPick` | 根列表/宽度二级列表行迁移;`view` 状态留消费方 |
| `GotoLineQuickPick` | `hint`=范围/纠错提示;`inputProps`={inputMode,onKeyDown Enter→apply};单 item(跳转行,`selected`)或 `empty`;宽度 `w-[36rem]` 经 `contentClassName` |

### 3.5 兼容与契约

* 各弹窗对外 props 签名不变,宿主(App / EditorWorkbench / CodeEditor)零改动。
* `data-testid` 契约全部保留(`-search/-list/-lang-*/-encoding-*/-eol-*/-width-*/-back/-apply/-hint/
  -reopen/-save/palette-footer/palette-footer-count` 等)。
* 键盘行为(cmdk ↑↓/Enter/Esc)、`shouldFilter` 策略、i18n 其余键不变。
* `Command`/`CommandInput` 等原语继续导出(font-picker 在用);`CommandDialog` 导出移除,
  由 `QuickPickDialog` 取代,`command.test.tsx` 重写为新组件单测。

## 4. 实现步骤(≤5 步)

1. **红测先行**:重写 `command.test.tsx` 为 `QuickPickDialog` 单测(渲染结构、一行/两行、
   checkColumn 占位、trailing 徽标/灰字、受控/非受控输入、empty/listFooter、footer 键提示与 count、
   高度类 `h-auto max-h-*`),跑红。
2. **实现组件**:i18n 加 `chrome.command_footer.*` 键;`command.tsx` 实现 `QuickPickDialog`
   (删除旧 `CommandDialog`),单测转绿。
3. **迁快选弹窗**:`code-editor-quick-picks.tsx`(删 `PickRow`/`CheckSlot`)与
   `EditorLanguagePicker.tsx` 改为数据驱动,保持 `code-editor-quick-picks.test` 通过。
4. **迁搜索两兄弟**:`SearchDialog`(删行内布局与 footer 手写)与 `CommandPalette`(删 `ToolRow`),
   更新 `CommandPalette.test` Enter 文案断言,相关测试全绿。
5. **全量回归**:`pnpm test` + `pnpm lint`,人工在 Tauri 窗口过一遍七个弹窗,
   重点确认:高度随内容伸缩、行布局统一、footer 统一、打勾/高亮/键盘行为不变。

## 5. 边界条件与潜在风险

* **高度行为全局变化**:固定高 → 自适应 + 封顶,七个弹窗观感都会变(这是需求);
  空态时对话框较矮,需确认空态文案区(`py-12`)不至于太扁,必要时空态给最小高度。
* **SearchDialog 功能行视觉变化**:行内边距收敛为满宽平铺,属统一目标内变化。
* **CommandPalette Enter 文案变化**:「跳转」→「确认」,测试断言需同步(en: Open→Confirm)。
* **数据驱动的表达力边界**:自定义渲染全部通过 `ReactNode` 槽位(label/description/heading/
  leading/trailing/empty/listFooter)表达,已覆盖七个弹窗的全部现状;不再新增槽位,
  避免组件参数化失控。
* **GotoLine 的 Enter 在输入框触发**:经 `inputProps.onKeyDown` 透传,行为与现状一致。
* **CommandItem svg 全局样式**(`[&_svg]:size-4`)作用于 leading/trailing 内图标,尺寸一致,无冲突。
