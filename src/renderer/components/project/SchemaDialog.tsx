import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { PlButton, PlCodeBlock, PlModal, PlSegment, PlSegmentedButton } from 'plass-ui';
import { statusChanged } from '@/renderer/store/slices/projectSlice';
import { useAppDispatch } from '@/renderer/store/hooks';
import { mainChannels } from '@/common/ipc';
import { schemaToJson, schemaToTypeScript, type SchemaFormat } from '@/common/schema';
import type { DatabaseSchema } from '@/common/data';

interface SchemaDialogProps {
  schema: DatabaseSchema;
  /* The one collection to show, or `null` for the whole schema */
  only: string | null;
  onClose: () => void;
}

/*
 * The schema the file holds, written out whole or for one collection: as the
 * TypeScript a program declares it with, using the `darudb` package, or as
 * the plain data the app reads. Its block has a button that copies it, and
 * the dialog one that saves it to a file.
 *
 * Nothing here changes the file. A program that declares this schema opens
 * the file as it is.
 * */
export default function SchemaDialog({ schema, only, onClose }: SchemaDialogProps) {
  const [t] = useTranslation();
  const dispatch = useAppDispatch();
  const [format, setFormat] = useState<SchemaFormat>('ts');
  const [saving, setSaving] = useState(false);
  const text =
    format === 'ts'
      ? schemaToTypeScript(schema, only ?? undefined)
      : schemaToJson(schema, only ?? undefined);

  const save = async (): Promise<void> => {
    setSaving(true);

    try {
      const result = await window.mainApi.invoke(
        mainChannels.exportSchema,
        format,
        only,
        t('schema.save-title'),
      );

      if (result.status === 'ok') {
        dispatch(
          statusChanged({
            text: t('schema.saved', { path: result.report.path }),
            tone: 'success',
          }),
        );
        onClose();
      } else if (result.status === 'error') {
        dispatch(
          statusChanged({
            text: t('schema.failed', { message: result.message }),
            tone: 'danger',
          }),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <PlModal
      data-testid="schema-dialog"
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={only === null ? t('schema.title') : t('schema.title-collection', { collection: only })}
      description={format === 'ts' ? t('schema.text-ts') : t('schema.text-json')}
      width={720}
      actions={
        <div className="dialog-actions">
          <PlButton
            data-testid="btn-save-schema"
            className="dialog-actions__start"
            size="sm"
            variant="ghost"
            startIcon={<Download />}
            loading={saving}
            onClick={() => void save()}
          >
            {t('schema.save')}
          </PlButton>
          <PlButton onClick={onClose}>{t('common.close')}</PlButton>
        </div>
      }
    >
      <div className="schema-dialog">
        <PlSegmentedButton
          size="xs"
          aria-label={t('schema.format')}
          value={format}
          onValueChange={(next) => {
            if (next === 'ts' || next === 'json') {
              setFormat(next);
            }
          }}
        >
          <PlSegment value="ts">TypeScript</PlSegment>
          <PlSegment value="json">JSON</PlSegment>
        </PlSegmentedButton>
        <PlCodeBlock
          data-testid="schema-text"
          className="schema-dialog__code"
          code={text}
          language={format}
          theme="auto"
          size="sm"
          lineNumbers
          maxHeight="50vh"
          copyLabel={t('common.copy')}
          copiedLabel={t('common.copied')}
          copyFailedLabel={t('common.copy-failed')}
        />
      </div>
    </PlModal>
  );
}
