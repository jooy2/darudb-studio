import { useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import { PlAlert, PlButton, PlModal, PlSegment, PlSegmentedButton, PlTextField } from 'plass-ui';
import { columnsOf, type GridColumn } from '@/renderer/components/grid/columns';
import type { GridRow } from '@/renderer/components/grid/DataGrid';
import ValueEditor from '@/renderer/components/grid/ValueEditor';
import { fitsForm, fromDraft, toDraft, type Draft } from '@/renderer/project/drafts';
import {
  isScalarType,
  parseJsonValue,
  parseScalar,
  sameValue,
  scalarText,
  toJson,
  typeName,
} from '@/common/values';
import type { Row, SchemaCollection, SchemaField, Value } from '@/common/data';

interface ObjectDialogProps {
  collection: SchemaCollection;
  collections: readonly SchemaCollection[];
  /* The object to edit, or none to add one */
  row?: GridRow;
  onClose: () => void;
  /*
   * Keeps the changed fields of the object, or every field of a new one.
   * Resolves with `null` once they are kept, which closes the dialog, or with
   * the engine's message when they are refused.
   * */
  onSubmit: (values: Row) => Promise<string | null>;
}

// What the switch of an optional bool stands for when it holds no value
const NULL = 'null';

/* How a list or an embedded object is edited: as a form, or as JSON text */
type NestedMode = 'form' | 'json';

const textOf = (column: GridColumn, value: Value): string => {
  if (isScalarType(column.type)) {
    return scalarText(value);
  }

  return value === null ? '' : toJson(value, 2);
};

/*
 * Every field of one object, to edit together, or to fill in for a new one. A
 * field of one value is typed as it is in a cell. A list or an embedded object
 * is edited as a form of its items or fields, or as JSON, which a switch
 * beside it turns between; either is checked against its type before anything
 * is kept. A list too long for the form is edited as JSON.
 *
 * The key names the object, so it is shown and not edited. A new object of a
 * collection with the auto-increment key gets its key when it is inserted.
 * */
export default function ObjectDialog({
  collection,
  collections,
  row = undefined,
  onClose,
  onSubmit,
}: ObjectDialogProps) {
  const [t] = useTranslation();
  const formId = useId();
  const adding = row === undefined;
  const columns = useMemo(
    () =>
      columnsOf(collection).filter(
        (column) => !(adding && column.isKey && collection.autoIncrement),
      ),
    [adding, collection],
  );
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      columns.map((column) => {
        if (row) {
          return [column.name, textOf(column, row.values[column.name] ?? null)];
        }

        const declared = collection.fields.find((field) => field.name === column.name)?.default;

        return [column.name, declared === undefined ? '' : textOf(column, declared)];
      }),
    ),
  );
  const fieldOf = (column: GridColumn): SchemaField =>
    collection.fields.find((each) => each.name === column.name) ?? {
      name: column.name,
      type: column.type,
      optional: column.optional,
    };
  const initialValue = (column: GridColumn): Value =>
    row ? (row.values[column.name] ?? null) : (fieldOf(column).default ?? null);
  // The form of each list and embedded object, and which way each is edited
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      columns
        .filter((column) => !isScalarType(column.type))
        .map((column) => [column.name, toDraft(initialValue(column), column.type)]),
    ),
  );
  const [modes, setModes] = useState<Record<string, NestedMode>>(() =>
    Object.fromEntries(
      Object.entries(drafts).map(([name, draft]) => [name, fitsForm(draft) ? 'form' : 'json']),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const setText = (name: string, text: string): void => {
    setTexts((current) => ({ ...current, [name]: text }));
    setErrors(({ [name]: _cleared, ...rest }) => rest);
  };

  /* The value a list or an embedded object field holds now, read from its form or its JSON */
  const nestedValue = (column: GridColumn) => {
    const field = fieldOf(column);

    if (modes[column.name] === 'json') {
      return parseJsonValue(texts[column.name], field, collections);
    }

    try {
      return {
        ok: true as const,
        value: fromDraft(
          drafts[column.name],
          column.type,
          column.optional,
          collections,
          column.name,
        ),
      };
    } catch (error) {
      return { ok: false as const, error: error as Error };
    }
  };

  /* Turns a field between its form and its JSON, keeping what it holds; a value that does not read stays put */
  const switchMode = (column: GridColumn, mode: NestedMode): void => {
    const parsed = nestedValue(column);

    if (!parsed.ok) {
      setErrors((current) => ({ ...current, [column.name]: parsed.error.message }));

      return;
    }

    if (mode === 'json') {
      setText(column.name, parsed.value === null ? '' : toJson(parsed.value, 2));
    } else {
      const draft = toDraft(parsed.value, column.type);

      if (!fitsForm(draft)) {
        setErrors((current) => ({ ...current, [column.name]: t('object-dialog.too-long') }));

        return;
      }

      setDrafts((current) => ({ ...current, [column.name]: draft }));
    }

    setModes((current) => ({ ...current, [column.name]: mode }));
    setErrors(({ [column.name]: _cleared, ...rest }) => rest);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    const values: Row = {};
    const found: Record<string, string> = {};

    for (const column of columns) {
      // The key of an object being edited stays as it is
      if (column.isKey && !adding) {
        continue;
      }

      const parsed = isScalarType(column.type)
        ? parseScalar(texts[column.name], column.type, column.optional, collections)
        : nestedValue(column);

      if (!parsed.ok) {
        found[column.name] = parsed.error.message;
      } else if (adding || !sameValue(row.values[column.name] ?? null, parsed.value)) {
        values[column.name] = parsed.value;
      }
    }

    setErrors(found);

    if (Object.keys(found).length > 0) {
      return;
    }

    if (!adding && Object.keys(values).length === 0) {
      onClose();

      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const refused = await onSubmit(values);

      if (refused === null) {
        onClose();
      } else {
        setSaveError(t('object-dialog.failed', { message: refused }));
      }
    } finally {
      setSaving(false);
    }
  };

  const fieldFor = (column: GridColumn) => {
    const label = (
      <span className="object-form__label">
        {column.isKey && <KeyRound aria-hidden="true" />}
        {column.name}
        <span className="object-form__type">
          {typeName(column.type)}
          {column.optional ? '?' : ''}
        </span>
      </span>
    );

    if (column.isKey && !adding) {
      return (
        <PlTextField
          key={column.name}
          data-testid={`object-field-${column.name}`}
          fullWidth
          size="sm"
          readOnly
          label={label}
          value={texts[column.name]}
          description={t('object-dialog.key-fixed')}
        />
      );
    }

    if (column.type.kind === 'bool') {
      const value = texts[column.name] === '' ? NULL : texts[column.name];

      return (
        <div className="object-form__bool" key={column.name}>
          {label}
          <PlSegmentedButton
            data-testid={`object-field-${column.name}`}
            size="sm"
            aria-label={column.name}
            value={value}
            onValueChange={(next) => {
              if (next !== null) {
                setText(column.name, next === NULL ? '' : String(next));
              }
            }}
          >
            {column.optional && <PlSegment value={NULL}>null</PlSegment>}
            <PlSegment value="false">false</PlSegment>
            <PlSegment value="true">true</PlSegment>
          </PlSegmentedButton>
          {errors[column.name] && <span className="object-form__error">{errors[column.name]}</span>}
        </div>
      );
    }

    const json = !isScalarType(column.type);

    if (json) {
      const mode = modes[column.name];

      return (
        <div
          className="object-form__nested"
          key={column.name}
          data-testid={`object-field-${column.name}`}
        >
          <div className="object-form__nested-head">
            {label}
            <PlSegmentedButton
              size="xs"
              aria-label={t('object-dialog.edit-as', { name: column.name })}
              value={mode}
              onValueChange={(next) => {
                if (next === 'form' || next === 'json') {
                  switchMode(column, next);
                }
              }}
            >
              <PlSegment value="form">{t('object-dialog.as-form')}</PlSegment>
              <PlSegment value="json">JSON</PlSegment>
            </PlSegmentedButton>
          </div>
          {mode === 'form' ? (
            <ValueEditor
              draft={drafts[column.name]}
              type={column.type}
              optional={column.optional}
              path={column.name}
              onChange={(draft) => {
                setDrafts((current) => ({ ...current, [column.name]: draft }));
                setErrors(({ [column.name]: _cleared, ...rest }) => rest);
              }}
            />
          ) : (
            <PlTextField
              className="object-form__json"
              fullWidth
              size="sm"
              multiline
              rows={4}
              aria-label={column.name}
              value={texts[column.name]}
              placeholder={column.optional ? 'null' : undefined}
              description={errors[column.name] ? undefined : t('object-dialog.json-hint')}
              spellCheck={false}
              onChange={(event) => setText(column.name, event.target.value)}
            />
          )}
          {errors[column.name] && <span className="object-form__error">{errors[column.name]}</span>}
        </div>
      );
    }

    return (
      <PlTextField
        key={column.name}
        data-testid={`object-field-${column.name}`}
        className={json ? 'object-form__json' : undefined}
        fullWidth
        size="sm"
        multiline={json}
        rows={json ? 4 : undefined}
        label={label}
        value={texts[column.name]}
        placeholder={column.optional ? 'null' : undefined}
        description={
          errors[column.name]
            ? undefined
            : json
              ? t('object-dialog.json-hint')
              : column.type.kind === 'bytes'
                ? t('object-dialog.bytes-hint')
                : undefined
        }
        error={errors[column.name]}
        invalid={errors[column.name] !== undefined}
        spellCheck={false}
        onChange={(event) => setText(column.name, event.target.value)}
      />
    );
  };

  return (
    <PlModal
      data-testid="object-dialog"
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={
        adding
          ? t('object-dialog.add-title', { collection: collection.name })
          : t('object-dialog.edit-title', { collection: collection.name })
      }
      description={adding && collection.autoIncrement ? t('object-dialog.key-assigned') : undefined}
      width={560}
      actions={
        <div className="dialog-actions">
          <PlButton variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </PlButton>
          <PlButton data-testid="btn-save-object" type="submit" form={formId} loading={saving}>
            {adding ? t('object-dialog.add') : t('object-dialog.save')}
          </PlButton>
        </div>
      }
    >
      <form
        id={formId}
        className="object-form"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        {columns.map(fieldFor)}
        {saveError && (
          <PlAlert color="danger" variant="glass" size="sm">
            {saveError}
          </PlAlert>
        )}
      </form>
    </PlModal>
  );
}
