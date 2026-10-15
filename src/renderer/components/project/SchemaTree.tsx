import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Binary,
  Braces,
  Brackets,
  Hash,
  KeyRound,
  Link,
  RefreshCw,
  Sigma,
  Table2,
  ToggleLeft,
  Type,
  Zap,
} from 'lucide-react';
import {
  PlContextMenu,
  PlEmpty,
  PlIconButton,
  PlMenuItem,
  PlMenuSeparator,
  PlTree,
  type PlTreeNode,
} from 'plass-ui';
import { typeName } from '@/common/values';
import {
  loadCounts,
  openCollection,
  openQuery,
  type WorkspaceTab,
} from '@/renderer/store/slices/projectSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import type { FieldType, SchemaCollection, SchemaField } from '@/common/data';

const iconOf = (type: FieldType): ReactNode => {
  switch (type.kind) {
    case 'bool':
      return <ToggleLeft />;
    case 'int':
      return <Hash />;
    case 'float':
      return <Sigma />;
    case 'bytes':
      return <Binary />;
    case 'link':
      return <Link />;
    case 'list':
      return <Brackets />;
    case 'object':
      return <Braces />;
    default:
      return <Type />;
  }
};

interface SchemaTreeProps {
  /* Opens the dialog that adds an object to a collection */
  onAddObject: (collection: string) => void;
}

/*
 * The schema the file holds: its collections, each with how many objects it
 * has, and under each, its fields with their types, its key and its indexes.
 * A click on a collection, or on one of its fields, opens the collection in a
 * tab; a right click offers the rest.
 * */
export default function SchemaTree({ onAddObject }: SchemaTreeProps) {
  const [t, i18n] = useTranslation();
  const dispatch = useAppDispatch();
  const schema = useAppSelector((state) => state.project.session?.schema ?? null);
  const counts = useAppSelector((state) => state.project.counts);
  const activeCollection = useAppSelector((state) => {
    const { groups, focusedGroupId, tabs } = state.project;
    const group = groups.find((each) => each.id === focusedGroupId);
    const tab: WorkspaceTab | undefined = group?.activeTabId ? tabs[group.activeTabId] : undefined;

    return tab?.kind === 'collection' ? tab.collection : null;
  });
  const [menuCollection, setMenuCollection] = useState<string | null>(null);
  const language = i18n.resolvedLanguage ?? 'en';

  const items = useMemo((): PlTreeNode[] => {
    const fieldNode = (
      collection: SchemaCollection,
      field: SchemaField,
      path: string,
    ): PlTreeNode => {
      const index = collection.indexes.find(
        (each) => each.field === field.name && path === field.name,
      );
      const isKey = path === collection.key;

      return {
        id: `field:${collection.name}:${path}`,
        icon: isKey ? <KeyRound /> : iconOf(field.type),
        label: (
          <span className="tree-field" data-collection={collection.name}>
            <span className="tree-field__name">{field.name}</span>
            <span className="tree-field__type">
              {typeName(field.type)}
              {field.optional ? '?' : ''}
            </span>
            {index && (
              <span
                className="tree-field__index"
                title={index.unique ? t('sidebar.unique-index') : t('sidebar.index')}
              >
                <Zap aria-hidden="true" />
                {index.unique ? t('sidebar.unique') : ''}
              </span>
            )}
          </span>
        ),
        ...(field.type.kind === 'object'
          ? {
              children: field.type.fields.map((nested) =>
                fieldNode(collection, nested, `${path}.${nested.name}`),
              ),
            }
          : {}),
      };
    };

    return (schema?.collections ?? []).map((collection) => {
      const count = counts[collection.name];

      return {
        id: `collection:${collection.name}`,
        icon: <Table2 />,
        label: (
          <span
            className="tree-collection"
            data-collection={collection.name}
            data-testid="tree-collection"
          >
            <span className="tree-collection__name">{collection.name}</span>
            <span className="tree-collection__count">
              {count === undefined ? '' : new Intl.NumberFormat(language).format(count)}
            </span>
          </span>
        ),
        children: [
          ...(collection.autoIncrement
            ? [
                {
                  id: `field:${collection.name}:${collection.key}`,
                  icon: <KeyRound />,
                  label: (
                    <span className="tree-field" data-collection={collection.name}>
                      <span className="tree-field__name">{collection.key}</span>
                      <span className="tree-field__type">{t('sidebar.auto-increment')}</span>
                    </span>
                  ),
                },
              ]
            : []),
          ...collection.fields.map((field) => fieldNode(collection, field, field.name)),
        ],
      };
    });
  }, [schema, counts, language, t]);

  if (!schema) {
    return (
      <PlEmpty
        className="sidebar__empty"
        size="sm"
        title={t('sidebar.no-schema-title')}
        description={t('sidebar.no-schema-text')}
      />
    );
  }

  const menu = menuCollection ? (
    <>
      <PlMenuItem onClick={() => dispatch(openCollection({ collection: menuCollection }))}>
        {t('sidebar.open')}
      </PlMenuItem>
      <PlMenuItem
        onClick={() => dispatch(openCollection({ collection: menuCollection, inNewGroup: true }))}
      >
        {t('sidebar.open-beside')}
      </PlMenuItem>
      <PlMenuItem onClick={() => dispatch(openQuery({ collection: menuCollection }))}>
        {t('sidebar.new-query')}
      </PlMenuItem>
      <PlMenuSeparator />
      <PlMenuItem onClick={() => onAddObject(menuCollection)}>{t('sidebar.add-object')}</PlMenuItem>
    </>
  ) : (
    <PlMenuItem onClick={() => void dispatch(loadCounts())}>{t('sidebar.refresh')}</PlMenuItem>
  );

  return (
    <aside className="sidebar" aria-label={t('sidebar.title')} data-testid="sidebar">
      <div className="sidebar__head">
        <span className="sidebar__title">{t('sidebar.title')}</span>
        <span className="sidebar__version">
          {t('sidebar.schema-version', { version: schema.version })}
        </span>
        <PlIconButton
          size="xs"
          variant="ghost"
          label={t('sidebar.refresh')}
          icon={<RefreshCw />}
          onClick={() => void dispatch(loadCounts())}
        />
      </div>
      <div className="sidebar__tree-frame">
        <PlContextMenu size="sm" content={menu}>
          <div
            className="sidebar__tree"
            onContextMenu={(event) => {
              const element = (event.target as HTMLElement).closest<HTMLElement>(
                '[data-collection]',
              );

              setMenuCollection(element?.dataset.collection ?? null);
            }}
          >
            <PlTree
              size="sm"
              density="compact"
              items={items}
              selection="single"
              selected={activeCollection ? [`collection:${activeCollection}`] : []}
              onItemClick={(node) => {
                const [, collection] = node.id.split(':');

                if (collection) {
                  dispatch(openCollection({ collection }));
                }
              }}
            />
          </div>
        </PlContextMenu>
      </div>
    </aside>
  );
}
