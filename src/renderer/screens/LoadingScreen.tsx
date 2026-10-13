import { useTranslation } from 'react-i18next';
import { PlProgressLinear, PlTypography } from 'plass-ui';
import { APP_NAME } from '@/renderer/constants';

interface LoadingScreenProps {
  /* What the app is doing, in a few words */
  status: string;
  /* How far along it is, from 0 to 1, or `null` when that cannot be told */
  progress?: number | null;
}

/*
 * What a window shows while it gets ready: as it starts, and while a project
 * opens. The status line is a live region, so a screen reader follows it.
 * */
export default function LoadingScreen({ status, progress = null }: LoadingScreenProps) {
  const [t] = useTranslation();

  return (
    <div className="loading-screen" data-testid="loading-screen">
      <img className="loading-screen__logo" src="images/logo.png" alt="" draggable="false" />
      <PlTypography className="loading-screen__name" level="h1">
        {APP_NAME}
      </PlTypography>
      <PlProgressLinear
        className="loading-screen__progress"
        size="sm"
        aria-label={t('loading.label')}
        value={progress === null ? null : Math.round(progress * 100)}
      />
      <p className="loading-screen__status" role="status">
        {status}
      </p>
    </div>
  );
}
