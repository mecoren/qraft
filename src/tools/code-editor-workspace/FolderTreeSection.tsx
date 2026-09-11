/**
 * 左栏「文件夹」树分组 —— 已打开根文件夹的懒加载目录树
 *
 * 位于「打开的编辑器」面板内、已打开文件列表下方(「对比差异」分组之前),
 * 独立折叠(仿 VSCode 资源管理器的多根工作区)。
 *
 * 高度策略:下方无「对比差异」分组时(fillHeight)去掉限高、撑满剩余空间;
 * 有对比差异分组时内容自适应、max-h-64 封顶,把空间让给下方分组。交互:
 * - 分组头点击 → 折叠/展开整个「文件夹」分组(仅本组,不影响文件列表)
 * - 根文件夹行:点击切换根的展开;hover 行尾显示关闭按钮(移除该根,
 *   不影响其中已打开的文件 Tab)
 * - 子目录行:点击展开/折叠;展开状态持久化在 workspace.expandedDirs,
 *   重启后还原
 * - 文件行:点击请求打开(onOpenFile)。二进制 / 非 UTF-8 等不受支持的
 *   文件由上层弹错误提示,**本组件不剔除任何节点**——文件始终显示在树中
 *
 * 懒加载策略:
 * - 展开某目录时才经 `fs_read_dir` 读取其子项,缓存在组件会话内存
 *   (childrenMap),不写入持久化工作区,避免大目录膨胀配置
 * - 父组件以 roots 签名作为 key 挂载本组件:任一文件夹打开/关闭都会
 *   重挂载并清空缓存,重新按 expandedDirs 自动补齐已展开目录的子项,
 *   无需手动维护缓存失效逻辑
 * - 加载失败 toast 提示并清除「已加载」标记,下次展开自动重试
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ChevronDown, Folder, FolderOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { FileIcon } from './FileIcon';
import { readDirectory, type DirEntry } from './fileOps';
import type { WorkspaceFolder } from './schema';

/** 目录树缩进步长(px/层) */
const DEPTH_STEP_PX = 12;

export interface FolderTreeSectionProps {
  /** 已打开的根文件夹列表(展示顺序即数组顺序) */
  folders: readonly WorkspaceFolder[];
  /** 处于展开状态的目录绝对路径集合(含根;持久化) */
  expandedDirs: readonly string[];
  /** 当前激活 Tab 的路径(用于高亮树中的活动文件;null 表示无激活文件) */
  activeTabPath?: string | null;
  /**
   * 是否撑满面板剩余高度(默认 false)。
   * 下方没有「对比差异」分组时置 true:树区去掉 max-h 上限并填满剩余空间,
   * 空白余量归入树区而非散落在面板底部;有对比差异分组时保持内容自适应
   * (max-h-64 封顶),把空间让给下方分组。
   */
  fillHeight?: boolean;
  /**
   * 缓存刷新信号(单调递增计数)。「新建 / 重命名 / 删除」落盘成功后由上层
   * 递增本值,本组件据此清空子项缓存并按 expandedDirs 重新拉取——树操作后
   * 无需整组件重挂载。变化即清空(不比对具体数值)。
   */
  refreshKey?: number;
  /** 切换目录展开/折叠 */
  onToggleDir?: (dirPath: string) => void;
  /** 关闭某个根文件夹 */
  onCloseFolder?: (rootPath: string) => void;
  /** 点击文件行请求打开(上层负责读取校验与报错) */
  onOpenFile?: (path: string) => void;
  /**
   * 右键菜单:在指定目录下新建条目(isDir 区分文件/文件夹)。
   * 上层负责 IPC、名称输入对话框、冲突报错与成功后递增 refreshKey;
   * 缺省则菜单不渲染树操作组。
   */
  onCreateEntry?: (dirPath: string, isDir: boolean) => void;
  /** 右键菜单:重命名条目(文件或目录);缺省则不渲染该项 */
  onRenameEntry?: (entry: DirEntry) => void;
  /** 右键菜单:删除条目(文件或空目录);缺省则不渲染该项 */
  onDeleteEntry?: (entry: DirEntry) => void;
  /** 右键菜单:在文件资源管理器中显示;缺省则不渲染该项 */
  onRevealEntry?: (entry: DirEntry) => void;
  /** 右键菜单:复制完整路径;缺省则不渲染该项 */
  onCopyEntryPath?: (entry: DirEntry) => void;
  /** 测试定位用 */
  'data-testid'?: string;
}

