import { useTranslation } from 'react-i18next';
import { BookOpen, Code } from 'lucide-react';
import { PlTextLink, PlTypography } from 'plass-ui';
import { REPOSITORY_URL, WEBSITE_URL } from '@/common/menu';

/*
 * The top of the project list: what the app is for, and where DaruDB itself
 * is documented. The links open in the default browser, as
 * every link out of the app does.
 * */
export default function WelcomeCard() {
  const [t] = useTranslation();

  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <img className="welcome__logo" src="images/logo.png" alt="" draggable="false" />
      <div className="welcome__body">
        <PlTypography id="welcome-title" level="h2" className="welcome__title">
          {t('home.welcome-title')}
        </PlTypography>
        <PlTypography className="welcome__text">{t('home.welcome-text')}</PlTypography>
        <div className="welcome__links">
          <PlTextLink
            href={WEBSITE_URL}
            newTab
            size="sm"
            underline="hover"
            startIcon={<BookOpen />}
          >
            {t('home.website')}
          </PlTextLink>
          <PlTextLink href={REPOSITORY_URL} newTab size="sm" underline="hover" startIcon={<Code />}>
            {t('home.repository')}
          </PlTextLink>
          <span className="welcome__version" data-testid="app-version">
            {/* Replaced with the `package.json` version at build time */}
            {t('common.version', { version: __APP_VERSION__ })}
          </span>
        </div>
      </div>
    </section>
  );
}
