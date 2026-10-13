import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlButton, PlModal } from 'plass-ui';
import { setNoticesOpen } from '@/renderer/store/slices/appScreenSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { mainChannels } from '@/common/ipc';

/*
 * The licenses of the open source packages the app is built with, as the
 * build wrote them, opened from the Help menu. They are read when the dialog
 * opens rather than kept, since they run to tens of kilobytes.
 * */
export default function NoticesDialog() {
  const open = useAppSelector((state) => state.appScreen.noticesOpen);
  const dispatch = useAppDispatch();
  const [t] = useTranslation();
  // `undefined` while they are read, `null` for a build that has none
  const [notices, setNotices] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let current = true;

    void window.mainApi.invoke(mainChannels.requestNotices).then((text) => {
      if (current) {
        setNotices(text);
      }
    });

    return () => {
      current = false;
    };
  }, [open]);

  return (
    <PlModal
      data-testid="notices-dialog"
      open={open}
      onOpenChange={(next) => dispatch(setNoticesOpen(next))}
      title={t('notices.title')}
      description={t('notices.text')}
      width={760}
      actions={
        <PlButton onClick={() => dispatch(setNoticesOpen(false))}>{t('common.close')}</PlButton>
      }
    >
      {notices === null ? (
        <p className="notices__missing">{t('notices.missing')}</p>
      ) : (
        <pre className="notices" data-testid="notices-text">
          {notices ?? ''}
        </pre>
      )}
    </PlModal>
  );
}
