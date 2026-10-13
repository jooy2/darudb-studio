import { useTranslation } from 'react-i18next';
import { PlButton, PlModal } from 'plass-ui';
import type { RefusedImport } from '@/renderer/components/project/useTransfer';

/* The records of a file an import refused, and why, so they can be fixed */
export default function ImportProblemsDialog({
  refused,
  onClose,
}: {
  refused: RefusedImport;
  onClose: () => void;
}) {
  const [t] = useTranslation();

  return (
    <PlModal
      data-testid="import-problems"
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={t('import-dialog.title')}
      description={t('import-dialog.text', { path: refused.path })}
      width={600}
      actions={<PlButton onClick={onClose}>{t('common.close')}</PlButton>}
    >
      <ul className="import-problems">
        {refused.problems.map((problem) => (
          <li key={`${problem.record}-${problem.message}`}>
            <span className="import-problems__record">
              {t('import-dialog.record', { number: problem.record })}
            </span>
            {problem.message}
          </li>
        ))}
      </ul>
    </PlModal>
  );
}
