import type { Page } from 'playwright';
import type { MainChannel } from '../src/common/ipc';

/*
 * Tests run in Node.js, where there is no preload bridge. The page has one,
 * and this is how a test calls the main process through it.
 * */
export const invokeMain = <Result = unknown>(
  target: Page,
  channel: MainChannel,
  ...args: unknown[]
): Promise<Result> =>
  target.evaluate(
    ({ evaluatedChannel, evaluatedArgs }) => {
      const { mainApi } = window as unknown as {
        mainApi: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> };
      };

      return mainApi.invoke(evaluatedChannel, ...evaluatedArgs);
    },
    { evaluatedChannel: channel, evaluatedArgs: args },
  ) as Promise<Result>;

/*
 * The same, for a channel the main process listens on without answering. The
 * promise settles once the message is sent, not once it is handled.
 * */
export const sendMain = (target: Page, channel: MainChannel, ...args: unknown[]): Promise<void> =>
  target.evaluate(
    ({ evaluatedChannel, evaluatedArgs }) => {
      const { mainApi } = window as unknown as {
        mainApi: { send: (channel: string, ...args: unknown[]) => void };
      };

      mainApi.send(evaluatedChannel, ...evaluatedArgs);
    },
    { evaluatedChannel: channel, evaluatedArgs: args },
  );
