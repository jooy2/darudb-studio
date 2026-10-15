import { useEffect, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Table2, Wrench, X } from 'lucide-react';
import { PlContextMenu, PlEmpty, PlMenuItem, PlMenuSeparator, PlPane, PlPanes } from 'plass-ui';
import CollectionTab from '@/renderer/components/project/CollectionTab';
import QueryTab from '@/renderer/components/project/QueryTab';
import ToolsTab from '@/renderer/components/project/ToolsTab';
import {
  activateTab,
  closeOtherTabs,
  closeTab,
  focusGroup,
  groupsResized,
  MAX_GROUPS,
  mergeGroup,
  moveTab,
  splitTab,
  type TabGroup,
  type WorkspaceTab,
} from '@/renderer/store/slices/projectSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';

// The type of what a dragged tab carries, so a drop of anything else is ignored
const TAB_DRAG_TYPE = 'application/x-darudb-studio-tab';

const isTabDrag = (event: DragEvent): boolean => event.dataTransfer.types.includes(TAB_DRAG_TYPE);

function TabIcon({ tab }: { tab: WorkspaceTab }) {
  switch (tab.kind) {
    case 'query':
      return <Search aria-hidden="true" />;
    case 'tools':
      return <Wrench aria-hidden="true" />;
    default:
      return <Table2 aria-hidden="true" />;
  }
}

