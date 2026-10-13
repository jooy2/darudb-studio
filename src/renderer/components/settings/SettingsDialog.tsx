import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  PlButton,
  PlModal,
  PlRadio,
  PlRadioGroup,
  PlSegment,
  PlSegmentedButton,
  PlSelect,
} from 'plass-ui';
import { setSettingsOpen } from '@/renderer/store/slices/appScreenSlice';
import { changeSettings } from '@/renderer/store/slices/settingsSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { languageNames, languageOf, supportedLanguages } from '@/common/locales';
import {
  isEditMode,
  isMenuBarStyle,
  isSupportedLanguage,
  type AppSettings,
} from '@/common/settings';

// What the selects and switches below stand for when the system decides
const SYSTEM = 'system';

const themeOf = (darkTheme: boolean | null): string => {
  if (darkTheme === null) {
    return SYSTEM;
  }

  return darkTheme ? 'dark' : 'light';
};

/*
 * The settings, in a dialog any screen opens: from its header, from the menu,
 * or with the shortcut. Each change is stored as it is made, so the dialog has
 * nothing to confirm.
 * */
export default function SettingsDialog() {
  const open = useAppSelector((state) => state.appScreen.settingsOpen);
  const settings = useAppSelector((state) => state.settings);
  const dispatch = useAppDispatch();
  const [t] = useTranslation();
  const themeLabel = useId();
  const menuBarLabel = useId();

  const change = (changes: Partial<AppSettings>): void => {
    void dispatch(changeSettings(changes));
  };

  const close = (): void => {
    dispatch(setSettingsOpen(false));
  };

  // The language a window takes without a choice, named so the user knows what "System" means
  const systemLanguage = languageNames[languageOf(navigator.languages)];
  const languageItems = [
    { value: SYSTEM, label: t('settings.language-system', { language: systemLanguage }) },
    ...supportedLanguages.map((language) => ({ value: language, label: languageNames[language] })),
  ];

  return (
    <PlModal
      data-testid="settings-dialog"
      open={open}
      onOpenChange={(next) => dispatch(setSettingsOpen(next))}
      title={t('settings.title')}
      width={480}
      actions={<PlButton onClick={close}>{t('common.close')}</PlButton>}
    >
      <div className="settings">
        <section className="settings__section">
          <h3 className="settings__heading">{t('settings.appearance')}</h3>
          <div className="settings__row">
            <span className="settings__label" id={themeLabel}>
              {t('settings.theme')}
            </span>
            <PlSegmentedButton
              data-testid="settings-theme"
              size="sm"
              aria-labelledby={themeLabel}
              value={themeOf(settings.darkTheme)}
              onValueChange={(value) => {
                if (value !== null) {
                  change({ darkTheme: value === SYSTEM ? null : value === 'dark' });
                }
              }}
            >
              <PlSegment value={SYSTEM} startIcon={<Monitor />}>
                {t('settings.theme-system')}
              </PlSegment>
              <PlSegment value="light" startIcon={<Sun />}>
                {t('settings.theme-light')}
              </PlSegment>
              <PlSegment value="dark" startIcon={<Moon />}>
                {t('settings.theme-dark')}
              </PlSegment>
            </PlSegmentedButton>
          </div>
          <div className="settings__row" data-testid="settings-language">
            <PlSelect
              fullWidth
              size="sm"
              label={t('common.language')}
              items={languageItems}
              value={settings.language ?? SYSTEM}
              onValueChange={(value) => {
                if (value === SYSTEM || isSupportedLanguage(value)) {
                  change({ language: value === SYSTEM ? null : value });
                }
              }}
            />
          </div>
          <div className="settings__row">
            <span className="settings__label" id={menuBarLabel}>
              {t('settings.menu-bar')}
            </span>
            <PlSegmentedButton
              data-testid="settings-menu-bar"
              size="sm"
              aria-labelledby={menuBarLabel}
              value={settings.menuBarStyle}
              onValueChange={(value) => {
                if (isMenuBarStyle(value)) {
                  change({ menuBarStyle: value });
                }
              }}
            >
              <PlSegment value="inline">{t('settings.menu-bar-inline')}</PlSegment>
              <PlSegment value="collapsed">{t('settings.menu-bar-collapsed')}</PlSegment>
            </PlSegmentedButton>
          </div>
        </section>
        <section className="settings__section">
          <h3 className="settings__heading">{t('settings.editing')}</h3>
          <PlRadioGroup
            data-testid="settings-edit-mode"
            size="sm"
            label={t('settings.edit-mode')}
            value={settings.editMode}
            onValueChange={(value) => {
              if (isEditMode(value)) {
                change({ editMode: value });
              }
            }}
          >
            <PlRadio
              value="immediate"
              label={t('settings.edit-immediate')}
              description={t('settings.edit-immediate-text')}
            />
            <PlRadio
              value="submit"
              label={t('settings.edit-submit')}
              description={t('settings.edit-submit-text')}
            />
          </PlRadioGroup>
        </section>
      </div>
    </PlModal>
  );
}
