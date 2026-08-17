/**
 * 应用侧边栏 —— DevToys 风格可折叠导航
 *
 * 两种形态:
 * - 展开(224px):汉堡按钮 + 搜索框;所有工具 / 文本编辑器(固定) / 收藏夹(可展开) /
 *   7 个分类分组(可展开);底部 管理扩展 + 设置
 * - 折叠(56px 图标栏):汉堡 / 所有工具 / 文本编辑器(固定) / 分类图标 /
 *   底部设置;点击分类图标会展开侧栏并展开对应分类
 *
 * 交互:
 * - 搜索时切换为扁平过滤列表(匹配名称/描述/关键词)
 * - 当前工具 / 当前视图高亮,激活项左侧带 primary 指示条
 */

import { useMemo, useState, type JSX } from 'react';
import {
  ChevronRight,
  Home,
  Menu,
  Puzzle,
  Search,
  Settings,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CATALOG_CATEGORIES,
  CATALOG_BY_CATEGORY,
  DEFAULT_TOOL_ID,
  getCatalogEntry,
  searchCatalog,
  type CatalogEntry,
} from '@/lib/tool-catalog';
import { useUiStore } from '@/store/uiStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { ICON_STROKE_WIDTH } from '@/lib/icon-constants';

/** 固定展示在「所有工具」正下方的默认工具(文本编辑器);目录中不存在时降级为不渲染 */
const defaultEditorEntry = getCatalogEntry(DEFAULT_TOOL_ID);

// ============================================================
// 通用导航项
// ============================================================

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  depth?: 0 | 1;
  onClick: () => void;
  testId?: string;
  /** 右键菜单内容(仅工具条目传入);非工具条目不传,保持纯按钮语义 */
  contextMenu?: React.ReactNode;
}

function NavItem({
  icon: Icon,
  label,
  active,
  depth = 0,
  onClick,
  testId,
  contextMenu,
}: NavItemProps): JSX.Element {
  const button = (
    <button
      type="button"
      data-testid={testId}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={cn(
        'relative flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-sm transition-all duration-base ease-standard',
        depth === 0 ? 'pl-2.5' : 'pl-7',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        active
          ? 'bg-sidebar-accent/80 font-medium text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_var(--sidebar-border)]'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
          style={{
            background:
              'linear-gradient(180deg, var(--sidebar-primary) 0%, color-mix(in srgb, var(--sidebar-primary) 30%, transparent) 100%)',
          }}
        />
      )}
      <Icon aria-hidden className="size-4 shrink-0" strokeWidth={ICON_STROKE_WIDTH} />
      <span className="truncate">{label}</span>
    </button>
  );
  // 有右键菜单时用 ContextMenuTrigger 包裹按钮(asChild 保持按钮语义,菜单内容渲染于 Portal,
  // 点击菜单项不会触发按钮 onClick)
  if (contextMenu) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
        <ContextMenuContent>{contextMenu}</ContextMenuContent>
      </ContextMenu>
    );
  }
  return button;
}

/** 工具条目右键菜单内容:收藏/取消收藏 + 已收藏时追加排序(上移/下移) */
function ToolContextMenuContent({ entry }: { entry: CatalogEntry }): JSX.Element {
  const favorites = useUiStore((s) => s.favorites);
  const toggleFavorite = useUiStore((s) => s.toggleFavorite);
  const moveFavorite = useUiStore((s) => s.moveFavorite);
  const isFavorite = favorites.includes(entry.id);
  const index = favorites.indexOf(entry.id);

  return (
    <>
      <ContextMenuItem onSelect={() => toggleFavorite(entry.id)}>
        {isFavorite ? '取消收藏' : '收藏'}
      </ContextMenuItem>
      {isFavorite && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={index <= 0} onSelect={() => moveFavorite(entry.id, 'up')}>
            上移
          </ContextMenuItem>
          <ContextMenuItem
            disabled={index >= favorites.length - 1}
            onSelect={() => moveFavorite(entry.id, 'down')}
          >
            下移
          </ContextMenuItem>
        </>
      )}
    </>
  );
}

/** 可展开分组(收藏夹 / 分类) */
interface NavGroupProps {
  icon: LucideIcon;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  testId?: string;
}

