import { isPlainObject, parseScalar, scalarText, ValueError } from '@/common/values';
import type { FieldType, SchemaCollection, Value } from '@/common/data';

/*
 * A list or an embedded object as the object dialog's form edits it: a tree
 * that follows the field's type, with the text of each value as the user
 * typed it, so a value half typed stays as it is until the dialog is saved.
 *
 * `toDraft` makes the tree from a value, and `fromDraft` reads it back as one,
 * checked part by part, with the path to the part that is wrong.
 * */

export type Draft = { isNull: boolean } & (
  | { kind: 'scalar'; text: string }
  | { kind: 'list'; items: Draft[] }
  | { kind: 'object'; fields: Record<string, Draft> }
);

// The most items a list's form shows, past which the list is edited as JSON
export const MAX_FORM_ITEMS = 200;

/* A new value of `type`: what a new item of a list, or an empty field, starts as */
export const emptyDraft = (type: FieldType): Draft => {
  switch (type.kind) {
    case 'list':
      return { kind: 'list', items: [], isNull: false };
    case 'object':
      return {
        kind: 'object',
        fields: Object.fromEntries(
          type.fields.map((field) => [field.name, emptyDraft(field.type)]),
        ),
        isNull: false,
      };
    case 'bool':
      return { kind: 'scalar', text: 'false', isNull: false };
    default:
      return { kind: 'scalar', text: '', isNull: false };
  }
};

/* `value`, of `type`, as a tree to edit */
export const toDraft = (value: Value, type: FieldType): Draft => {
  if (value === null) {
    return { ...emptyDraft(type), isNull: true };
  }

  if (type.kind === 'list') {
    return {
      kind: 'list',
      items: (Array.isArray(value) ? value : []).map((item) => toDraft(item, type.element)),
      isNull: false,
    };
  }

  if (type.kind === 'object') {
    const given = isPlainObject(value) ? value : {};

    return {
      kind: 'object',
      fields: Object.fromEntries(
        type.fields.map((field) => [
          field.name,
          toDraft(given[field.name] ?? field.default ?? null, field.type),
        ]),
      ),
      isNull: false,
    };
  }

  return { kind: 'scalar', text: scalarText(value), isNull: false };
};

/* Whether the form can hold `draft` and every list in it */
export const fitsForm = (draft: Draft): boolean => {
  if (draft.kind === 'list') {
    return draft.items.length <= MAX_FORM_ITEMS && draft.items.every(fitsForm);
  }

  if (draft.kind === 'object') {
    return Object.values(draft.fields).every(fitsForm);
  }

  return true;
};

/*
 * `draft` read back as a value of `type`, or a `ValueError` naming the part
 * at `path` that does not fit it.
 * */
export const fromDraft = (
  draft: Draft,
  type: FieldType,
  optional: boolean,
  collections: readonly SchemaCollection[],
  path: string,
): Value => {
  if (draft.isNull) {
    if (!optional) {
      throw new ValueError(path, 'a value is required');
    }

    return null;
  }

  if (type.kind === 'list' && draft.kind === 'list') {
    return draft.items.map((item, index) =>
      fromDraft(item, type.element, false, collections, `${path}[${index}]`),
    );
  }

  if (type.kind === 'object' && draft.kind === 'object') {
    return Object.fromEntries(
      type.fields.map((field) => [
        field.name,
        fromDraft(
          draft.fields[field.name] ?? emptyDraft(field.type),
          field.type,
          field.optional,
          collections,
          `${path}.${field.name}`,
        ),
      ]),
    );
  }

  if (draft.kind !== 'scalar') {
    throw new ValueError(path, 'the value does not have the type of the field');
  }

  // A value inside a list or an object is never left empty for null: null is its own switch
  const parsed = parseScalar(draft.text, type, false, collections, path);

  if (!parsed.ok) {
    throw parsed.error;
  }

  return parsed.value;
};
