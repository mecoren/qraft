/**
 * Monaco 原生差异服务 —— 常驻隐藏 DiffEditor 计算行级 + 字符级差异
 *
 * 背景:monaco-editor 不暴露纯函数 diff 入口(深路径 ESM 直调会与本地
 * AMD 构建形成双实例,见 prd/text-compare-refactor),唯一官方路径是挂载
 * DiffEditor 后读 getLineChanges。本服务维护一个离屏(8×8,视口外)的只读
 * DiffEditor 单例,把 advanced 算法的 ILineChange 经 monaco-diff-mapper
 * 转回 LineDiffResult,供 diff-service 优先调度;Monaco 不可用/超时则
 * reject,由调用方回退 jsdiff,功能不缺失。
 *
 * 约束:
 * - monaco 实例取 AMD 侧(monaco-loader-config 已把 loader 指向本地
 *   public/monaco/vs;__getMonacoInstance 复用可见编辑器已加载的实例,
 *   未加载时 init() 等待同一份加载,不与 @monaco-editor/react 冲突,
 *   loader.init 天然可重入)。
 * - 必须有真实 DOM(离屏 div 挂 body);jsdom/SSR 下直接不可用——单测走
 *   jsdiff 兜底,速度与稳定性不受影响。
 * - 单隐藏实例串行计算(多 compute 经 promise 链排队),模型每次按需创建
 *   并 dispose,不常驻双份文本。
 * - 空白忽略走原生 ignoreTrimWhitespace(与 VSCode DiffEditor 默认同义:
 *   行分组恒按 trim 比较,开关只决定 trim 差异行是否二次字符 diff),
 *   每次计算前经 updateOptions 跟随开关;大小写/EOL 走自有预处理
 *   (均不改行数,装饰行号免回映射)。
 *   注意:原生忽略首尾全空白,jsdiff 兜底仅剥行尾——兜底命中时行首
 *   缩进差异仍会显形,属已知小口径差(兜底本就罕见)。
 * - 本模块只做计算,不碰可见编辑器/装饰;类型引用全部 import type,无
 *   ESM 值导入,不污染 AMD 单例。
 */
import monacoLoader from '@monaco-editor/loader';
import type { editor } from 'monaco-editor';
import { normalizeEol, type ComputeLineDiffOptions, type LineDiffResult } from './diff-utils';
import type { DiffService } from './diff-service';
import { mapLineChangesToDiffResult } from './monaco-diff-mapper';

// Monaco loader 路径配置(import 即执行,init 走本地资源,不联网)
import '@/lib/monaco-loader-config';

type MonacoInstance = Awaited<ReturnType<typeof monacoLoader.init>>;

/** AMD 加载等待上限:超时即判不可用,调用方回退 jsdiff */
const MONACO_INIT_TIMEOUT_MS = 2500;
/** 单次差异等待上限(需大于 maxComputationTime,留 worker 往返余量) */
const MONACO_DIFF_TIMEOUT_MS = 8000;
/** Monaco 侧计算超时(与 IDiffEditorConstructionOptions 默认 5000 对齐) */
const MONACO_MAX_COMPUTATION_MS = 5000;

/**
 * 当前环境是否可能跑通 Monaco(有 DOM 且非测试替身)。
 * jsdom 下 loader.init 永不 settle(外部 script 不执行),必须同步短路,
 * 否则每次 compute 都要空等超时,单测被拖慢数秒。
 */
export function isMonacoDiffUsable(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return false;
  return true;
}

/** 进程内共享的 AMD 实例加载(首个可见编辑器挂载后即同步命中) */
let sharedMonacoPromise: Promise<MonacoInstance> | null = null;

function loadSharedMonaco(): Promise<MonacoInstance> {
  const existing = monacoLoader.__getMonacoInstance();
  if (existing) return Promise.resolve(existing);
  if (!sharedMonacoPromise) {
    sharedMonacoPromise = Promise.race([
      monacoLoader.init(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('monaco init timeout')), MONACO_INIT_TIMEOUT_MS);
      }),
    ]).catch((err: unknown) => {
      // 失败不缓存:下次 compute 重试(届时可见编辑器可能已加载完成)
      sharedMonacoPromise = null;
      throw err;
    });
  }
  return sharedMonacoPromise;
}

/**
 * 等待隐藏 DiffEditor 算出结果。
 * 小输入 getLineChanges 常同步就绪;大输入经 onDidUpdateDiff 异步到达;
 * 超时返回 null,调用方回退 jsdiff。
 */
function waitForLineChanges(
  diffEditor: editor.IStandaloneDiffEditor,
): Promise<readonly editor.ILineChange[] | null> {
  const ready = diffEditor.getLineChanges();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      disp.dispose();
      resolve(null);
    }, MONACO_DIFF_TIMEOUT_MS);
    const disp = diffEditor.onDidUpdateDiff(() => {
      clearTimeout(timer);
      disp.dispose();
      resolve(diffEditor.getLineChanges());
    });
  });
}

