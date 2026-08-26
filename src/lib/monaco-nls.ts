/**
 * Monaco 内置 UI 语言切换(查找/替换栏、折叠提示等)。
 *
 * 原理:index.html 以经典 <script> 静态引入 nls/lang/zh-cn.js,它把中文消息表
 * 写入 globalThis._VSCODE_NLS_MESSAGES;Monaco 的 localize() **每次调用时懒读**
 * 该全局(见 monaco-loader-config.ts 头注),因此运行时替换该表后,
 * 之后新创建的内置控件(如再次打开的查找栏)即随新语言渲染。
 * en-US 时移除中文表 → localize() 回落 Monaco 内置英文文案。
 *
 * 已打开的查找栏等控件在切换后保持旧语言,关闭再打开即刷新 —— 与应用其他
 * 「切换后下次交互生效」的边界的口径一致。
 */

type NlsGlobal = { _VSCODE_NLS_MESSAGES?: unknown };

/** zh-cn.js 注入的中文消息表(本模块随编辑器模块图加载,晚于该经典脚本) */
const ZH_MESSAGES = (globalThis as NlsGlobal)._VSCODE_NLS_MESSAGES;

/** 按应用语言切换 Monaco 内置 UI 文案(幂等) */
export function applyMonacoNls(locale: 'zh-CN' | 'en-US'): void {
  (globalThis as NlsGlobal)._VSCODE_NLS_MESSAGES = locale === 'zh-CN' ? ZH_MESSAGES : undefined;
}
