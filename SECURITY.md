# Security Policy

## Supported versions

Only the **latest release** of DaruDB Studio receives security fixes; there are no maintained release branches behind it, so upgrading is how a fix arrives.

| Version        | Supported |
| -------------- | --------- |
| Latest release | Yes       |
| Anything older | No        |

If a release line is ever maintained on its own, this table will name it.

## Reporting a vulnerability

**Do not open a public issue for a security problem**, and do not describe one in a pull request. A vulnerability that is public before there is a version to upgrade to puts everyone who opens their data with this app at risk.

Report it privately through one of these routes:

- **GitHub Security Advisories.** [Open a draft advisory](https://github.com/jooy2/darudb-studio/security/advisories/new). This is the preferred route: it keeps the report, the fix and the eventual disclosure in one place.
- **Email.** [jooy2.contact@gmail.com](mailto:jooy2.contact@gmail.com), with `darudb-studio security` in the subject.

Please include, as far as you can:

- The version of the app and the operating system it was reproduced on.
- What an attacker can do with it: run code, read or change files outside the database that was opened, or read data the app should not show. Say that rather than only what the input looks like.
- The smallest database file or the steps that reproduce it. If the file itself is the attack, attach it to the advisory rather than describing it.
- Whether it is already public anywhere.

### What happens next

- **Within 3 days** you should have an acknowledgement that the report arrived.
- **Within 14 days** you should have an assessment: whether it is accepted, what the impact is judged to be, and a rough timetable.
- A fix is released as soon as it is ready, and the advisory is published with it. If you would like to be credited, say so in the report and name what you would like to be credited as.

If you do not hear back inside those windows, please follow up rather than assume the report arrived.

## Scope

DaruDB Studio opens database files that may come from anywhere, so the things most worth reporting are the ones that let such a file, or what it holds, reach further than the app's window:

- **Untrusted files.** A crafted database file that makes the app run code, read or write files other than the one that was opened, or hang or crash in a way that loses unsaved work.
- **Untrusted content.** A value stored in a database that, when the app shows it, runs as script, loads something from the network, or navigates the window away from the app.
- **The renderer boundary.** A way for the interface to reach Node.js, Electron or the file system other than through the IPC calls the app defines, or to make the main process act on input it should have refused.
- **Supply chain.** A vulnerability in something the released app actually ships, reachable through the way we use it.

Out of scope:

- A problem in the DaruDB engine itself, such as reading an encrypted file without its key or a file the engine fails to check. Report it to [DaruDB](https://github.com/jooy2/darudb/security/advisories/new) instead, since every application that uses the engine is affected.
- An attacker who can already run code on the machine or write to the app's own files.
- Reports about a **development dependency** that never reaches the released app, unless you can show a path from it into a released build.
- Findings from an automated scanner with no demonstrated impact.

## Disclosure

We ask for coordinated disclosure: give us a chance to release a fix before the details are public. In return, we answer within the timetable above, and if a fix will take longer than that, we will say so and why.
