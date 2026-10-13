import { useTranslation } from 'react-i18next';
import {
  PlAppLogo,
  PlHeader,
  PlIconButton,
  PlSelect,
  PlTypography,
  type PlSelectValue,
} from 'plass-ui';
import { setDarkTheme } from '@/renderer/store/slices/appScreenSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import ThemeIcon from '@/renderer/components/ThemeIcon';
import { APP_NAME } from '@/renderer/constants';
import { fallbackLanguage, languageNames, supportedLanguages } from '@/common/locales';

// The list never changes while the app runs, so it is built once instead of on
// every render of the select below.
const languageItems = supportedLanguages.map((language) => ({
  value: language,
  label: languageNames[language],
}));

/*
 * The window the app opens with. For now it carries the bar every screen will
 * share and the app's name, and the database screens are built into it later.
 * */
export default function MainScreen() {
  const darkTheme = useAppSelector((state) => state.appScreen.darkTheme);
  const [t, i18n] = useTranslation(['common']);
  const dispatch = useAppDispatch();

  const handleChangeTheme = (): void => {
    dispatch(setDarkTheme(!darkTheme));
  };

  const handleChangeLanguage = async (language: PlSelectValue | null): Promise<void> => {
    // The select speaks in `string | number | null`, so what it reports is
    // checked before it reaches i18next rather than after
    if (typeof language !== 'string') {
      return;
    }

    // `useLanguageSync` reports the change to the main process, which stores it
    await i18n.changeLanguage(language);
  };

  return (
    <div className="app">
      <PlHeader
        brand={
          <PlAppLogo data-testid="main-logo" size="sm" src="images/logo.png" name={APP_NAME} />
        }
        actions={
          <>
            <PlIconButton
              data-testid="btn-change-theme"
              size="sm"
              variant="ghost"
              label={t('common.switch-theme')}
              icon={<ThemeIcon darkTheme={darkTheme} />}
              onClick={handleChangeTheme}
            />
            {/*
              The test hook goes on the element around the select, which draws
              its own trigger.
            */}
            <div className="app__language" data-testid="select-language">
              <PlSelect
                fullWidth
                size="sm"
                label={t('common.language')}
                labelPlacement="float"
                items={languageItems}
                value={i18n.resolvedLanguage ?? fallbackLanguage}
                onValueChange={(language) => void handleChangeLanguage(language)}
              />
            </div>
          </>
        }
      />

      <main className="app__main">
        <img className="app__main-logo" alt="" src="images/logo.png" draggable="false" />
        <PlTypography level="h1">{APP_NAME}</PlTypography>
        <PlTypography className="app__muted" data-testid="app-version">
          {/* Replaced with the `package.json` version at build time */}
          {t('common.version', { version: __APP_VERSION__ })}
        </PlTypography>
      </main>
    </div>
  );
}
