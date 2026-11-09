import { memo, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Binary,
  Braces,
  Brackets,
  CalendarClock,
  FileCode,
  Hash,
  KeyRound,
  Link,
  Plus,
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
import type { SchemaEditRequest } from '@/renderer/components/project/SchemaEditDialog';
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
    case 'date':
      return <CalendarClock />;
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
  /* Opens the schema of one collection, or of the whole file for `null` */
  onViewSchema: (collection: string | null) => void;
  /* Asks for a change of the schema, see `SchemaEditDialog` */
  onEditSchema: (request: SchemaEditRequest) => void;
}

/*
 * The schema the file holds: its collections, each with how many objects it
 * has, and under each, its fields with their types, its key and its indexes.
 * An index on one field is marked on that field, an embedded one's included;
 * an index on several fields follows the fields, under the names of its own.
 * A click on a collection, or on one of its fields, opens the collection in a
 * tab; a right click offers the rest, the changes of the schema among them:
 * a collection added, renamed or deleted, or a field of one of its own.
 * */
function SchemaTree({ onAddObject, onViewSchema, onEditSchema }: SchemaTreeProps) {
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
  // What the context menu is for: a collection, and a field of its own when one was clicked
  const [menuCollection, setMenuCollection] = useState<string | null>(null);
  const [menuField, setMenuField] = useState<string | null>(null);
  const language = i18n.resolvedLanguage ?? 'en';

  const items = useMemo((): PlTreeNode[] => {
    const fieldNode = (
      collection: SchemaCollection,
      field: SchemaField,
      path: string,
    ): PlTreeNode => {
      const index = collection.indexes.find(
        (each) => each.fields.length === 1 && each.fields[0] === path,
      );
      const isKey = path === collection.key;

      return {
        id: `field:${collection.name}:${path}`,
        icon: isKey ? <KeyRound /> : iconOf(field.type),
        label: (
          <span
            className="tree-field"
            data-collection={collection.name}
            // A field of the collection's own, which a change of the schema can name
            data-field={path === field.name ? field.name : undefined}
          >
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
          ...collection.indexes
            .filter((index) => index.fields.length > 1)
            .map((index): PlTreeNode => ({
              id: `index:${collection.name}:${JSON.stringify(index.fields)}`,
              icon: <Zap />,
              label: (
                <span
                  className="tree-field"
                  data-collection={collection.name}
                  data-testid="tree-index"
                >
                  <span className="tree-field__name">{index.fields.join(', ')}</span>
                  <span className="tree-field__type">
                    {index.unique ? t('sidebar.unique-index') : t('sidebar.index')}
                  </span>
                </span>
              ),
            })),
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

  const menuSchema = schema.collections.find((collection) => collection.name === menuCollection);
  const fieldMenu =
    menuCollection && menuField ? (
      <>
        <PlMenuSeparator />
        <PlMenuItem
          onClick={() =>
            onEditSchema({ kind: 'rename-field', collection: menuCollection, field: menuField })
          }
        >
          {t('schema-edit.rename-field')}
        </PlMenuItem>
        <PlMenuItem
          color="danger"
          // The key of a collection with one of its own stays
          disabled={menuSchema?.autoIncrement === false && menuSchema.key === menuField}
          onClick={() =>
            onEditSchema({ kind: 'delete-field', collection: menuCollection, field: menuField })
          }
        >
          {t('schema-edit.delete-field')}
        </PlMenuItem>
      </>
    ) : null;

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
      <PlMenuItem onClick={() => onViewSchema(menuCollection)}>
        {t('sidebar.view-schema')}
      </PlMenuItem>
      {fieldMenu}
      <PlMenuSeparator />
      <PlMenuItem onClick={() => onEditSchema({ kind: 'add-field', collection: menuCollection })}>
        {t('schema-edit.add-field')}
      </PlMenuItem>
      <PlMenuItem
        onClick={() => onEditSchema({ kind: 'rename-collection', collection: menuCollection })}
      >
        {t('schema-edit.rename-collection')}
      </PlMenuItem>
      <PlMenuItem
        color="danger"
        onClick={() => onEditSchema({ kind: 'delete-collection', collection: menuCollection })}
      >
        {t('schema-edit.delete-collection')}
      </PlMenuItem>
    </>
  ) : (
    <>
      <PlMenuItem onClick={() => void dispatch(loadCounts())}>{t('sidebar.refresh')}</PlMenuItem>
      <PlMenuItem onClick={() => onViewSchema(null)}>{t('sidebar.view-schema')}</PlMenuItem>
      <PlMenuSeparator />
      <PlMenuItem onClick={() => onEditSchema({ kind: 'add-collection' })}>
        {t('schema-edit.new-collection')}
      </PlMenuItem>
    </>
  );

  return (
    <aside className="sidebar" aria-label={t('sidebar.title')} data-testid="sidebar">
      <div className="sidebar__head">
        <span className="sidebar__title">{t('sidebar.title')}</span>
        <span className="sidebar__version">
          {t('sidebar.schema-version', { version: schema.version })}
        </span>
        <PlIconButton
          data-testid="btn-new-collection"
          size="xs"
          variant="ghost"
          label={t('schema-edit.new-collection')}
          icon={<Plus />}
          onClick={() => onEditSchema({ kind: 'add-collection' })}
        />
        <PlIconButton
          data-testid="btn-view-schema"
          size="xs"
          variant="ghost"
          label={t('sidebar.view-schema')}
          icon={<FileCode />}
          onClick={() => onViewSchema(null)}
        />
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
              setMenuField(element?.dataset.field ?? null);
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

// It reads what it shows from the store, and its parent draws again for the tab in front
export default memo(SchemaTree);
