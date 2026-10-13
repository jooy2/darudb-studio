import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { PlButton, PlCheckbox, PlIconButton, PlSegment, PlSegmentedButton } from 'plass-ui';
import { emptyDraft, type Draft } from '@/renderer/project/drafts';
import { typeName } from '@/common/values';
import type { FieldType } from '@/common/data';

interface ValueEditorProps {
  draft: Draft;
  type: FieldType;
  /* Whether the value may be null, which a switch beside it sets */
  optional: boolean;
  /* Where the value is in the object, such as `tags[2]`, which names its fields for a screen reader */
  path: string;
  onChange: (draft: Draft) => void;
}

/* One value of one piece: a box to type it in, or a switch for a bool */
function ScalarEditor({
  draft,
  type,
  path,
  onChange,
}: Omit<ValueEditorProps, 'optional'> & { draft: Extract<Draft, { kind: 'scalar' }> }) {
  if (type.kind === 'bool') {
    return (
      <PlSegmentedButton
        size="sm"
        aria-label={path}
        value={draft.text === 'true' ? 'true' : 'false'}
        onValueChange={(value) => {
          if (value !== null) {
            onChange({ ...draft, text: String(value) });
          }
        }}
      >
        <PlSegment value="false">false</PlSegment>
        <PlSegment value="true">true</PlSegment>
      </PlSegmentedButton>
    );
  }

  return (
    <input
      className="value-editor__input"
      aria-label={path}
      value={draft.text}
      placeholder={typeName(type)}
      spellCheck={false}
      onChange={(event) => onChange({ ...draft, text: event.target.value })}
    />
  );
}

/*
 * A value of any type as a form: a list as its items, each with buttons to
 * move it and to remove it, and one to add an item; an embedded object as its
 * fields; anything else as a box to type in. A value that may be null has a
 * switch for it beside its type.
 * */
export default function ValueEditor({ draft, type, optional, path, onChange }: ValueEditorProps) {
  const [t] = useTranslation();

  const nullSwitch = optional ? (
    <PlCheckbox
      className="value-editor__null"
      size="sm"
      label="null"
      aria-label={t('object-dialog.null', { path })}
      checked={draft.isNull}
      onCheckedChange={(checked) => onChange({ ...draft, isNull: checked })}
    />
  ) : null;

  if (draft.isNull) {
    return <div className="value-editor value-editor--null">{nullSwitch}</div>;
  }

  if (draft.kind === 'list' && type.kind === 'list') {
    const setItems = (items: Draft[]): void => onChange({ ...draft, items });

    return (
      <div className="value-editor value-editor--list">
        {nullSwitch}
        <ol className="value-editor__items" start={0}>
          {draft.items.map((item, index) => (
            // Items have no identity of their own but their place
            <li className="value-editor__item" key={index}>
              <span className="value-editor__index">[{index}]</span>
              <ValueEditor
                draft={item}
                type={type.element}
                optional={false}
                path={`${path}[${index}]`}
                onChange={(next) =>
                  setItems(draft.items.map((each, at) => (at === index ? next : each)))
                }
              />
              <span className="value-editor__item-actions">
                <PlIconButton
                  size="xs"
                  variant="ghost"
                  label={t('object-dialog.move-up', { path: `${path}[${index}]` })}
                  icon={<ArrowUp />}
                  disabled={index === 0}
                  onClick={() =>
                    setItems(
                      draft.items.map((each, at) =>
                        at === index - 1 ? item : at === index ? draft.items[index - 1] : each,
                      ),
                    )
                  }
                />
                <PlIconButton
                  size="xs"
                  variant="ghost"
                  label={t('object-dialog.move-down', { path: `${path}[${index}]` })}
                  icon={<ArrowDown />}
                  disabled={index === draft.items.length - 1}
                  onClick={() =>
                    setItems(
                      draft.items.map((each, at) =>
                        at === index + 1 ? item : at === index ? draft.items[index + 1] : each,
                      ),
                    )
                  }
                />
                <PlIconButton
                  size="xs"
                  variant="ghost"
                  label={t('object-dialog.remove', { path: `${path}[${index}]` })}
                  icon={<X />}
                  onClick={() => setItems(draft.items.filter((_, at) => at !== index))}
                />
              </span>
            </li>
          ))}
        </ol>
        <PlButton
          className="value-editor__add"
          size="xs"
          variant="ghost"
          startIcon={<Plus />}
          onClick={() => setItems([...draft.items, emptyDraft(type.element)])}
        >
          {t('object-dialog.add-item')}
        </PlButton>
      </div>
    );
  }

  if (draft.kind === 'object' && type.kind === 'object') {
    return (
      <div className="value-editor value-editor--object">
        {nullSwitch}
        <dl className="value-editor__fields">
          {type.fields.map((field) => (
            <div className="value-editor__field" key={field.name}>
              <dt className="value-editor__name">
                {field.name}
                <span className="value-editor__type">
                  {typeName(field.type)}
                  {field.optional ? '?' : ''}
                </span>
              </dt>
              <dd className="value-editor__value">
                <ValueEditor
                  draft={draft.fields[field.name] ?? emptyDraft(field.type)}
                  type={field.type}
                  optional={field.optional}
                  path={`${path}.${field.name}`}
                  onChange={(next) =>
                    onChange({ ...draft, fields: { ...draft.fields, [field.name]: next } })
                  }
                />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  if (draft.kind === 'scalar') {
    return (
      <div className="value-editor value-editor--scalar">
        <ScalarEditor draft={draft} type={type} path={path} onChange={onChange} />
        {nullSwitch}
      </div>
    );
  }

  return null;
}
