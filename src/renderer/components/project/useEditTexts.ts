import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditTexts } from '@/renderer/store/slices/projectSlice';

/* What the status bar says after each kind of edit, in the window's language */
export default function useEditTexts() {
  const [t] = useTranslation();

  return useMemo(() => {
    const failed = (message: string): string => t('status.refused', { message });
    const texts = (saved: string): EditTexts => ({ saved, staged: t('status.staged'), failed });

    return {
      failed,
      edit: texts(t('status.saved')),
      insert: texts(t('status.added')),
      remove: (count: number) => texts(t('status.deleted', { count })),
      submit: (count: number) => t('status.submitted', { count }),
    };
  }, [t]);
}
