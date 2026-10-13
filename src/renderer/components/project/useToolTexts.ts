import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolTexts } from '@/renderer/store/slices/projectSlice';

/* What the tools say and ask with, in the window's language */
export default function useToolTexts(): ToolTexts {
  const [t] = useTranslation();

  return useMemo(
    () => ({
      backupTitle: t('tools.backup-title'),
      rescueTitle: t('tools.rescue-title'),
      backupDone: (path: string) => t('tools.backup-done', { path }),
      rescueDone: (path: string) => t('tools.rescue-done', { path }),
      passwordDone: t('tools.password-done'),
    }),
    [t],
  );
}