function NavGroup({ icon, label, expanded, onToggle, children, testId }: NavGroupProps): JSX.Element {
  return (
    <div>
      <button
        type="button"
        data-testid={testId}
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-2 rounded-md py-1.5 pl-2.5 pr-2 text-sm transition-colors',
          'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        )}
      >
        {(() => {
          const Icon = icon;
          return <Icon aria-hidden className="size-4 shrink-0" strokeWidth={ICON_STROKE_WIDTH} />;
        })()}
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronRight
          aria-hidden
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
        />
      </button>
      {expanded && <div className="mt-0.5 flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}

// ============================================================
// 折叠态图标按钮
// ============================================================

function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  testId?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      title={label}
      aria-label={label}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={cn(
        'relative flex size-9 items-center justify-center rounded-md transition-all duration-base ease-standard',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        active
          ? 'bg-sidebar-accent/80 text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_var(--sidebar-border)]'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-1.5 top-0 h-[2px] rounded-full"
          style={{
            background:
              'linear-gradient(90deg, var(--sidebar-primary) 0%, color-mix(in srgb, var(--sidebar-primary) 30%, transparent) 100%)',
          }}
        />
      )}
      <Icon aria-hidden className="size-4" strokeWidth={ICON_STROKE_WIDTH} />
    </button>
  );
}

// ============================================================
// Sidebar 主组件
// ============================================================

export function Sidebar(): JSX.Element {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const goWelcome = useUiStore((s) => s.goWelcome);
  const openTool = useUiStore((s) => s.openTool);
  const favorites = useUiStore((s) => s.favorites);
  const expandedCategories = useUiStore((s) => s.expandedCategories);
  const toggleCategory = useUiStore((s) => s.toggleCategory);
  const expandCategory = useUiStore((s) => s.expandCategory);
  const currentToolId = useToolStateStore((s) => s.currentToolId);

  const [query, setQuery] = useState('');
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);

  const searching = query.trim().length > 0;
  const searchResults = useMemo(() => (searching ? searchCatalog(query) : []), [query, searching]);

  /** 收藏夹条目 */
  const favoriteEntries = useMemo(
    () =>
      favorites
        .map((id) => getCatalogEntry(id))
        .filter((e): e is CatalogEntry => e !== null),
    [favorites],
  );

  const isToolActive = (id: string) => view === 'tool' && currentToolId === id;

  const openEntry = (entry: CatalogEntry) => {
    if (entry.special === 'settings') setView('settings');
    else if (entry.special === 'extensions') setView('extensions');
    else openTool(entry.id);
  };

  // —— 折叠态:56px 图标栏 ——
  if (collapsed) {
    return (
      <nav
        aria-label="工具导航"
        data-testid="sidebar-rail"
        className="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar-layer py-2 text-sidebar-foreground"
      >
        <RailButton icon={Menu} label="展开侧栏" onClick={toggleSidebar} testId="rail-expand" />
        <RailButton icon={Home} label="所有工具" active={view === 'welcome'} onClick={goWelcome} testId="rail-home" />
        {defaultEditorEntry && (
          <RailButton
            icon={defaultEditorEntry.icon}
            label={defaultEditorEntry.name}
            active={isToolActive(DEFAULT_TOOL_ID)}
            onClick={() => openTool(DEFAULT_TOOL_ID)}
            testId="rail-text-editor"
          />
        )}
        <div aria-hidden className="my-1 h-px w-6 bg-sidebar-border" />
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col items-center gap-1 px-1.5">
            {CATALOG_CATEGORIES.map((c) => (
              <RailButton
                key={c.id}
                icon={c.icon}
                label={c.label}
                onClick={() => {
                  toggleSidebar();
                  expandCategory(c.id);
                }}
              />
            ))}
          </div>
        </ScrollArea>
        <div aria-hidden className="my-1 h-px w-6 bg-sidebar-border" />
        <RailButton
          icon={Settings}
          label="设置"
          active={view === 'settings'}
          onClick={() => setView('settings')}
          testId="rail-settings"
        />
      </nav>
    );
  }

  // —— 展开态:224px ——
  return (
    <nav
      aria-label="工具导航"
      data-testid="sidebar"
      className="flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-layer text-sidebar-foreground"
    >
      {/* 顶部:折叠按钮 + 搜索 */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <button
          type="button"
          data-testid="sidebar-collapse"
          aria-label="折叠侧栏"
          onClick={toggleSidebar}
          className="flex size-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Menu aria-hidden className="size-4" />
        </button>
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入以搜索工具..."
            aria-label="搜索工具"
            className="h-8 border-sidebar-border bg-background pl-8 text-sm focus-visible:ring-2 focus-visible:ring-sidebar-ring/60"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {searching ? (
            // —— 搜索态:扁平结果 ——
            searchResults.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                未找到匹配「{query.trim()}」的工具
              </p>
            ) : (
              searchResults.map((entry) => (
                <NavItem
                  key={entry.id}
                  icon={entry.icon}
                  label={entry.name}
                  active={!entry.special && isToolActive(entry.id)}
                  onClick={() => openEntry(entry)}
                  contextMenu={
                    !entry.special ? <ToolContextMenuContent entry={entry} /> : undefined
                  }
                />
              ))
            )
          ) : (
            // —— 常态:所有工具 / 文本编辑器(固定) / 收藏夹 / 分类树 ——
            <>
              <NavItem
                icon={Home}
                label="所有工具"
                active={view === 'welcome'}
                onClick={goWelcome}
                testId="nav-all-tools"
              />

              {defaultEditorEntry && (
                <NavItem
                  icon={defaultEditorEntry.icon}
                  label={defaultEditorEntry.name}
                  active={isToolActive(DEFAULT_TOOL_ID)}
                  onClick={() => openTool(DEFAULT_TOOL_ID)}
                  testId="nav-text-editor"
                  contextMenu={<ToolContextMenuContent entry={defaultEditorEntry} />}
                />
              )}

              <NavGroup
                icon={Star}
                label="收藏夹"
                expanded={favoritesExpanded}
                onToggle={() => setFavoritesExpanded((v) => !v)}
                testId="nav-favorites"
              >
                {favoriteEntries.length === 0 ? (
                  <p className="px-7 py-1 text-xs text-muted-foreground">
                    右键点击侧栏中的工具即可收藏
                  </p>
                ) : (
                  favoriteEntries.map((entry) => (
                    <NavItem
                      key={entry.id}
                      icon={entry.icon}
                      label={entry.name}
                      depth={1}
                      active={!entry.special && isToolActive(entry.id)}
                      onClick={() => openEntry(entry)}
                      contextMenu={
                        !entry.special ? <ToolContextMenuContent entry={entry} /> : undefined
                      }
                    />
                  ))
                )}
              </NavGroup>

              {CATALOG_CATEGORIES.map((cat) => {
                const entries = CATALOG_BY_CATEGORY.get(cat.id) ?? [];
                if (entries.length === 0) return null;
                return (
                  <NavGroup
                    key={cat.id}
                    icon={cat.icon}
                    label={cat.label}
                    expanded={expandedCategories.includes(cat.id)}
                    onToggle={() => toggleCategory(cat.id)}
                    testId={`nav-cat-${cat.id}`}
                  >
                    {entries.map((entry) => (
                      <NavItem
                        key={entry.id}
                        icon={entry.icon}
                        label={entry.name}
                        depth={1}
                        active={isToolActive(entry.id)}
                        onClick={() => openTool(entry.id)}
                        contextMenu={<ToolContextMenuContent entry={entry} />}
                      />
                    ))}
                  </NavGroup>
                );
              })}
            </>
          )}
        </div>
      </ScrollArea>

      {/* 底部:管理扩展 + 设置 */}
      <div className="flex flex-col gap-0.5 border-t border-sidebar-border px-2 py-2">
        <NavItem
          icon={Puzzle}
          label="管理扩展"
          active={view === 'extensions'}
          onClick={() => setView('extensions')}
          testId="nav-extensions"
        />
        <NavItem
          icon={Settings}
          label="设置"
          active={view === 'settings'}
          onClick={() => setView('settings')}
          testId="nav-settings"
        />
      </div>
    </nav>
  );
}
