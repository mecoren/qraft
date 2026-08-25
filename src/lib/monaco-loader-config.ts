/**
 * Monaco AMD loader 路径配置(惰性化)。
 *
 * 为什么不放 main.tsx:@monaco-editor/loader 只有编辑器类工具会用,放启动入口会把
 * 它(连同 @monaco-editor/react 包装层,~22KB chunk)拖进首屏静态依赖图。
 * 配置只需满足「任何 Editor/DiffEditor 挂载前已执行」,因此放到编辑器模块图的
 * 模块作用域:三个运行时消费方(code-editor.tsx / EditorWorkbench.tsx /
 * TextCompare.tsx)都以 side-effect import 本模块,天然先于组件挂载执行。
 *
 * 加载策略 —— 走项目内置资源,不联网:
 * - 默认 loader 会从 https://cdn.jsdelivr.net 拉 monaco-editor,但生产 CSP
 *   script-src 'self' 会拦掉跨域脚本,WebView2 里编辑器就出不来;
 *   dev 模式 Tauri 不注入 devCsp 所以看不出问题,prod 才会爆。
 * - 这里指向 scripts/copy-monaco.mjs 同步到 public/monaco/vs 的目录,
 *   配合 CSP 的 worker-src 'self' blob: 让 Monaco 内的 worker 也能起。
 * - 必须在任何 <Editor /> 挂载之前调用;本模块 import 即执行,幂等可重入。
 *
 * 中文本地化说明(「先 import nls.messages.zh-cn 再加载 monaco」同源):
 * - zh-cn.js 是纯脚本,仍由 index.html 在 <head> 里经典 <script> 静态引入,
 *   严格早于应用入口执行,已把 globalThis._VSCODE_NLS_MESSAGES 设为中文消息表;
 *   Monaco 的 localize() 每次调用时懒读该全局,查找栏/折叠提示等内置 UI 即为中文。
 * - 故意不配置 'vs/nls'.availableLanguages:该配置会让 vs/nls.messages-loader
 *   插件 AMD-require zh-cn.js,但纯脚本无 define() 注册、回调永不触发,
 *   editor.main 将永久挂起(编辑器空白),是已踩过的坑,勿回退。
 */
import monacoLoader from '@monaco-editor/loader';

let configured = false;

export function configureMonacoLoader(): void {
  if (configured) return;
  configured = true;
  monacoLoader.config({
    paths: {
      vs: `${import.meta.env.BASE_URL}monaco/vs`,
    },
  });
}

// import 即配置:见文件头说明
configureMonacoLoader();
