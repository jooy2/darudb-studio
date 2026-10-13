import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlButton, PlTypography } from 'plass-ui';

export default function NotFoundScreen() {
  const [t] = useTranslation(['common']);

  return (
    <div className="app-notice">
      <PlTypography level="h1">{t('not-found.title')}</PlTypography>
      <PlButton variant="ghost" render={<Link to="/" />}>
        {t('not-found.home')}
      </PlButton>
    </div>
  );
}