/**
 * 比较前预处理(不改行数):空白差异交原生 ignoreTrimWhitespace 处理,
 * 这里只做大小写/EOL 归一(原生无对应选项)。
 */
function preprocess(text: string, options: ComputeLineDiffOptions): string {
  let out = text;
  if (options.ignoreEol) out = normalizeEol(out);
  if (options.ignoreCase) out = out.toLowerCase();
  return out;
}

/**
 * 空差异结果(预处理后完全相同时 fast-return,免建模型)。
 * 每次调用返回新数组:decos/blocks 被下游只读消费,但共享引用仍是
 * 跨调用污染隐患,不省这一次分配。
 */
function emptyResult(): LineDiffResult {
  return {
    stats: { added: 0, removed: 0, modified: 0 },
    originalDecos: [],
    modifiedDecos: [],
    blocks: [],
    degraded: false,
    similarity: 1,
  };
}

/**
 * 创建 Monaco 原生差异服务(与 DiffService 同接口)。
 * 不可用(无 DOM/jsdom/加载失败)或单次超时时 compute 直接 reject,
 * 调用方(diff-service 混合调度)回退 jsdiff。
 */
export function createMonacoDiffService(): DiffService {
  let diffEditor: editor.IStandaloneDiffEditor | null = null;
  let container: HTMLDivElement | null = null;
  let disposed = false;
  // 单实例串行:并发 compute 经尾链排队,避免 setModel 互相覆盖
  let tail: Promise<unknown> = Promise.resolve();

  const ensureEditor = async (): Promise<editor.IStandaloneDiffEditor> => {
    if (diffEditor) return diffEditor;
    if (!isMonacoDiffUsable()) throw new Error('monaco diff unavailable (no DOM or test env)');
    const monaco = await loadSharedMonaco();
    if (disposed) throw new Error('monaco diff service disposed');
    if (diffEditor) return diffEditor;
    container = document.createElement('div');
    container.setAttribute('aria-hidden', 'true');
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    container.style.top = '-10000px';
    container.style.width = '8px';
    container.style.height = '8px';
    container.style.visibility = 'hidden';
    container.style.pointerEvents = 'none';
    document.body.appendChild(container);
    // 经局部变量返回:await 之后外层 let 的收窄会失效,直接返回创建结果
    const created = monaco.editor.createDiffEditor(container, {
      readOnly: true,
      renderSideBySide: true,
      diffAlgorithm: 'advanced',
      ignoreTrimWhitespace: false,
      maxComputationTime: MONACO_MAX_COMPUTATION_MS,
      automaticLayout: false,
    });
    diffEditor = created;
    return created;
  };

  const computeInner = async (
    original: string,
    modified: string,
    diffOptions: ComputeLineDiffOptions,
  ): Promise<LineDiffResult> => {
    const cmpOriginal = preprocess(original, diffOptions);
    const cmpModified = preprocess(modified, diffOptions);
    if (cmpOriginal === cmpModified) return emptyResult();

    const ed = await ensureEditor();
    if (disposed) throw new Error('monaco diff service disposed');
    // 空白口径跟随本次开关(VSCode 语义:默认忽略首尾空白);
    // updateOptions 只改 diff 选项,不重建模型/视图,开销可忽略
    ed.updateOptions({ ignoreTrimWhitespace: diffOptions.ignoreWhitespace ?? false });
    const monaco = monacoLoader.__getMonacoInstance();
    if (!monaco) throw new Error('monaco instance lost');
    const originalModel = monaco.editor.createModel(cmpOriginal, 'plaintext');
    const modifiedModel = monaco.editor.createModel(cmpModified, 'plaintext');
    try {
      ed.setModel({ original: originalModel, modified: modifiedModel });
      const changes = await waitForLineChanges(ed);
      if (!changes) throw new Error('monaco diff timeout');
      // 列号基于比较文本;装饰构建处另有行列夹取兜底(预处理不改行数)
      return mapLineChangesToDiffResult(changes, cmpOriginal, cmpModified);
    } finally {
      ed.setModel(null);
      originalModel.dispose();
      modifiedModel.dispose();
    }
  };

  const compute = (
    original: string,
    modified: string,
    diffOptions: ComputeLineDiffOptions,
  ): Promise<LineDiffResult> => {
    const task = tail.then(() => computeInner(original, modified, diffOptions));
    // 尾链永不断:失败只影响本次,后续 compute 照常排队
    tail = task.catch(() => undefined);
    return task;
  };

  const dispose = (): void => {
    disposed = true;
    try {
      diffEditor?.setModel(null);
      diffEditor?.dispose();
    } catch {
      // 卸载期异常直接吞掉，不影响页面 teardown
    }
    diffEditor = null;
    if (container) {
      container.remove();
      container = null;
    }
  };

  return { compute, dispose };
}
