# dsh-failure-ledger

A DeepSeek Harness plugin that collects tool and script failures from your local session logs and groups them with fixed string rules — no model call, no generated report. The panel is a ledger: each row is one group of identical-looking failures, with counts, last-seen time and the sessions they came from.

## What it reads

Only local session logs under `~/.dsh/sessions` (or `$DSH_HOME/sessions`), through the harness `sessionQuery` service. Nothing is uploaded, and the plugin never writes to a session.

Failures are recognised from three event types:

| Event | Failure signal |
| --- | --- |
| `tool/result` | `message.isError`, or an `[exit code: N]` marker with `N > 0` |
| `job/settled` | `detail` carrying `exit code: N` with `N ≠ 0`, or `signal: X` |
| `tool/ptc-dispatch` | `isError` on a sub-tool call (PTC mode) |

Grouping is `sha1(tool + kind + signature)` over a normalized error line: paths become `<path>`, long hex ids become `<id>`, numbers become `<n>`. The same failure in two sessions lands in the same group; two different failures stay apart.

## Install

Clone the repository, then install the package directory as a bundle:

```
git clone https://github.com/raininfall/dsh-failure-ledger
plugin_manager install_bundle target=<path to that checkout>
```

That writes a `link:` dependency and an entry into the active profile's bundle list. A restart is required the first time; afterwards the client half picks up rebuilt bundles on reload.

## Panel

A "Failure ledger" entry appears in the sidebar; clicking it opens the ledger in the main area.

- Filter by tool, error text, kind, or include killed background jobs.
- Click any column header to sort by it; clicking further headers adds them as lower-priority columns, and clicking an active one reverses that column. The first click away from the default frequency order replaces it. The strip above the table lists the active columns in priority order with a "Clear sort" control. Sort order is not saved across reloads.
- Click a signature to see the occurrences behind a group, with session title and cwd.
- Mute a group to hide it from the default view; unmute from the same row.
- Select rows and merge them into one target group (same tool and kind only).
- "Rescan" rescans the sessions that changed since the last pass and reports its progress; delete the ledger file for a full rebuild. The panel also polls in the background.

Preferences (mute and merge) live in the ledger file, so they survive restarts.

## Configuration

All keys are optional; set them on the `failure-ledger` plugin entry in your profile's `cordis.yml`.

| Key | Default | Meaning |
| --- | --- | --- |
| `ledgerPath` | `~/.dsh/storages/failure-ledger/ledger.json` | Where the index is stored; must be absolute |
| `retentionDays` | `90` | Failures older than this are dropped on the next scan |
| `scanOnStartup` | `true` | Run one scan shortly after the plugin loads |
| `scanConcurrency` | `4` | Sessions read in parallel |
| `includeSubagents` | `true` | Include subagent sessions |
| `includePtcDispatch` | `true` | Count PTC sub-tool failures |
| `ignorePatterns` | `[]` | Regular expressions; matching signatures are not recorded |
| `maxSignatureChars` | `160` | Upper bound on a signature |

## Data file and removal

The index is one JSON file (`ledgerPath`), written atomically with a temporary file and rename. Each scan stores only failures newer than the retention window, so the file stays small (tens of kilobytes for hundreds of sessions).

Delete the file to reset the ledger; delete the profile's `link:` dependency and bundle entry to uninstall. A corrupt file is preserved as `ledger.json.corrupt-<timestamp>` and replaced with an empty ledger, and the panel reports that it happened.

## Development

```
npm test                        # unit tests, no network, no session data
npm run build                   # rebuild lib/client.js from src/client/*
FAILURE_LEDGER_E2E=1 node --test test/e2e-live.test.js   # scan real local sessions
```

Client code is `src/client/*.js` fragments concatenated into a single module; they must stay free of `import`/`export`, because the browser side has no bundler.
