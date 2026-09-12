/**
 * 图片工具批量队列共享模型(转换器 / PNG 压缩器同构复用)
 *
 * 设计:
 * - 队列项只持有 File 引用与执行态(pending/running/done/error/cancelled);
 *   执行函数由调用方注入(转换器 canvas 重编码 / 压缩器 png_compress),
 *   本模块只管队列生命周期、状态推进与产物记录。
 * - 串行执行(避免几十张大图同时解码把内存拉满),失败项标记后继续后续项。
 * - 命名产物沿用各工具单文件模式的规则,由调用方注入 makeOutputName。
 */

export type BatchItemStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface BatchItem<R = unknown> {
  id: string;
  file: File;
  status: BatchItemStatus;
  /** 输入字节数(file.size 快照) */
  inputBytes: number;
  /** 产物字节数(done 时有效) */
  outputBytes: number | null;
  /** 产物下载(由执行器生成;done 时有效) */
  download: (() => void) | null;
  /** 执行结果载荷(转换器:格式/尺寸;压缩器:null) */
  result: R | null;
  error: string | null;
}

/** 稳定 id(测试环境无 randomUUID 的兜底同 pdfDocsStore) */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `bi-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** File 列表 → 初始队列项(按传入顺序;泛型 R 为执行结果载荷类型) */
export function makeBatchItems<R = unknown>(files: readonly File[]): BatchItem<R>[] {
  return files.map((file) => ({
    id: createId(),
    file,
    status: 'pending',
    inputBytes: file.size,
    outputBytes: null,
    download: null,
    result: null,
    error: null,
  }));
}

export interface BatchRunOptions<R> {
  /** 单项执行:返回 { outputBytes, download, result };抛错即该项 error */
  run: (item: BatchItem<R>) => Promise<{
    outputBytes: number;
    download: () => void;
    result: R;
  }>;
  /** 每项状态推进时回调(渲染层 setState 更新对应项) */
  onUpdate: (items: BatchItem<R>[]) => void;
  /** 取消探针(返回 true 即中止后续 pending 项) */
  shouldStop: () => boolean;
}

/**
 * 串行执行队列:逐项 pending → running → done/error。
 * 返回执行后的完整队列(失败不中断;取消时剩余项保持 pending)。
 */
export async function runBatch<R>(
  input: readonly BatchItem<R>[],
  options: BatchRunOptions<R>,
): Promise<BatchItem<R>[]> {
  const items = input.map((i) => ({ ...i }));
  for (const item of items) {
    if (item.status !== 'pending') continue;
    if (options.shouldStop()) break;
    item.status = 'running';
    options.onUpdate([...items]);
    try {
      const out = await options.run(item);
      item.status = 'done';
      item.outputBytes = out.outputBytes;
      item.download = out.download;
      item.result = out.result;
      item.error = null;
    } catch (e) {
      item.status = 'error';
      item.error = e instanceof Error ? e.message : String(e);
    }
    options.onUpdate([...items]);
  }
  return items;
}

/** 队列统计(done 数 / 累计节省字节;负节省表示变大) */
export function batchSummary(items: readonly BatchItem[]): {
  done: number;
  error: number;
  pending: number;
  totalSaved: number;
} {
  let done = 0;
  let error = 0;
  let pending = 0;
  let totalSaved = 0;
  for (const i of items) {
    if (i.status === 'done') {
      done++;
      if (i.outputBytes !== null) totalSaved += i.inputBytes - i.outputBytes;
    } else if (i.status === 'error') error++;
    else if (i.status === 'pending') pending++;
  }
  return { done, error, pending, totalSaved };
}
