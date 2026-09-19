/**
 * Titlebar 菜单栏声明 —— 文本编辑器工作区的 File / View 两个菜单
 *
 * 从 EditorWorkbench 拆出:菜单是「命令 + 可用性 + 键位标注」的纯声明,
 * 动作本体仍由调用方持有并经 `actions` 注入,这里只负责注册与禁用态。
 * `actions` 的每个成员都要是稳定引用(useCallback),否则菜单会在每次渲染
 * 重建并重写 menubar store。
 *
 * 菜单结构:
 * - File:
 *   - 新建 tab(快捷键 Ctrl+N)        → toolbar-new
 *   - 打开...(快捷键 Ctrl+O)      → toolbar-open
 *   - 打开文件夹...                    → toolbar-open-folder
 *   - 分隔线
 *   - 保存(快捷键 Ctrl+S)             → toolbar-save(disabled 无激活 tab)
 *   - 全部保存(快捷键 Ctrl+Shift+S)
 *   - 分隔线
 *   - 关闭(disabled 无激活 tab)
 *   - 全部关闭(disabled 无 tab)       → toolbar-close-all
 * - View:
 *   - 切换左栏(快捷键 Ctrl+B)         → toolbar-toggle-sidebar
 *
 * testId 沿用旧工具栏命名,保证现有测试无需修改。
 */
import { useMemo } from 'react';
import { FilePlus2, Folder, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '@/store/configStore';
import { useToolMenus } from '@/store/toolMenubarStore';
import { DEFAULT_SHORTCUTS, type ShortcutKey } from '@/types/config';
import type { ToolMenu } from '@/types/tool-menu';
import type { UnsavedSource } from './UnsavedPopover';
import type { EditorTab } from './schema';

export function useEditorWorkbenchMenus({
  toolId,
  activeTab,
  tabs,
  leftSidebarVisible,
  actions,
}: {
  toolId: string;
  /** 当前激活 Tab(保存 / 关闭项的可用性依据) */
  activeTab: EditorTab | null;
  /** 全部 Tab(「全部保存」「全部关闭」的可用性依据) */
  tabs: EditorTab[];
  /** 左栏当前是否可见(决定「视图 → 切换左栏」文案) */
  leftSidebarVisible: boolean;
  /** 菜单项动作,与工作区快捷键共用同一批回调 */
  actions: {
    newTab: () => void;
    open: () => Promise<void>;
    openFolder: () => Promise<void>;
    save: () => void;
    saveAll: () => Promise<void>;
    closeCurrent: () => void;
    closeAll: (source: UnsavedSource) => void;
    toggleSidebar: () => void;
  };
}): void {
  const { t } = useTranslation();
  const { newTab, open, openFolder, save, saveAll, closeCurrent, closeAll, toggleSidebar } =
    actions;

  const menus = useMemo<ToolMenu[]>(() => {
    /** 菜单快捷键标签:与快捷键绑定同源(用户自定义后菜单即时跟随);
     *  空串(禁用)不显示标签,避免出现「显示但不生效」的欺骗性提示 */
    const shortcutLabel = (key: ShortcutKey): string | undefined => {
      const combo = useConfigStore.getState().config?.shortcuts[key] ?? DEFAULT_SHORTCUTS[key];
      return combo || undefined;
    };
    return [
      {
        id: 'file',
        label: t('tools.text_editor.menu_file'),
        groups: [
          {
            items: [
              {
                id: 'new',
                label: t('tools.text_editor.menu_new'),
                shortcut: shortcutLabel('new_file'),
                icon: FilePlus2,
                onSelect: newTab,
                testId: 'toolbar-new',
              },
              {
                id: 'open',
                label: t('tools.text_editor.menu_open'),
                shortcut: shortcutLabel('open_file'),
                icon: FolderOpen,
                onSelect: () => void open(),
                testId: 'toolbar-open',
              },
              {
                id: 'open-folder',
                label: t('tools.text_editor.menu_open_folder'),
                icon: Folder,
                onSelect: () => void openFolder(),
                testId: 'toolbar-open-folder',
              },
            ],
          },
          {
            items: [
              {
                id: 'save',
                label: t('tools.text_editor.save'),
                shortcut: shortcutLabel('save_file'),
                onSelect: save,
                // 大文件 Tab 恒只读,保存不可用
                disabled: !activeTab || activeTab.largeFile,
                testId: 'toolbar-save',
              },
              {
                id: 'save-all',
                label: t('tools.text_editor.save_all'),
                shortcut: shortcutLabel('save_all'),
                onSelect: () => void saveAll(),
                disabled: tabs.every((t) => t.content === t.savedContent),
              },
            ],
          },
          {
            items: [
              {
                id: 'close',
                label: t('tools.text_editor.close'),
                shortcut: shortcutLabel('close_editor'),
                onSelect: closeCurrent,
                disabled: !activeTab,
              },
              {
                id: 'close-all',
                label: t('tools.text_editor.close_all'),
                shortcut: shortcutLabel('close_all_editors'),
                // 显式传 'tabs':菜单 onSelect 会带首个参数,不能让它误当 source
                onSelect: () => closeAll('tabs'),
                disabled: tabs.length === 0,
                testId: 'toolbar-close-all',
              },
            ],
          },
        ],
      },
      {
        id: 'view',
        label: t('tools.text_editor.menu_view'),
        groups: [
          {
            items: [
              {
                id: 'toggle-sidebar',
                label: leftSidebarVisible
                  ? t('tools.text_editor.menu_hide_sidebar')
                  : t('tools.text_editor.menu_show_sidebar'),
                shortcut: shortcutLabel('toggle_editor_sidebar'),
                onSelect: toggleSidebar,
                testId: 'toolbar-toggle-sidebar',
              },
            ],
          },
        ],
      },
    ];
  }, [
    activeTab,
    closeAll,
    closeCurrent,
    leftSidebarVisible,
    newTab,
    open,
    openFolder,
    save,
    saveAll,
    tabs,
    t,
    toggleSidebar,
  ]);
  useToolMenus(toolId, menus);
}
