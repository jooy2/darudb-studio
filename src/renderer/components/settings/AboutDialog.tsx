import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, GitBranch, Globe, ScrollText } from 'lucide-react';
import { PlButton, PlModal } from 'plass-ui';
import { setAboutOpen, setNoticesOpen } from '@/renderer/store/slices/appScreenSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { APP_NAME, COPYRIGHT_HOLDER } from '@/renderer/constants';
import { mainChannels, type AboutInfo } from '@/common/ipc';
import { REPOSITORY_URL, WEBSITE_URL } from '@/common/menu';

// The systems by the names their users know them by, not Node.js's
const SYSTEM_NAMES: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

// How long the copy button says it copied
const COPIED_MS = 2000;

/*
 * What the app is: its name and version, what it is built on, where it lives
 * on the web, and the licenses of the packages it ships, for a build that
 * wrote them. Opened from the About entry of the menu, in place of the system's
 * own panel, which says nothing but the version.
 * */
export default function AboutDialog() {
  const open = useAppSelector((state) => state.appScreen.aboutOpen);
  const dispatch = useAppDispatch();
  const [t] = useTranslation();
  const nameId = useId();
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || about) {
      return undefined;
    }

    let current = true;

    void window.mainApi.invoke(mainChannels.requestAbout).then((info) => {
      if (current) {
        setAbout(info);
      }
    });

    return () => {
      current = false;
    };
  }, [open, about]);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);

    return () => window.clearTimeout(timer);
  }, [copied]);

  const close = (): void => {
    dispatch(setAboutOpen(false));
  };

  const details: [string, string][] = about
    ? [
        [t('about.engine'), `DaruDB ${about.engine}`],
        [t('about.format'), `v${about.formatVersion}`],
        ['Electron', about.electron],
        ['Chromium', about.chromium],
        ['Node.js', about.node],
        [t('about.system'), `${SYSTEM_NAMES[about.platform] ?? about.platform} ${about.arch}`],
      ]
    : [];

  // What a bug report wants, in the words of no particular language
  const copyDetails = async (): Promise<void> => {
    if (!about) {
      return;
    }

    await navigator.clipboard.writeText(
      [
        `${APP_NAME} ${__APP_VERSION__}`,
        `DaruDB ${about.engine} (format v${about.formatVersion})`,
        `Electron ${about.electron}`,
        `Chromium ${about.chromium}`,
        `Node.js ${about.node}`,
        `${SYSTEM_NAMES[about.platform] ?? about.platform} ${about.arch}`,
      ].join('\n'),
    );
    setCopied(true);
  };

  const openLink = (url: string): void => {
    window.mainApi.send(mainChannels.openExternalLink, url);
  };

  return (
    <PlModal
      data-testid="about-dialog"
      open={open}
      onOpenChange={(next) => dispatch(setAboutOpen(next))}
      aria-labelledby={nameId}
      width={480}
      actions={
        <div className="dialog-actions">
          <span className="dialog-actions__start about__actions">
            <PlButton
              data-testid="btn-copy-about"
              size="sm"
              variant="ghost"
              startIcon={copied ? <Check /> : <Copy />}
              disabled={!about}
              onClick={() => void copyDetails()}
            >
              {copied ? t('common.copied') : t('about.copy')}
            </PlButton>
            {about?.hasNotices && (
              <PlButton
                data-testid="btn-notices"
                size="sm"
                variant="ghost"
                startIcon={<ScrollText />}
                onClick={() => dispatch(setNoticesOpen(true))}
              >
                {t('notices.title')}
              </PlButton>
            )}
          </span>
          <PlButton onClick={close}>{t('common.close')}</PlButton>
        </div>
      }
    >
      <div className="about">
        <img className="about__logo" src="images/logo.png" alt="" width={56} height={56} />
        <h2 className="about__name" id={nameId}>
          {APP_NAME}
        </h2>
        <p className="about__version" data-testid="about-version">
          {/* Replaced with the `package.json` version at build time */}
          {t('common.version', { version: __APP_VERSION__ })}
        </p>
        <p className="about__text">{t('about.text')}</p>
        <dl className="about__details" data-testid="about-details">
          {details.map(([name, value]) => (
            <div className="about__detail" key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="about__links">
          <PlButton
            size="sm"
            variant="ghost"
            startIcon={<Globe />}
            onClick={() => openLink(WEBSITE_URL)}
          >
            {t('menu.website')}
          </PlButton>
          <PlButton
            size="sm"
            variant="ghost"
            startIcon={<GitBranch />}
            onClick={() => openLink(REPOSITORY_URL)}
          >
            {t('menu.repository')}
          </PlButton>
        </div>
        <p className="about__copyright">
          © {new Date().getFullYear()} {COPYRIGHT_HOLDER}
        </p>
      </div>
    </PlModal>
  );
}
