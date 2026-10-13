import { useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import { PlAlert, PlButton, PlModal, PlSegment, PlSegmentedButton, PlTextField } from 'plass-ui';
import { columnsOf, type GridColumn } from '@/renderer/components/grid/columns';
import type { GridRow } from '@/renderer/components/grid/DataGrid';
import {
  isScalarType,
  parseJsonValue,
  parseScalar,
  sameValue,
  scalarText,
  toJson,
  typeName,
} from '@/common/values';
import type { Row, SchemaCollection, Value } from '@/common/data';

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

const textOf = (column: GridColumn, value: Value): string => {
  if (isScalarType(column.type)) {
    return scalarText(value);
  }

  return value === null ? '' : toJson(value, 2);
};

/*
 * Every field of one object, to edit together, or to fill in for a new one. A
 * field of one value is typed as it is in a cell; a list or an embedded object
 * is typed as JSON, which is checked against its type before anything is kept.
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const setText = (name: string, text: string): void => {
    setTexts((current) => ({ ...current, [name]: text }));
    setErrors(({ [name]: _cleared, ...rest }) => rest);
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

      const field = collection.fields.find((each) => each.name === column.name) ?? {
        name: column.name,
        type: column.type,
        optional: column.optional,
      };
      const parsed = isScalarType(column.type)
        ? parseScalar(texts[column.name], column.type, column.optional, collections)
        : parseJsonValue(texts[column.name], field, collections);

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