export function FolderTreeSection({
  folders,
  expandedDirs,
  activeTabPath = null,
  fillHeight = false,
  refreshKey = 0,
  onToggleDir,
  onCloseFolder,
  onOpenFile,
  onCreateEntry,
  onRenameEntry,
  onDeleteEntry,
  onRevealEntry,
  onCopyEntryPath,
  'data-testid': dataTestId,
}: FolderTreeSectionProps): JSX.Element | null {
  const { t } = useTranslation();
  /** 整个「文件夹」分组是否折叠(独立会话状态,不落盘) */
  const [collapsed, setCollapsed] = useState(false);
  /**
   * 子项缓存版本号:树操作落盘成功后随 refreshKey 推进,旧版本缓存在
   * 渲染期被视为不存在(等价清空),而 loadedRef 同步按版本重置——
   * 避免「effect 里同步 setState」(lint error)同时保证展开集合立即重载
   */
  const cacheVersion = Math.max(refreshKey, 0);
  /** 各版本的已加载目录子项缓存(version → dirPath → 排序后的条目);渲染读当前版本 */
  const [childrenMapByVersion, setChildrenMapByVersion] = useState<
    Record<number, Record<string, DirEntry[]>>
  >({});
  /** 加载中的目录(dirPath → true),驱动「加载中…」占位 */
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});
  const childrenMap = childrenMapByVersion[cacheVersion] ?? {};
  /**
   * 「已发起过加载」标记(同步 ref,供并发去重):
   * 与 childrenMap 分离的原因是失败重试需要能从标记中摘除而保留旧缓存。
   * 版本推进时整体重置(旧版本缓存作废,树操作后的重载不受去重拦截)。
   */
  const loadedRef = useRef<Set<string>>(new Set());
  /** 当前去重标记所属的缓存版本(lazy 重置:无需独立 effect) */
  const loadedVersionRef = useRef(0);

  /** 懒加载一个目录的子项;已在缓存/加载中时跳过 */
  const loadChildren = useCallback(
    async (dirPath: string, version: number): Promise<void> => {
      // 去重标记所属版本落后时先整体重置(树操作刷新后的首批加载):
      // 放在函数内而非渲染期改 ref,满足 hooks 规范;版本一致时零开销
      if (loadedVersionRef.current !== version) {
        loadedVersionRef.current = version;
        loadedRef.current = new Set();
      }
      if (loadedRef.current.has(dirPath)) return;
      loadedRef.current.add(dirPath);
      setLoadingDirs((prev) => ({ ...prev, [dirPath]: true }));
      try {
        const entries = await readDirectory(dirPath);
        // 只写入发起时的版本:refreshKey 已推进的迟到响应丢弃,
        // 避免旧数据覆盖树操作后的新拉取
        setChildrenMapByVersion((prev) => {
          if (version !== loadedVersionRef.current) return prev;
          return { ...prev, [version]: { ...(prev[version] ?? {}), [dirPath]: entries } };
        });
      } catch (e) {
        // 清除标记允许下次展开重试;提示具体原因(未授权/不存在等)
        loadedRef.current.delete(dirPath);
        toast.error(e instanceof Error ? e.message : t('tools.text_editor.read_dir_failed'));
      } finally {
        setLoadingDirs((prev) => {
          if (!(dirPath in prev)) return prev;
          const next = { ...prev };
          delete next[dirPath];
          return next;
        });
      }
    },
    [t],
  );

  // 所有处于展开状态的目录确保子项已加载:
  // 覆盖挂载还原(重启后 expandedDirs 持久化恢复)、用户展开与树操作刷新
  // (refreshKey 推进时旧版本缓存读取为空、loadedRef 随版本在 loadChildren
  // 入口重置,展开集合立即重载)三个来源。expandedDirs/refreshKey 任一变化
  // 都重跑此 effect 是预期行为:去重由 loadChildren 内部承担,不会重复请求
  useEffect(() => {
    for (const dir of expandedDirs) {
      void loadChildren(dir, cacheVersion);
    }
  }, [expandedDirs, refreshKey, cacheVersion, loadChildren]);

  // 无打开文件夹时不渲染任何内容(避免空分组头占位)
  if (folders.length === 0) return null;

  /**
   * 树行右键菜单(对齐 VSCode 资源管理器):
   * - 目录行:新建文件 / 新建文件夹 / 重命名 / 删除 / 资源管理器 / 复制路径
   * - 文件行:重命名 / 删除 / 资源管理器 / 复制路径
   * 未提供相应回调的项不渲染(能力缺失时不显示死菜单)。
   */
  const renderTreeContextMenu = (entry: DirEntry): JSX.Element => (
    <ContextMenuContent
      className="w-48"
      data-testid={dataTestId ? `${dataTestId}-ctx-menu` : undefined}
    >
      {entry.isDir && onCreateEntry && (
        <>
          <ContextMenuItem
            onSelect={() => onCreateEntry(entry.path, false)}
            data-testid="ctx-tree-new-file"
          >
            {t('tools.text_editor.tree_new_file')}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => onCreateEntry(entry.path, true)}
            data-testid="ctx-tree-new-folder"
          >
            {t('tools.text_editor.tree_new_folder')}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      {onRenameEntry && (
        <ContextMenuItem onSelect={() => onRenameEntry(entry)} data-testid="ctx-tree-rename">
          {t('tools.text_editor.rename')}
        </ContextMenuItem>
      )}
      {onDeleteEntry && (
        <ContextMenuItem onSelect={() => onDeleteEntry(entry)} data-testid="ctx-tree-delete">
          {t('tools.text_editor.tree_delete')}
        </ContextMenuItem>
      )}
      {(onRevealEntry || onCopyEntryPath) && <ContextMenuSeparator />}
      {onRevealEntry && (
        <ContextMenuItem onSelect={() => onRevealEntry(entry)} data-testid="ctx-tree-reveal">
          {t('tools.text_editor.reveal_in_explorer')}
        </ContextMenuItem>
      )}
      {onCopyEntryPath && (
        <ContextMenuItem onSelect={() => onCopyEntryPath(entry)} data-testid="ctx-tree-copy-path">
          {t('tools.text_editor.copy_path')}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );

  /** 渲染某个已展开目录的子节点列表(递归) */
  const renderChildren = (dirPath: string, depth: number): JSX.Element[] => {
    if (!expandedDirs.includes(dirPath)) return [];
    const children = childrenMap[dirPath];
    if (!children) {
      // 尚未加载完成:占位一行(首次展开 / 重挂载补载期间)
      if (loadingDirs[dirPath]) {
        return [
          <li
            key={`${dirPath}::loading`}
            style={{ paddingLeft: 8 + (depth + 1) * DEPTH_STEP_PX }}
            className="px-2 py-1 text-xs text-muted-foreground"
          >
            {t('tools.text_editor.folder_loading')}
          </li>,
        ];
      }
      return [];
    }
    return children.flatMap((entry) =>
      entry.isDir
        ? [
            <div key={entry.path}>
              {renderDirRow(entry, depth + 1)}
              {renderChildren(entry.path, depth + 1)}
            </div>,
          ]
        : [<div key={entry.path}>{renderFileRow(entry, depth + 1)}</div>],
    );
  };

  /** 目录行(含根与子目录):chevron + 图标 + 名称,点击切换展开;右键弹树操作菜单 */
  const renderDirRow = (entry: DirEntry, depth: number): JSX.Element => {
    const isRoot = folders.some((f) => f.rootPath === entry.path);
    const expanded = expandedDirs.includes(entry.path);
    const name = isRoot
      ? (folders
          .find((f) => f.rootPath === entry.path)
          ?.rootPath.split(/[\\/]/)
          .pop() ?? entry.name)
      : entry.name;
    const row = (
      <button
        type="button"
        data-testid={`${dataTestId}-node-${entry.name}`}
        data-path={entry.path}
        aria-expanded={expanded}
        title={entry.path}
        onClick={() => onToggleDir?.(entry.path)}
        className="group flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ paddingLeft: 4 + depth * DEPTH_STEP_PX }}
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            expanded ? 'rotate-0' : '-rotate-90',
          )}
        />
        {expanded ? (
          <FolderOpen aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Folder aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 truncate">{name}</span>
        {/* 根文件夹:hover 显示关闭按钮(ml-auto 锚定行尾) */}
        {isRoot && (
          <X
            aria-label={t('tools.text_editor.folder_close_aria', { name })}
            role="button"
            data-testid={`${dataTestId}-close-${name}`}
            data-folder-close={entry.path}
            onClick={(e) => {
              e.stopPropagation();
              onCloseFolder?.(entry.path);
            }}
            className="ml-auto size-3.5 shrink-0 cursor-pointer rounded-sm opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
      </button>
    );
    // 右键菜单:全部树操作就绪(任一回调提供)才包 ContextMenu,保持 DOM 简洁
    const menuReady =
      onCreateEntry || onRenameEntry || onDeleteEntry || onRevealEntry || onCopyEntryPath;
    if (!menuReady) return row;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        {renderTreeContextMenu(entry)}
      </ContextMenu>
    );
  };

  /** 文件行:占位槽(对齐目录文字)+ 文件图标 + 名称,点击请求打开;右键弹树操作菜单。
   * 不做任何「可否打开」预判或剔除:不支持文件同样显示,由上层报错。 */
  const renderFileRow = (entry: DirEntry, depth: number): JSX.Element => {
    const active = activeTabPath === entry.path;
    const row = (
      <button
        type="button"
        data-testid={`${dataTestId}-node-${entry.name}`}
        data-path={entry.path}
        aria-current={active ? 'true' : undefined}
        title={entry.path}
        onClick={() => onOpenFile?.(entry.path)}
        className={cn(
          'flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-xs transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active
            ? 'bg-sidebar-primary/15 font-medium text-sidebar-primary'
            : 'text-sidebar-foreground',
        )}
        style={{ paddingLeft: 4 + depth * DEPTH_STEP_PX }}
      >
        {/* 占位槽:与目录行 chevron 同宽,保证同级文件名与目录名对齐 */}
        <span aria-hidden className="w-3.5 shrink-0" />
        <FileIcon path={entry.path} />
        <span className="min-w-0 truncate">{entry.name}</span>
      </button>
    );
    const menuReady = onRenameEntry || onDeleteEntry || onRevealEntry || onCopyEntryPath;
    if (!menuReady) return row;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        {renderTreeContextMenu(entry)}
      </ContextMenu>
    );
  };

  return (
    <section
      aria-label={t('tools.text_editor.folder_section')}
      data-testid={`${dataTestId}-folder-section`}
      className={cn(
        'flex min-h-0 flex-col',
        // 撑满剩余高度时不需要底部分隔线(下方无分组);自适应模式保留分隔线
        fillHeight ? 'flex-1' : 'border-b border-sidebar-border flex-initial',
      )}
    >
      {/* 分组头:点击切换整组折叠;样式对齐「打开的编辑器」「对比差异」标题 */}
      <div
        data-testid={`${dataTestId}-folder-header`}
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
        className="flex h-7 shrink-0 min-w-0 cursor-pointer select-none items-center gap-1 overflow-hidden border-b border-sidebar-border px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-sidebar-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @max-[240px]/sidebar:gap-0.5 @max-[240px]/sidebar:px-2"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 transition-transform',
            collapsed ? '-rotate-90' : 'rotate-0',
          )}
        />
        <h2 className="min-w-0 flex-1 truncate">{t('tools.text_editor.folder_section')}</h2>
        {/* 数量徽章:根文件夹数量(样式对齐对比差异计数徽章) */}
        <span
          data-testid={`${dataTestId}-folder-count`}
          className="shrink-0 overflow-hidden whitespace-nowrap"
        >
          <span className="inline-block rounded bg-sidebar-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-primary">
            {folders.length}
          </span>
        </span>
      </div>

      {!collapsed && (
        <ScrollArea
          data-testid={`${dataTestId}-tree-scroll`}
          // fillHeight:不限高撑满剩余空间;否则内容自适应、max-h-64 封顶内部滚动
          className={cn('min-h-0', fillHeight ? 'flex-1' : 'max-h-64 flex-initial')}
        >
          <ul className="p-1.5 pt-1">
            {folders.map((f) => {
              const rootName = f.rootPath.split(/[\\/]/).pop() ?? f.rootPath;
              return (
                <li key={f.rootPath}>
                  {renderDirRow({ name: rootName, path: f.rootPath, isDir: true }, 0)}
                  {renderChildren(f.rootPath, 0)}
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </section>
  );
}
