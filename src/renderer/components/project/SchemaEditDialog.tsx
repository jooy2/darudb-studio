import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PlAlert,
  PlButton,
  PlCheckbox,
  PlModal,
  PlSegment,
  PlSegmentedButton,
  PlSelect,
  PlTextField,
} from 'plass-ui';
import { changeSchema, type SchemaChangeTexts } from '@/renderer/store/slices/projectSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { isScalarType, parseScalar } from '@/common/values';
import {
  keyKinds,
  nameProblem,
  type KeyKind,
  type NewField,
  type SchemaChange,
} from '@/common/schema';
import type { DatabaseSchema, FieldType } from '@/common/data';

/* Which change the dialog asks about, and what it is made to */
export type SchemaEditRequest =
  | { kind: 'add-collection' }
  | { kind: 'rename-collection'; collection: string }
  | { kind: 'delete-collection'; collection: string }
  | { kind: 'add-field'; collection: string }
  | { kind: 'rename-field'; collection: string; field: string }
  | { kind: 'delete-field'; collection: string; field: string };

// The types a new field, or the items of a new list, can be
const SCALAR_KINDS = ['string', 'int', 'float', 'bool', 'bytes', 'date', 'link'] as const;
const FIELD_KINDS = [...SCALAR_KINDS, 'list'] as const;

type ScalarKind = (typeof SCALAR_KINDS)[number];
type FieldKind = (typeof FIELD_KINDS)[number];

// The auto-increment key's name, which a collection without a key of its own has
const AUTO_KEY = 'id';

interface SchemaEditDialogProps {
  schema: DatabaseSchema;
  request: SchemaEditRequest;
  onClose: () => void;
  /* The file did not open again after the change, and the window lost its project */
  onLost: () => void;
}

/*
 * Asks for one change of the schema: a collection to add, rename or delete,
 * or a field of one. Every change raises the file's schema version, which a
 * program that declares the version before cannot open the file with, so
 * the dialog says that each time and offers to back the file up first.
 *
 * A change waits while edits are held: they were made against the schema as
 * it is, and the submit or the discard comes first.
 * */
