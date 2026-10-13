# Contributing to DaruDB Studio

Thank you for contributing. Bug reports, fixes, tests, translations and documentation changes are all welcome.

This project adheres to the [Contributor Covenant code of conduct](CODE_OF_CONDUCT.md). Contributing means you have read and agree to it. The maintainers will warn or restrict any behaviour that breaks it.

## Issues

Issues can be created on the following page: https://github.com/jooy2/darudb-studio/issues

When creating an issue, keep the following in mind:

- Pick the template that matches the issue: a bug report or a feature request.
- Check to see if there are duplicate issues.
- Describe in detail what is happening and what needs to be fixed. A screenshot or the database file that shows the problem helps, but remove anything private from a file before you attach it.
- Use a title that makes the issue easy for others to find and understand.
- Please use English in all content.

A problem in the database engine itself, rather than in this app, belongs to [DaruDB](https://github.com/jooy2/darudb/issues).

**Do not open an issue for a security problem.** [SECURITY.md](SECURITY.md) has the private route, which keeps a vulnerability out of public view until there is a version to upgrade to.

## Running the checks

The app needs Node.js 22.12 or later. Install the dependencies once with `npm install`, then:

| Command          | What it checks                                                  |
| ---------------- | --------------------------------------------------------------- |
| `npm run lint`   | ESLint, including which process may import what                 |
| `npm run format` | Prettier. `npm run format:fix` rewrites the files it flags      |
| `npm test`       | Builds the app, then runs the end-to-end tests in `tests/specs` |

The end-to-end tests start the built app with Playwright and keep every window off the screen, so a run does not take the screen or the focus from you. `DARUDB_STUDIO_HIDDEN=1` is what hides the windows and `DARUDB_STUDIO_USER_DATA` gives the run a user data folder of its own; `tests/fixtures.ts` sets both. The app reads them only when it is not packaged. On Linux without a display, `npm run test:linux` runs the same tests under Xvfb.

## Where the code goes

- **The main process**, `src/main`, owns everything that touches the file system, including every database the app opens. A renderer is sandboxed and cannot load the native addon of `darudb`.
- **The renderer**, `src/renderer`, asks the main process for what it needs through `window.mainApi`. A new call is a channel in `src/common/ipc.ts`, a handler in `src/main/IPCs.ts`, and nothing else: the preload checks every channel against that list.
- **`src/common`** is bundled into every process, so it holds constants, types and pure functions only. ESLint stops an import that one of the processes cannot run.

Anything the main process receives from a renderer is untrusted input and is checked before it is used.

## Translations

The interface ships in English, German, French, Japanese and Korean, one file per language in `src/common/messages`. Every file holds the same keys, and a key missing from one of them fails the build. Add a new string to every file in the same change. Write it in your own language if you cannot write the others, and say so in the pull request; a maintainer will follow up on the translation.

## Third-party dependencies

A new runtime dependency ships to every user of the app, so a pull request that adds one should say what it does that we would otherwise write, what its licence is, and what it brings along. MIT, ISC, BSD, Apache-2.0 and Zlib are fine. Copyleft licences (GPL, LGPL, AGPL, MPL) are not.

ESLint stays on version 9 and TypeScript on version 6, together with the packages that depend on them, such as `@eslint/js` and `typescript-eslint`. Their next major versions do not work with the rest of the toolchain yet, so do not raise them in an unrelated change.

## How to contribute (Pull Requests)

### Write the code you want to change

1. Fork the project, or rebase onto the latest commit on the main branch.
2. Install the dependencies with `npm install`.
3. Set up ESLint and Prettier in your editor. The workspace settings in `.vscode` do this for Visual Studio Code.
4. Write the code.
5. Add or change tests as the change warrants, and confirm that `npm run lint`, `npm run format` and `npm test` pass.

### Write a commit message

There are no strict rules for commit messages, but follow these where you can:

- Write in English.
- Wrap function, variable, folder and file names in backticks.
- Use the format `tag: message (fixes #1)`. The part in parentheses is optional.
- Summarize what was modified.
- Split unrelated modifications into separate commits.

The tags follow the [Udacity Git Commit Message Style Guide](https://udacity.github.io/git-styleguide). You may use a tag outside this list where none of them fits.

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Changes to documentation
- `style`: Formatting, missing semicolons, etc.; no code change
- `refactor`: Refactoring production code
- `test`: Adding tests, refactoring test; no production code change
- `chore`: Updating build tasks, package manager configs, etc.; no production code change

Informal tags:

- `package`: Modifications to package settings, modules, or GitHub projects
- `typo`: Fix typos

### Create a pull request

When creating a pull request, keep the following in mind:

- Describe what the modification is, why it is needed, and how it works.
- Add a screenshot for a change to the interface, in the light and the dark theme.
- Check to see if there are duplicate pull requests.
- Please use English in all content.

A maintainer reviews and tests the code before merging it. That can take some time, and they may ask for further edits or for clarification in the comments.
