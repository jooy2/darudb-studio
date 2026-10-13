import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';
import { PlButton, PlModal } from 'plass-ui';
import { ScalarValue } from '@/renderer/components/grid/CellValue';
import { bytesToHex, isBytes, isPlainObject, toJson } from '@/renderer/project/values';
import type { FieldType, Value } from '@/common/data';

/* A value laid out whole: a list as numbered items, an object as a table of its fields */
function ValueView({ value, type }: { value: Value; type: FieldType | null }) {
  if (Array.isArray(value)) {
    const element = type?.kind === 'list' ? type.element : null;

    return value.length === 0 ? (
      <span className="value value--empty">[]</span>
    ) : (
      <ol className="value-list" start={0}>
        {value.map((item, index) => (
          // Items have no identity of their own but their place
          <li key={index}>
            <ValueView value={item} type={element} />
          </li>
        ))}
      </ol>
    );
  }

  if (isPlainObject(value)) {
    const fields = type?.kind === 'object' ? type.fields : [];

    return (
      <table className="value-table">
        <tbody>
          {Object.entries(value).map(([name, item]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>
                <ValueView
                  value={item}
                  type={fields.find((field) => field.name === name)?.type ?? null}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (isBytes(value)) {
    // Sixteen bytes a line, after the offset of the first
    const lines = Array.from({ length: Math.ceil(value.length / 16) }, (_, line) => {
      const chunk = value.subarray(line * 16, line * 16 + 16);

      return `${(line * 16).toString(16).padStart(8, '0')}  ${bytesToHex(chunk, true)}`;
    });

    return <pre className="value-dump">{lines.join('\n') || ' '}</pre>;
  }

  if (typeof value === 'string' && value.length > 0) {
    return <pre className="value-text">{value}</pre>;
  }

  return <ScalarValue value={value} type={type} />;
}

interface ValueDialogProps {
  title: string;
  value: Value;
  type: FieldType | null;
  onClose: () => void;
}

/* One value of an object, in a dialog with the room a long string or a nested value needs */
export default function ValueDialog({ title, value, type, onClose }: ValueDialogProps) {
  const [t] = useTranslation();

  return (
    <PlModal
      data-testid="value-dialog"
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={title}
      width={640}
      actions={
        <div className="dialog-actions">
          <PlButton
            className="dialog-actions__start"
            variant="ghost"
            startIcon={<Copy />}
            onClick={() =>
              void navigator.clipboard.writeText(
                typeof value === 'string' ? value : toJson(value, 2),
              )
            }
          >
            {t('grid.copy-value')}
          </PlButton>
          <PlButton onClick={onClose}>{t('common.close')}</PlButton>
        </div>
      }
    >
      <div className="value-view">
        <ValueView value={value} type={type} />
      </div>
    </PlModal>
  );
}
