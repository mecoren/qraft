/**
 * 欢迎页 —— Dashboard 风格首页
 *
 * 结构(对齐 token-monitor 仪表盘观感):
 * - 通栏 hero:紫粉渐变 +「欢迎使用 Qraft」+ 版本号 + 副标题
 * - KPI 行:4 个数字卡(工具总数 / 收藏数 / 最近使用 / 分类数),派生自现有 store
 * - 最近使用:卡片行(最多 6 张),为空时隐藏整个区块
 * - 收藏夹:卡片行,为空时隐藏
 * - 所有工具:按分类分组,每组带分类图标 + 中文名,组内自适应网格
 * - 底部反馈栏:浮动卡片样式(不再贴底分隔)
 */

import { useMemo, type JSX } from 'react';
import { Boxes, Heart, History, Info, LayoutGrid, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToolCard } from '@/components/tool-card';
import {
  CATALOG_CATEGORIES,
  TOOL_CATALOG,
  getCatalogEntry,
  type CatalogEntry,
  type CatalogCategoryId,
} from '@/lib/tool-catalog';
import { useUiStore } from '@/store/uiStore';
import { openExternal } from '@/lib/open-external';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/Logo';

const ISSUES_URL = 'https://github.com/mecoren/qraft/issues/new';
const APP_VERSION = 'v0.1.0';

/** KPI 卡片图标(顶部导入后别名,便于在 JSX 中按语义引用) */
const CatalogIcon = Boxes;
const FavoriteIcon = Heart;
const RecentIcon = History;
const CategoryIcon = LayoutGrid;

// ============================================================
// KPI 数字卡
// ============================================================

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: number;
  testId?: string;
}

function KpiCard({ icon: Icon, label, value, testId }: KpiCardProps): JSX.Element {
  return (
    <div
      data-testid={testId}
      className={cn(
        'relative flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-border bg-card/90 p-3.5 shadow-card',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg',
          'bg-primary/10 text-primary ring-1 ring-inset ring-primary/15',
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className="text-2xl font-bold leading-none tabular-nums"
          style={{ color: 'var(--kpi-accent)' }}
        >
          {value}
        </span>
        <span className="mt-1 truncate text-caption uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </span>
    </div>
  );
}

// ============================================================
// 分区标题(标签风)
// ============================================================

interface SectionProps {
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  testId?: string;
}

function Section({ title, icon: Icon, children, testId }: SectionProps): JSX.Element {
  return (
    <section data-testid={testId} className="mt-7 first:mt-0">
      <h2 className="mb-3 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon aria-hidden className="size-3.5" />}
        {title}
      </h2>
      {children}
    </section>
  );
}

// ============================================================
// WelcomePage 主组件
// ============================================================

export function WelcomePage(): JSX.Element {
  const openTool = useUiStore((s) => s.openTool);
  const setView = useUiStore((s) => s.setView);
  const favorites = useUiStore((s) => s.favorites);
  const recents = useUiStore((s) => s.recents);

  const recentEntries = useMemo(
    () =>
      recents
        .map((id) => getCatalogEntry(id))
        .filter((e): e is CatalogEntry => e !== null)
        .slice(0, 6),
    [recents],
  );

  const favoriteEntries = useMemo(
    () =>
      favorites.map((id) => getCatalogEntry(id)).filter((e): e is CatalogEntry => e !== null),
    [favorites],
  );

  /** 按分类分组的所有工具(非 special 条目) */
  const toolsByCategory = useMemo(() => {
    const map = new Map<CatalogCategoryId, CatalogEntry[]>();
    for (const cat of CATALOG_CATEGORIES) {
      const list = TOOL_CATALOG.filter((e) => !e.special && e.category === cat.id);
      if (list.length > 0) map.set(cat.id, list);
    }
    return map;
  }, []);

  const openEntry = (entry: CatalogEntry) => {
    if (entry.special === 'settings') setView('settings');
    else if (entry.special === 'extensions') setView('extensions');
    else openTool(entry.id);
  };

  /** KPI 派生值 */
  const totalTools = useMemo(() => TOOL_CATALOG.filter((e) => !e.special).length, []);
  const totalCategories = CATALOG_CATEGORIES.length;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background-layer">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Hero 通栏(纯背景,沿用页面 bg-background-layer) */}
        <div
          data-testid="welcome-hero"
          className="relative overflow-hidden px-8 py-9"
        >
          <div className="flex items-center gap-3">
            <Logo className="size-10 shrink-0 text-hero-foreground" />
            <h1 className="text-hero font-bold leading-tight tracking-tight text-hero-foreground">
              欢迎使用 Qraft
              <span className="ml-2 align-middle text-xs font-normal text-hero-foreground/70">
                {APP_VERSION}
              </span>
            </h1>
          </div>
          <p className="mt-1.5 text-body-sm text-hero-foreground/75">
            本地优先的开发者工具箱 —— 离线可用,零遥测
          </p>
        </div>

        <div className="px-8 pb-6">
          {/* KPI 行:dashboard 标志性组件 */}
          <div
            data-testid="welcome-kpi-row"
            className="-mt-6 relative z-10 grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            <KpiCard
              icon={CatalogIcon}
              label="工具总数"
              value={totalTools}
              testId="kpi-total-tools"
            />
            <KpiCard
              icon={FavoriteIcon}
              label="收藏夹"
              value={favorites.length}
              testId="kpi-favorites"
            />
            <KpiCard
              icon={RecentIcon}
              label="最近使用"
              value={recents.length}
              testId="kpi-recents"
            />
            <KpiCard
              icon={CategoryIcon}
              label="工具分类"
              value={totalCategories}
              testId="kpi-categories"
            />
          </div>

          {recentEntries.length > 0 && (
            <Section title="最近使用" testId="section-recents">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {recentEntries.map((entry) => (
                  <ToolCard key={entry.id} entry={entry} onOpen={() => openEntry(entry)} />
                ))}
              </div>
            </Section>
          )}

          {favoriteEntries.length > 0 && (
            <Section title="收藏夹" testId="section-favorites">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {favoriteEntries.map((entry) => (
                  <ToolCard key={entry.id} entry={entry} onOpen={() => openEntry(entry)} />
                ))}
              </div>
            </Section>
          )}

          {/* 所有工具:按分类分组,每组带分类图标小标题 */}
          <Section title="所有工具" testId="section-all-tools">
            <div className="flex flex-col gap-6">
              {CATALOG_CATEGORIES.map((cat) => {
                const list = toolsByCategory.get(cat.id);
                if (!list || list.length === 0) return null;
                const CatIcon = cat.icon;
                return (
                  <div key={cat.id} data-testid={`section-cat-${cat.id}`}>
                    <h3 className="mb-2.5 flex items-center gap-1.5 text-body-sm font-semibold">
                      <CatIcon
                        aria-hidden
                        className="size-4 text-primary"
                      />
                      {cat.label}
                      <span className="ml-1 text-xs font-normal text-muted-foreground tabular-nums">
                        {list.length}
                      </span>
                    </h3>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                      {list.map((entry) => (
                        <ToolCard
                          key={entry.id}
                          entry={entry}
                          onOpen={() => openEntry(entry)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* 底部反馈栏:浮动卡片样式 */}
          <div className="mt-7 flex items-center justify-between gap-4 rounded-xl border border-border bg-card/90 p-3.5 shadow-card">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info aria-hidden className="size-3.5 shrink-0 text-primary" />
              找不到想要的东西？在 GitHub 上提出功能请求
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void openExternal(ISSUES_URL)}
            >
              提出想法
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
