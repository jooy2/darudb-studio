import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { refreshProject, statusChanged } from '@/renderer/store/slices/projectSlice';
import { useAppDispatch } from '@/renderer/store/hooks';
import { mainChannels } from '@/common/ipc';
import type { ExportSource, ImportMode } from '@/common/data';
import type { ImportProblem, TransferFormat } from '@/common/transfer';

/* The records of a file an import refused, which a dialog lists */
export interface RefusedImport {
  path: string;
  problems: ImportProblem[];
}

/*
 * Exporting objects to a file and importing them from one, as the toolbar
 * and a grid's context menu ask: the request to the main process, and what
 * the status bar says after. An import that refused records of its file
 * leaves them in `refused`, for a dialog to list.
 * */
export default function useTransfer() {
  const [t] = useTranslation();
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<RefusedImport | null>(null);

  const exportObjects = async (
    collection: string,
    format: TransferFormat,
    source: ExportSource,
  ): Promise<void> => {
    setBusy(true);

    try {
      const result = await window.mainApi.invoke(
        mainChannels.exportObjects,
        { collection, format, source },
        t('toolbar.export-title'),
      );

      if (result.status === 'ok') {
        dispatch(
          statusChanged({
            text: t('status.exported', { count: result.report.count, path: result.report.path }),
            tone: 'success',
          }),
        );
      } else if (result.status === 'error') {
        dispatch(
          statusChanged({ text: t('status.refused', { message: result.message }), tone: 'danger' }),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const importObjects = async (collection: string, mode: ImportMode): Promise<void> => {
    setBusy(true);

    try {
      const result = await window.mainApi.invoke(
        mainChannels.importObjects,
        collection,
        mode,
        t('toolbar.import-title'),
      );

      if (result.status === 'ok') {
        dispatch(
          statusChanged({
            text: t('status.imported', { count: result.report.count, path: result.report.path }),
            tone: 'success',
          }),
        );
        await dispatch(refreshProject());
      } else if (result.status === 'invalid') {
        setRefused({ path: result.path, problems: result.problems });
      } else if (result.status === 'error') {
        dispatch(
          statusChanged({
            text: t('status.import-failed', { message: result.message }),
            tone: 'danger',
          }),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return { busy, refused, dismissRefused: () => setRefused(null), exportObjects, importObjects };
}