function TabContent({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  switch (tab.kind) {
    case 'query':
      return <QueryTab tab={tab} active={active} />;
    case 'tools':
      return <ToolsTab />;
    default:
      return <CollectionTab tab={tab} active={active} />;
  }
}

interface GroupViewProps {
  group: TabGroup;
  index: number;
  groupCount: number;
  focused: boolean;
  dragging: string | null;
  onDragging: (tabId: string | null) => void;
}

/*
 * One group of tabs: its strip, and the tab in front. Every tab of the group
 * stays mounted and only the one in front shows, so a grid keeps its place
 * and a query its results while another tab is in front.
 * */
function GroupView({ group, index, groupCount, focused, dragging, onDragging }: GroupViewProps) {
  const [t] = useTranslation();
  const dispatch = useAppDispatch();
  const tabs = useAppSelector((state) => state.project.tabs);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [menuTab, setMenuTab] = useState<string | null>(null);

  const titleOf = (tab: WorkspaceTab): string => {
    if (tab.kind === 'query') {
      return t('workspace.query-title', { number: tab.number });
    }

    return tab.kind === 'tools' ? t('workspace.tools') : (tab.collection ?? '');
  };

  /* Where in the strip a drop at `clientX` puts the tab: before the first tab whose middle is past it */
  const dropIndex = (event: DragEvent<HTMLDivElement>): number => {
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
    const at = elements.findIndex((element) => {
      const box = element.getBoundingClientRect();

      return event.clientX < box.left + box.width / 2;
    });

    return at < 0 ? elements.length : at;
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>, tabId: string): void => {
    const at = group.tabIds.indexOf(tabId);
    let next: string | undefined;

    if (event.key === 'ArrowRight') {
      next = group.tabIds[(at + 1) % group.tabIds.length];
    } else if (event.key === 'ArrowLeft') {
      next = group.tabIds[(at - 1 + group.tabIds.length) % group.tabIds.length];
    } else if (event.key === 'Delete') {
      dispatch(closeTab(tabId));
      event.preventDefault();

      return;
    }

    if (next) {
      event.preventDefault();
      dispatch(activateTab(next));
      document.getElementById(`tab-${next}`)?.focus();
    }
  };

  const menu = menuTab ? (
    <>
      <PlMenuItem onClick={() => dispatch(closeTab(menuTab))}>
        {t('workspace.close-tab')}
      </PlMenuItem>
      <PlMenuItem
        disabled={group.tabIds.length < 2}
        onClick={() => dispatch(closeOtherTabs(menuTab))}
      >
        {t('workspace.close-others')}
      </PlMenuItem>
      <PlMenuSeparator />
      <PlMenuItem
        disabled={groupCount >= MAX_GROUPS || group.tabIds.length < 2}
        onClick={() => dispatch(splitTab({ tabId: menuTab, side: 'right' }))}
      >
        {t('workspace.split-right')}
      </PlMenuItem>
      <PlMenuItem
        disabled={groupCount >= MAX_GROUPS || group.tabIds.length < 2}
        onClick={() => dispatch(splitTab({ tabId: menuTab, side: 'left' }))}
      >
        {t('workspace.split-left')}
      </PlMenuItem>
      <PlMenuSeparator />
      <PlMenuItem disabled={index === 0} onClick={() => dispatch(mergeGroup(group.id))}>
        {t('workspace.merge-left')}
      </PlMenuItem>
    </>
  ) : (
    <PlMenuItem disabled={index === 0} onClick={() => dispatch(mergeGroup(group.id))}>
      {t('workspace.merge-left')}
    </PlMenuItem>
  );

  return (
    <section
      className={`tab-group${focused ? ' tab-group--focused' : ''}`}
      data-testid="tab-group"
      aria-label={t('workspace.group', { number: index + 1 })}
      onFocusCapture={() => dispatch(focusGroup(group.id))}
      onMouseDownCapture={() => dispatch(focusGroup(group.id))}
    >
      <div className="tab-strip-frame">
        <PlContextMenu size="sm" content={menu}>
          <div
            className="tab-strip"
            // Drops and the context menu land on the strip around the tabs
            onContextMenu={(event) => {
              const element = (event.target as HTMLElement).closest<HTMLElement>('[data-tab-id]');

              setMenuTab(element?.dataset.tabId ?? null);
            }}
            onDragOver={(event) => {
              if (isTabDrag(event)) {
                event.preventDefault();
                setDropAt(dropIndex(event));
              }
            }}
            onDragLeave={() => setDropAt(null)}
            onDrop={(event) => {
              const tabId = event.dataTransfer.getData(TAB_DRAG_TYPE);

              if (tabId) {
                event.preventDefault();
                dispatch(moveTab({ tabId, groupId: group.id, index: dropIndex(event) }));
              }

              setDropAt(null);
            }}
          >
            <div className="tab-strip__tabs" role="tablist" aria-label={t('workspace.tabs')}>
              {group.tabIds.map((tabId, at) => {
                const tab = tabs[tabId];

                if (!tab) {
                  return null;
                }

                const active = group.activeTabId === tabId;
                const title = titleOf(tab);

                return (
                  <div
                    key={tabId}
                    id={`tab-${tabId}`}
                    className={[
                      'tab',
                      active ? 'tab--active' : '',
                      dropAt === at ? 'tab--drop-before' : '',
                      dragging === tabId ? 'tab--dragging' : '',
                    ].join(' ')}
                    data-tab-id={tabId}
                    data-testid="tab"
                    role="tab"
                    aria-selected={active}
                    aria-controls={`panel-${tabId}`}
                    tabIndex={active ? 0 : -1}
                    draggable
                    title={title}
                    onClick={() => dispatch(activateTab(tabId))}
                    onKeyDown={(event) => handleTabKeyDown(event, tabId)}
                    onAuxClick={(event) => {
                      // A middle click closes a tab, as in a browser
                      if (event.button === 1) {
                        dispatch(closeTab(tabId));
                      }
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(TAB_DRAG_TYPE, tabId);
                      event.dataTransfer.effectAllowed = 'move';
                      onDragging(tabId);
                    }}
                    onDragEnd={() => onDragging(null)}
                  >
                    <TabIcon tab={tab} />
                    <span className="tab__title">{title}</span>
                    <button
                      type="button"
                      className="tab__close"
                      aria-label={t('workspace.close', { title })}
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation();
                        dispatch(closeTab(tabId));
                      }}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
            <span
              className={`tab-strip__end${dropAt === group.tabIds.length ? ' tab-strip__end--drop' : ''}`}
            />
          </div>
        </PlContextMenu>
      </div>
      <div className="tab-group__body">
        {group.tabIds.map((tabId) =>
          tabs[tabId] ? (
            <div
              key={tabId}
              id={`panel-${tabId}`}
              className="tab-panel"
              role="tabpanel"
              aria-labelledby={`tab-${tabId}`}
              hidden={group.activeTabId !== tabId}
            >
              <TabContent tab={tabs[tabId]} active={focused && group.activeTabId === tabId} />
            </div>
          ) : null,
        )}
        {dragging !== null && groupCount < MAX_GROUPS && (
          // While a tab is dragged, the right edge of the group splits it off into a group of its own
          <div
            className={`split-zone${splitting ? ' split-zone--over' : ''}`}
            data-testid="split-zone"
            onDragOver={(event) => {
              if (isTabDrag(event)) {
                event.preventDefault();
                setSplitting(true);
              }
            }}
            onDragLeave={() => setSplitting(false)}
            onDrop={(event) => {
              const tabId = event.dataTransfer.getData(TAB_DRAG_TYPE);

              if (tabId) {
                event.preventDefault();
                dispatch(splitTab({ tabId, groupId: group.id, side: 'right' }));
              }

              setSplitting(false);
            }}
          >
            {t('workspace.drop-split')}
          </div>
        )}
      </div>
    </section>
  );
}

/*
 * The tabs of the project, in groups side by side that the user splits and
 * merges: from a tab's context menu, or by dragging a tab to another strip or
 * to the right edge of a group. The groups share the width, and their
 * borders move.
 * */
export default function Workspace() {
  const [t] = useTranslation();
  const groups = useAppSelector((state) => state.project.groups);
  const focusedGroupId = useAppSelector((state) => state.project.focusedGroupId);
  const groupSizes = useAppSelector((state) => state.project.groupSizes);
  const dispatch = useAppDispatch();
  const [dragging, setDragging] = useState<string | null>(null);

  // A tab moved to another strip leaves its own before its drag ends, so the
  // end of the drag is heard on the window, whichever way it ends
  useEffect(() => {
    const stop = (): void => setDragging(null);

    window.addEventListener('drop', stop);
    window.addEventListener('dragend', stop);

    return () => {
      window.removeEventListener('drop', stop);
      window.removeEventListener('dragend', stop);
    };
  }, []);

  if (groups.every((group) => group.tabIds.length === 0)) {
    return (
      <PlEmpty
        className="workspace-empty"
        data-testid="workspace-empty"
        icon={<Table2 />}
        title={t('workspace.empty-title')}
        description={t('workspace.empty-text')}
      />
    );
  }

  return (
    <PlPanes
      // A new number of groups starts their widths over, shared evenly
      key={groups.length}
      className="workspace"
      orientation="horizontal"
      resizable
      label={t('workspace.groups')}
      onResizeEnd={(sizes) => dispatch(groupsResized(sizes))}
    >
      {groups.map((group, index) => (
        <PlPane
          key={group.id}
          // The shares the user set hold while the groups stay as many
          defaultSize={
            groupSizes?.length === groups.length ? groupSizes[index] : `${100 / groups.length}%`
          }
          minSize="240px"
        >
          <GroupView
            group={group}
            index={index}
            groupCount={groups.length}
            focused={group.id === focusedGroupId}
            dragging={dragging}
            onDragging={setDragging}
          />
        </PlPane>
      ))}
    </PlPanes>
  );
}
