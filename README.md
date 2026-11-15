<div align="center">

<img src="docs/readme/hero.png" alt="知行 (dsh-zhixing): a local-first workday workspace for DeepSeek Harness" width="100%">

# 知行 · dsh-zhixing

**A local-first workday workspace for DeepSeek Harness.**<br>
Turn what you did in Harness into a daily report, carry tomorrow's plan into tomorrow's todos, and keep weekly / monthly / yearly goals in view. There is also a small daily draw for lunch and luck.

[简体中文](docs/lang/README_ZH.md) · [Quick start](#quick-start) · [What it does](#what-it-does) · [A little luck](#a-little-luck) · [Privacy & data](#privacy--data) · [Troubleshooting](#troubleshooting)

[![npm](https://img.shields.io/npm/v/dsh-zhixing?label=npm)](https://www.npmjs.com/package/dsh-zhixing)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/pawvis/dsh-zhixing?label=release)](https://github.com/pawvis/dsh-zhixing/releases)

</div>

## One plugin, four pages

| What you want | Where to start | What it needs |
| --- | --- | --- |
| See what to do today | **今日 / Today** | Nothing; all local |
| Write or revisit a daily report | **日报 / Reports** | Optional: a DSH model for AI drafting and weekly / monthly summaries |
| Keep goals and progress | **目标 / Goals** | Nothing; AI goal breakdown is optional |
| Set reminders, region and clock | **设置 / Settings** | Nothing |

The plugin appears in the DSH sidebar as **知行**. The UI is in Simplified Chinese; the data is local and shared across all workspaces.

## Quick start

1. Install DeepSeek Harness Desktop 0.2.x and make sure plugins are enabled.
2. In DSH, open **Plugins → Add plugin**, enter `dsh-zhixing`, and install it. Or use the CLI:

   ```sh
   dsh plugin --profile desktop add dsh-zhixing
   ```

   From source: clone `https://github.com/pawvis/dsh-zhixing.git` and select the cloned folder in **Plugins → Add plugin**.
3. Restart DSH and open **知行** in the sidebar.
4. Open **设置** to set the morning / evening reminders, region and clock. Everything is stored under `~/.dsh/data/知行/`.

## What it does

### 今日 / Today

- Todos split into **overdue / today / later**, with carry-over and close actions; list and Gantt views.
- Quick add; link a todo to a goal; attach files; paste a paragraph, URL or attachment and let AI break it into todos.
- A content calendar with the title of each day's report; click a day to open or create a report.
- Morning / evening reminders; an optional weather line; a built-in daily quote; a draggable split and a compact narrow layout.
- The two small entries described in [A little luck](#a-little-luck): **今天吃什么** and **今日运势**.

### 日报 / Reports

- Daily, weekly and monthly reports stored as plain Markdown under `~/.dsh/data/知行/日报/`; editable in Obsidian too.
- Collect material from Harness sessions, add notes and files, generate a draft, edit and save; tomorrow's plan becomes tomorrow's todos.
- Edit historical reports, copy, export to PDF / PNG / HTML, use HTML preview, templates and goal tags.
- Generate weekly / monthly reports from the daily reports; AI drafting is optional.

### 目标 / Goals

- Yearly → monthly → weekly goals, arbitrary depth; every goal needs a measure.
- Progress is computed from child goals; leaf goals can be updated manually or from AI suggestions.
- List and timeline views; import goals from text or files with AI; create and edit in dialogs.
- After a report is saved, goal suggestions can appear; accept one to update progress.

### 设置 / Settings

- Morning / evening reminders, weekend skip, and a goal-stall reminder.
- Region, time zone, 24-hour / 12-hour clock, seconds, weather, daily quote.
- Light / dark theme and the DSH model used by the plugin.

## A little luck

The Today banner has two small entries that work without AI or a network connection:

- **今天吃什么** — a time-aware breakfast / lunch / tea / dinner / night picker with taste filters, a short reel animation, and a one-click "就吃这个" decision.
- **今日运势** — a daily sign, one tarot card (upright only) and a 12-sign horoscope. The result is derived from the local date, stored locally, and stays the same when reopened during the day.

The content is built in; the only persistence is a few `localStorage` keys for today's draws and the chosen zodiac.

## Screenshots

These are illustrative captures of the plugin's own UI. Weather is hidden in the captures; the real todo / report content stays local.

<img src="docs/readme/banner.png" alt="The Today banner with time, date, daily quote and the two lucky entries" width="100%">

*The Today banner: clock, date, daily quote, and the two new entries.*

<img src="docs/readme/lucky.png" alt="今天吃什么, 今日运势 sign, tarot and zodiac" width="100%">

*今天吃什么, 今日运势 (抽签 / 塔罗 / 星座). Illustrative examples.*

## Privacy & data

- **Local data.** Todos, goals, reports, imported files and settings live under `~/.dsh/data/知行/` (or `$DSH_HOME/data/知行/`). Reports are plain Markdown; the folder is shared by all workspaces.
- **No bundled keys.** The plugin ships no API keys. AI features use the model already configured in DSH; only the content you send to an AI feature (report draft, todo breakdown, goal import, progress suggestion) goes to that model.
- **Weather is optional.** The weather line makes a weather request for the configured region; turn it off in Settings. The daily quote is built in.
- **Lucky features are offline.** The draws use the plugin's built-in content, and `localStorage` for today's flags / the chosen zodiac. No network, no AI.
- **UI state** such as theme, split width and lucky flags is kept in browser storage; it is not synced to a server.
- **No telemetry.** There is no analytics or remote logging added by this plugin. Your DSH installation may have its own settings and telemetry.

## Troubleshooting

- **No 知行 entry in the sidebar:** check that DSH Desktop 0.2.x is used, the plugin is enabled under Plugins, and DSH was restarted after installation.
- **AI features are unavailable:** the banner says "AI 暂时不可用" when no model is configured or the model is unreachable. Todos, goals, manual reports and the lucky features still work.
- **Where is my data?** `~/.dsh/data/知行/`: `日报/YYYY-MM-DD.md`, weekly / monthly files in the same `日报/` folder (for example `2026-W46.md`, `2026-11.md`), `待办.json`, `目标.json`, `settings.json`, `导入/` and `log.md`.
- **Weather is wrong:** set the region in 设置, or turn the weather line off.
- **Updating:** replace the folder / pull the repository and restart DSH. The data lives outside the plugin folder, so it is kept.
- **Starting over:** back up `~/.dsh/data/知行/` before deleting it; the plugin recreates the folder when needed.

## Development

Requires Node.js 22.19+ for the checks; the plugin itself runs inside DSH.

```sh
npm run check
```

The check runs `node scripts/check-components.mjs`, `node --check index.js` and `node --check client.js`. There is no build step: DSH serves `client.js` directly, and the CSS is a template string inside the client.

```text
index.js            # plugin entry / server routes
lib/                # store, routes, AI, reports, goals, reminders, ...
client.js           # the whole web UI (React h(), CSS)
locale/             # zh / en UI strings
cordis.patch.yml    # DSH bundle manifest
icon.svg
docs/DETAIL.md      # full feature notes (Chinese)
docs/readme/        # README assets
docs/lang/          # translations
scripts/            # checks
```

Full feature notes: [docs/DETAIL.md](docs/DETAIL.md) (Chinese). Issues and ideas: [GitHub Issues](https://github.com/pawvis/dsh-zhixing/issues).

The npm package is published as `dsh-zhixing`. Maintainers bump the version in `package.json` and run `npm publish` from this folder.

## Languages

**English** · [简体中文](docs/lang/README_ZH.md)

The plugin UI is Simplified Chinese; the Chinese README is the primary user guide.

## License

[MIT](LICENSE) © dsh-zhixing contributors