export default function SchemaEditDialog({
  schema,
  request,
  onClose,
  onLost,
}: SchemaEditDialogProps) {
  const [t] = useTranslation();
  const dispatch = useAppDispatch();
  const formId = useId();
  const pending = useAppSelector((state) => state.project.pending.length);
  const counts = useAppSelector((state) => state.project.counts);
  const collection =
    'collection' in request
      ? schema.collections.find((each) => each.name === request.collection)
      : undefined;
  const count = collection ? (counts[collection.name] ?? 0) : 0;
  const current = 'field' in request ? request.field : (collection?.name ?? '');

  const [name, setName] = useState(request.kind.startsWith('rename') ? current : '');
  const [keyOwn, setKeyOwn] = useState(false);
  const [keyField, setKeyField] = useState('');
  const [keyType, setKeyType] = useState<KeyKind>('string');
  const [kind, setKind] = useState<FieldKind>('string');
  const [element, setElement] = useState<ScalarKind>('string');
  const [target, setTarget] = useState(schema.collections[0]?.name ?? '');
  const [optional, setOptional] = useState(true);
  const [fallback, setFallback] = useState('');
  const [index, setIndex] = useState<NewField['index']>('none');
  const [backUp, setBackUp] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // What the user changed is checked again on the next try, and what the engine said goes
  const cleared = (key: string): void => {
    setErrors(({ [key]: _gone, ...rest }) => rest);
    setFailure(null);
  };

  const deleting = request.kind === 'delete-collection' || request.kind === 'delete-field';
  const names =
    request.kind === 'add-collection' || request.kind === 'rename-collection'
      ? schema.collections.map((each) => each.name)
      : [
          ...(collection?.fields.map((field) => field.name) ?? []),
          ...(collection?.autoIncrement ? [AUTO_KEY] : []),
        ];
  const takenByOthers = names.filter((each) => each !== current);
  const typeOf = (scalar: ScalarKind): FieldType =>
    scalar === 'link' ? { kind: 'link', collection: target } : { kind: scalar };
  const fieldType: FieldType =
    kind === 'list' ? { kind: 'list', element: typeOf(element) } : typeOf(kind);
  const links = kind === 'link' || (kind === 'list' && element === 'link');

  const titles: Record<SchemaEditRequest['kind'], string> = {
    'add-collection': t('schema-edit.title-add-collection'),
    'rename-collection': t('schema-edit.title-rename-collection', { collection: current }),
    'delete-collection': t('schema-edit.title-delete-collection', { collection: current }),
    'add-field': t('schema-edit.title-add-field', { collection: collection?.name ?? '' }),
    'rename-field': t('schema-edit.title-rename-field', { field: current }),
    'delete-field': t('schema-edit.title-delete-field', { field: current }),
  };

  /* The change the form asks for, or the problems that stop it, by field of the form */
  const read = (): SchemaChange | Record<string, string> => {
    const found: Record<string, string> = {};
    const named = (value: string, taken: readonly string[], at: string): string => {
      const problem = nameProblem(value, taken);

      if (problem) {
        found[at] = problem;
      }

      return value;
    };

    switch (request.kind) {
      case 'add-collection': {
        const collectionName = named(name, names, 'name');
        const key = keyOwn ? { field: named(keyField, [], 'key'), type: keyType } : null;

        return Object.keys(found).length > 0
          ? found
          : { kind: 'add-collection', name: collectionName, key };
      }
      case 'rename-collection':
      case 'rename-field': {
        const renamed = named(name, takenByOthers, 'name');

        if (renamed === current) {
          found.name = t('schema-edit.same-name');
        }

        if (Object.keys(found).length > 0) {
          return found;
        }

        return request.kind === 'rename-collection'
          ? { kind: 'rename-collection', collection: request.collection, name: renamed }
          : {
              kind: 'rename-field',
              collection: request.collection,
              field: request.field,
              name: renamed,
            };
      }
      case 'add-field': {
        const fieldName = named(name, names, 'name');
        let value: NewField['default'];

        if (kind === 'list') {
          // A list that may not be null starts empty
          value = optional ? undefined : [];
        } else if (fallback.trim() !== '') {
          const parsed = parseScalar(fallback, fieldType, false, schema.collections);

          if (parsed.ok) {
            value = parsed.value;
          } else {
            found.default = parsed.error.message;
          }
        } else if (!optional && count > 0) {
          found.default = t('schema-edit.needs-default', { count });
        }

        if (Object.keys(found).length > 0) {
          return found;
        }

        return {
          kind: 'add-field',
          collection: request.collection,
          field: {
            name: fieldName,
            type: fieldType,
            optional,
            ...(value === undefined ? {} : { default: value }),
            index: kind === 'list' ? 'none' : index,
          },
        };
      }
      default:
        return request;
    }
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    const change = read();

    if (!('kind' in change)) {
      setErrors(change as Record<string, string>);

      return;
    }

    setErrors({});
    setFailure(null);
    setSaving(true);

    const texts: SchemaChangeTexts = {
      backupTitle: t('tools.backup-title'),
      done: (version) => t('schema-edit.done', { version }),
      failed: (message) => t('schema-edit.failed', { message }),
    };

    try {
      const refused = await dispatch(changeSchema(change as SchemaChange, backUp, texts));

      if (refused === null) {
        onClose();
      } else if (refused.lost) {
        onLost();
      } else if (refused.message) {
        setFailure(t('schema-edit.failed', { message: refused.message }));
      }
    } finally {
      setSaving(false);
    }
  };

  const nameField = (label: string) => (
    <PlTextField
      data-testid="schema-edit-name"
      fullWidth
      size="sm"
      label={label}
      value={name}
      error={errors.name}
      invalid={errors.name !== undefined}
      spellCheck={false}
      onChange={(event) => {
        setName(event.target.value);
        cleared('name');
      }}
    />
  );

  const kindItems = (kinds: readonly string[]) =>
    kinds.map((each) => ({ value: each, label: each }));
  const collectionItems = schema.collections.map((each) => ({
    value: each.name,
    label: each.name,
  }));

  const body = () => {
    switch (request.kind) {
      case 'add-collection':
        return (
          <>
            {nameField(t('schema-edit.name'))}
            <div className="schema-edit__row">
              <span className="schema-edit__label">{t('schema-edit.key')}</span>
              <PlSegmentedButton
                data-testid="schema-edit-key"
                size="sm"
                aria-label={t('schema-edit.key')}
                value={keyOwn ? 'own' : 'auto'}
                onValueChange={(value) => setKeyOwn(value === 'own')}
              >
                <PlSegment value="auto">{t('schema-edit.key-auto')}</PlSegment>
                <PlSegment value="own">{t('schema-edit.key-own')}</PlSegment>
              </PlSegmentedButton>
            </div>
            {keyOwn && (
              <div className="schema-edit__pair">
                <PlTextField
                  data-testid="schema-edit-key-field"
                  fullWidth
                  size="sm"
                  label={t('schema-edit.key-field')}
                  value={keyField}
                  error={errors.key}
                  invalid={errors.key !== undefined}
                  spellCheck={false}
                  onChange={(event) => {
                    setKeyField(event.target.value);
                    cleared('key');
                  }}
                />
                <PlSelect
                  fullWidth
                  size="sm"
                  label={t('schema-edit.type')}
                  items={kindItems(keyKinds)}
                  value={keyType}
                  onValueChange={(value) => {
                    if (keyKinds.includes(value as KeyKind)) {
                      setKeyType(value as KeyKind);
                    }
                  }}
                />
              </div>
            )}
            <p className="schema-edit__note">{t('schema-edit.fields-later')}</p>
          </>
        );
      case 'rename-collection':
      case 'rename-field':
        return nameField(t('schema-edit.new-name'));
      case 'delete-collection':
        return (
          <p className="schema-edit__note">
            {t('schema-edit.delete-collection-text', { collection: current, count })}
          </p>
        );
      case 'delete-field':
        return (
          <p className="schema-edit__note">
            {t('schema-edit.delete-field-text', {
              field: current,
              collection: collection?.name ?? '',
              count,
            })}
          </p>
        );
      default:
        return (
          <>
            {nameField(t('schema-edit.name'))}
            <div className="schema-edit__pair">
              <PlSelect
                data-testid="schema-edit-type"
                fullWidth
                size="sm"
                label={t('schema-edit.type')}
                items={kindItems(FIELD_KINDS)}
                value={kind}
                onValueChange={(value) => {
                  if (FIELD_KINDS.includes(value as FieldKind)) {
                    setKind(value as FieldKind);
                    setFallback('');
                  }
                }}
              />
              {kind === 'list' && (
                <PlSelect
                  fullWidth
                  size="sm"
                  label={t('schema-edit.element')}
                  items={kindItems(SCALAR_KINDS)}
                  value={element}
                  onValueChange={(value) => {
                    if (SCALAR_KINDS.includes(value as ScalarKind)) {
                      setElement(value as ScalarKind);
                    }
                  }}
                />
              )}
              {links && (
                <PlSelect
                  fullWidth
                  size="sm"
                  label={t('schema-edit.target')}
                  items={collectionItems}
                  value={target}
                  onValueChange={(value) => typeof value === 'string' && setTarget(value)}
                />
              )}
            </div>
            <PlCheckbox
              data-testid="schema-edit-optional"
              size="sm"
              label={t('schema-edit.optional')}
              checked={optional}
              onCheckedChange={(checked) => {
                setOptional(checked);
                cleared('default');
              }}
            />
            {isScalarType(fieldType) && (
              <>
                <PlTextField
                  data-testid="schema-edit-default"
                  fullWidth
                  size="sm"
                  label={t('schema-edit.default')}
                  value={fallback}
                  placeholder={optional ? 'null' : undefined}
                  description={errors.default ? undefined : t('schema-edit.default-hint')}
                  error={errors.default}
                  invalid={errors.default !== undefined}
                  spellCheck={false}
                  onChange={(event) => {
                    setFallback(event.target.value);
                    cleared('default');
                  }}
                />
                <div className="schema-edit__row">
                  <span className="schema-edit__label">{t('schema-edit.index')}</span>
                  <PlSegmentedButton
                    size="sm"
                    aria-label={t('schema-edit.index')}
                    value={index}
                    onValueChange={(value) => {
                      if (value === 'none' || value === 'index' || value === 'unique') {
                        setIndex(value);
                      }
                    }}
                  >
                    <PlSegment value="none">{t('schema-edit.index-none')}</PlSegment>
                    <PlSegment value="index">{t('schema-edit.index-plain')}</PlSegment>
                    <PlSegment value="unique">{t('schema-edit.index-unique')}</PlSegment>
                  </PlSegmentedButton>
                </div>
              </>
            )}
            {kind === 'list' && <p className="schema-edit__note">{t('schema-edit.list-empty')}</p>}
          </>
        );
    }
  };

  return (
    <PlModal
      data-testid="schema-edit-dialog"
      open
      onOpenChange={(open) => {
        if (!open && !saving) {
          onClose();
        }
      }}
      title={titles[request.kind]}
      width={520}
      actions={
        <div className="dialog-actions">
          <PlButton variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </PlButton>
          <PlButton
            data-testid="btn-apply-schema"
            type="submit"
            form={formId}
            color={deleting ? 'danger' : 'primary'}
            loading={saving}
            disabled={pending > 0}
          >
            {deleting ? t('schema-edit.delete') : t('schema-edit.apply')}
          </PlButton>
        </div>
      }
    >
      <form
        id={formId}
        className="schema-edit"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        {body()}
        <PlAlert data-testid="schema-edit-warning" color="warning" variant="glass" size="sm">
          {t('schema-edit.version-warning', { from: schema.version, to: schema.version + 1 })}
        </PlAlert>
        <PlCheckbox
          data-testid="schema-edit-backup"
          size="sm"
          label={t('schema-edit.backup-first')}
          checked={backUp}
          onCheckedChange={setBackUp}
        />
        {pending > 0 && (
          <PlAlert color="info" variant="glass" size="sm">
            {t('schema-edit.pending', { count: pending })}
          </PlAlert>
        )}
        {failure && (
          <PlAlert data-testid="schema-edit-failure" color="danger" variant="glass" size="sm">
            {failure}
          </PlAlert>
        )}
      </form>
    </PlModal>
  );
}
