import { safeStorage } from 'electron';
import { isHiddenRun } from './constants';

/*
 * The passwords of database files that the user asked the app to remember.
 *
 * They are encrypted with the operating system's keystore through Electron's
 * `safeStorage`: the Keychain on macOS, DPAPI on Windows, and the secret
 * service on Linux. Only the encrypted bytes reach the app's data file, and a
 * password never leaves the main process: a renderer learns whether one is
 * remembered, not what it is. Where no keystore is there, as on a Linux
 * desktop without one, the app remembers no password rather than keeping one
 * in the clear.
 *
 * A hidden test run cannot reach the Keychain without a system prompt taking
 * the screen, so it seals passwords with a reversible test encoding instead.
 * `isHiddenRun` holds only in an unpackaged build started for the tests.
 * */

const TEST_PREFIX = 'darudb-studio-test-secret:';

/* Whether a password can be remembered here */
export const canRememberSecrets = (): boolean => isHiddenRun || safeStorage.isEncryptionAvailable();

/* `secret` encrypted for the app's data file, or `null` when nothing can be remembered */
export const sealSecret = (secret: string): Uint8Array | null => {
  if (isHiddenRun) {
    return new TextEncoder().encode(`${TEST_PREFIX}${secret}`);
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }

  return safeStorage.encryptString(secret);
};

/*
 * The password `sealed` holds, or `null` when it cannot be decrypted, as when
 * the keystore changed since it was sealed. The caller asks the user then.
 * */
export const openSecret = (sealed: Uint8Array): string | null => {
  if (isHiddenRun) {
    const text = new TextDecoder().decode(sealed);

    return text.startsWith(TEST_PREFIX) ? text.slice(TEST_PREFIX.length) : null;
  }

  try {
    return safeStorage.decryptString(Buffer.from(sealed));
  } catch (error) {
    console.warn('Failed to decrypt a remembered password:', error);

    return null;
  }
};
