# Changelog

All notable changes to Bono Engineer are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-11-13

### Added

- **Track recognised on the pre-race screen.** Before a race or a time trial the game plays a lap with your car in the background. Bono now reads the path of that car and names the circuit within about 150 m of it moving, before you drive a metre, with no lap of yours on that track needed (checked on a real PS5: Trial Mountain, Suzuka and Road Atlanta). The live bar shows the circuit name; layouts that share their first metres (Suzuka Full and East) show the circuit first and the layout once the car has run one loop. It is a "probable" label only: nothing is saved from it.
- **Engineer tasks.** An AI agent (through MCP) or the in-app AI Coach can now *propose* instructions for the radio engineer, such as "At turn seven, entry. Brake twenty meters later.", and you approve them in the app: **Home → Agent proposals** and the new **Tasks** tab on each track (listen, approve, edit, pause or delete; you can also create your own). Nothing is said before you approve. The engineer says each approved task at its place on the lap, finishing right at the point, at most twice per lap (1–4 in **Settings → Engineer → More options**), never on the out lap and never inside a corner.
- Sentences are composed only from a dictionary of recorded phrases (about 217 pieces per voice, in Portuguese, English and Spanish): the MCP and the server refuse anything the dictionary cannot say and list what is valid, and the requests it could not say are kept so the dictionary can grow.
- New MCP tools: `get_task_dictionary`, `propose_engineer_task` (with `dry_run`), `list_engineer_tasks`, `update_engineer_task` and `withdraw_engineer_task`. They need no token: tasks only add speech and text, and an agent can never activate, pause or delete an approved task.
- **Tasks voice:** the audio of the tasks is downloaded from GitHub only after you allow it, only for the voice in use (about 14 MB), and is checked by size and SHA-256 before it is played.
- **In-app updates on Windows.** Bono checks for releases after launch and in **Settings → About**. Read the release notes, download the update and choose **Restart and install**. The notes are also available after restart. The portable edition can save the new executable from the same screen. Users on 0.7.1 or earlier need to install 0.8.0 once to get the updater.

### Changed

- Standardised technical identifiers and app and site URLs in English. Existing dashboard profiles and bookmarks are accepted.

### Fixed

- Kept release notes and their close button accessible in short windows, reflowed the update controls, and aligned the diagnostic counters.
- Reflowed the track map and corner editor on phones. The active track tab stays in view when opening a link or resizing the window.
- Kept the bottom navigation labels readable and the custom dashboard preview scrollable with dense grids.
- Moved the AI Coach reply form below the conversation on narrow screens and made the history tour scroll to an offscreen track card.

## [0.7.1] - 2026-11-13

<!-- release-notes-since: 0.1.0 -->

### Fixed

- Fixed cards touching each other on Home (the "session ended" card and **Your week**) and anywhere else two cards, panels or stat rows sit one under the other on a page: they now always have space between them, by one rule for the whole analysis area instead of a margin each component had to remember.

## [0.7.0] - 2026-11-12

<!-- release-notes-since: 0.1.0 -->

### Added

- Added the **weekly summary** (`#/analysis/week`): the last 7 days on one screen (or the 7 before them, one week back at a time) with sessions, laps, time on track, the best lap of each track against the record before it, personal records and goals reached. Copy it as text or share it as an image (download or copy the PNG). A **Your week** card on Home links to it.
- Added a **goal suggestion from this week's Daily Race medal**: on a track that runs as one of the three races of the week, **My goal** offers the next medal above your best lap ("the gold medal is 2:02.662, 1.1 s from your best lap") with a button to use it. It needs the Daily Races turned on.
- Added MCP tools that give the AI Coach (and any MCP agent) the newer data: `get_goal`, `get_session_summary`, `get_sectors`, `list_corner_drills` and `get_weekly_summary`, plus two more ready-made questions in the coach ("Close to my goal?" and "Weekly summary"). `GET /api/analysis/weekly` serves the summary.

## [0.6.0] - 2026-11-12

<!-- release-notes-since: 0.1.0 -->

### Added

- Added a **lap replay** (`#/analysis/lap/:id`), like the Gran Turismo replay: one dot runs the track map while the readout and the synced charts follow the lap clock (speed, gear, rpm, brake, throttle and steering). It has play/pause, 0.25×/0.5×/1×/2×, a time bar, 0.1 s steps (Shift: 1 s) and keyboard shortcuts. Pick your best lap or a top reference and a ghost runs beside it, at the same distance (default) or at the same lap clock, with the live delta; **What went wrong / What went right** lists the driving events and the corners that lose or gain time against it, and tapping one jumps the replay to the spot. It opens from **Replay** on every lap (track page, session page) and from the comparison.
- Added exact values to the **Best lap by day** chart on the track page: pointing at (or touching) a day shows its time to the thousandth for every line, and a table under the chart lists every day with the best lap, the average of the best three and the difference to the base.

- Added **AI Coach with a chat**: ask about your driving in plain language and the coach fetches the real data with the same tools the app uses. One tap on ready-made questions (strengths and weaknesses, times of your latest sessions, what to improve, how you are progressing, which corner to drill, consistency, best times, debrief of the last session) or write your own, with no session to pick first; follow-up questions continue the same conversation, and the specific-session debrief is still there.
- Added **OpenAI** to the AI Coach next to Claude: choose the provider and the model (GPT-5, GPT-5 mini, GPT-4.1 or another id), paste the API key and the key is tested before the chat opens. Settings → AI Coach uses the same screen.
- Added a **step-by-step guide to use the coach through your own AI agent over MCP**, with no API key: Claude Code (Code tab) and OpenAI Codex connect to the web address of the running Bono (one line, no paths of your PC); the local command stays as a collapsed alternative that works with Bono closed and also covers the Claude chat. It explains why ChatGPT and the Claude chat cannot reach a local address and lists the questions worth copying into the agent.
- Added `POST /api/coach/ask` (free chat), `POST /api/coach/verify` (test a saved key) and the OpenAI fields of `PUT /api/coach/config`; `GT7_OPENAI_BASE_URL` points the client to an OpenAI-compatible endpoint.

### Changed

- Changed the **Lap comparison** screen opened from the menu: instead of sending you to Home it now lets you choose, on the same page, the track, your lap (fastest or most recent) and what to compare it with (the automatic reference, your best lap or a top reference), with a Compare button that stays in view and everything already preselected.
- Made the **Key corner** chart on the track page easier to read: it always shows the zero line (the base), writes each day's value on its point and opens with a sentence on how to read it, the latest day, the change from the previous day and the best day.

### Fixed

- Fixed the missing space between cards on the session summary and on **My goal** (the track page), which left them touching each other.

## [0.5.0] - 2026-11-12

<!-- release-notes-since: 0.1.0 -->

### Added

- Added a goal per track (**My goal** on the track page): type a lap time or take the suggestion (the ideal lap, or 0.5% under your best). Live, a small line shows the difference to the goal pace; after each valid lap the engineer says how far you are ("Distância para a meta") or "Boa volta." when you reach it. Goals reached go to a history and travel in the `.bono` backup.
- Added a **Sectors** tab on the track page: best time of each sector and the lap that made it, the average of the best five, what your best lap leaves behind, and the ideal lap (sum of the best sectors), with a button to use it as the goal.
- Added a **session summary** (`#/analysis/session/:id/summary`): best lap against your record, pace (average of the best five and median), consistency and trend, comparison with the last session, the best one or the goal, where you gained and lost per corner, and up to three rule-made tips. It opens from the "Session saved" notice, a card on Home or the session page, and can be copied as text.
- Added **Where you lose time** to the lap comparison: the three corners that cost the most with the probable cause and the number behind it, closing with the straights so the sum matches the lap delta. The map can now colour your lap by gain and loss, speed, brake, throttle or line difference (with text markers for the larger differences).
- Added **corner drills**: pick a corner and the engineer talks only about it, rating every pass against your best one (stretch time, speeds, braking point). It works on any lap, keeps the last ten passes, shows a summary when you stop and stores the passes with the session. Start it on the Corner drill screen or from "Drill this corner" in a comparison.
- Added a **pit planner** to the fuel screen (last lap to pit, fuel to add, number of stops) and an **estimate of tyre pace** on the tyres screen, read from the lap times because the game does not send wear. Both are labelled as estimates.
- Added a "five laps of fuel" call from the engineer (before the existing two, one and less-than-one-lap calls) when the race length is unknown. It comes with new voice clips, so the voice packs were regenerated for every voice.
- Added help articles for all of the above, in Portuguese, English and Spanish.

## [0.4.0] - 2026-11-12

<!-- release-notes-since: 0.1.0 -->

### Added

- Added a 15-second animated film to the site (Portuguese and English) that explains how Bono works in five scenes, with a pause control, and a reserved place for a short silent video (`site/assets/motion`).
- Animated the site hero: a drawn track with a light comet, the rev lights that fill and flash at the shift, the gear going up, the speed and live delta changing, rotating radio calls, and entrance and scroll effects. Everything stops with "reduce motion" and the page needs no JavaScript.

### Changed

- **Changed the license** of new versions from MIT to the [PolyForm Noncommercial License 1.0.0](LICENSE): the source stays available and the app stays free, and anyone can read, use, change and share it for noncommercial purposes, but commercial use is not allowed. Contributions are welcome under the terms in [CONTRIBUTING.md](CONTRIBUTING.md). Versions up to 0.3.1 remain under the MIT License for everyone who received them.
- The "Open on your phone" QR code on Home no longer has a close button: it stays in place, since it does not get in the way.
- Brought the English and Portuguese READMEs, the site, and the server and MCP docs up to date with the guided start and Help center, Daily Races, data folder and `.bono` backups, the Discord wizard, and the current Settings names.

### Fixed

- Fixed the ranking time and driver fields in the replay capture sitting at different heights when one of the help texts took two lines.

## [0.3.1] - 2026-11-12

<!-- release-notes-since: 0.1.0 -->

### Added

- Added quick phone access: shortcuts on Home and a dismissible QR code with the local network address, so a phone can open the dashboard in one scan. The Daily Races cards also got return links.

### Changed

- New Bono logo in the app, the Windows installer and tray, the web app icons, the site and the social preview.
- Improved the layout on small screens: live controls are grouped, telemetry readouts stay clear of each other, Daily Races cards are more compact, and the PS5 status and retry action are aligned.

### Fixed

- Fixed the telemetry carousel showing behind a full-screen status card, and the phone shortcut overlapping the sticky live menu tabs.
- The saved engineer voice is now restored on the first browser interaction, so the radio speaks with the chosen voice from the start.

## [0.3.0] - 2026-11-12

<!-- release-notes-since: 0.1.0 -->

### Added

- Added a help center (Help in the menu, `#/help`) with short guides by topic, in Portuguese, English and Spanish, and URL parameters to start the guided tours directly (`?tour=live` and `?tour=analysis`).
- Added Daily Races: the three races of the week with their rules, medal times, top 100 and top 1000, most used cars and 1st place, shown next to your best lap on the same track. They are off until you say yes to a one-time question on Home, then read from DG EDGE on your own PC (at most once an hour, cached, honouring `robots.txt`, with a link back to the source), and can be turned off in Settings. Only the time and car of 1st place are kept, never the player's name. "Use as reference" opens the replay capture with the ranking time filled in.
- Added a choice of data folder in the Windows app (including OneDrive, Dropbox and similar folders, with a safer write mode there) and `.bono` backups: export sessions, laps and settings (never keys or passwords) and import them to add to or replace your history.

### Changed

- The radio voices no longer carry first names: they are now Voice 1, Voice 2 and Voice 3 in each language (Voz 1-3 in Portuguese and Spanish), with a short description of the tone. Saved voice preferences keep working.

### Fixed

- Filled in the longest straight of SUGO in the track catalogue (704.5 m), which was empty.

## [0.2.0] - 2026-11-11

<!-- release-notes-since: 0.1.0 -->

### Added

- Added a 6-step first-run assistant (language and voice, PS5 connection, training style, engineer, dashboard layout, summary) that resumes where it stopped, plus a light invitation for people who already have history. The engineer now stays on or off between launches.
- Added a guided tour of the live dashboard (run on the demo, so it does not need the PS5 or a car on track) and of the analysis area, with one-time hints and a "Take the tour" button in the menu.
- Added a live context bar that always shows the track, the car and the engineer state, a three-step guide for the recognition lap, honest engineer status in every mode, and a "Which track is it?" sheet with catalog suggestions.
- Added an optional track choice before the session starts. A saved track lets the engineer talk from lap 1, with a safe check and correction if the choice turns out wrong.
- Added a Discord setup wizard (create the bot, paste the token, invite it, pick the voice channel) with an automatic invite link and a channel list. The bot joins when anyone is in the channel, so the user ID is no longer needed. The manual delay calibration stays available as fine-tuning.
- Added a switch in the live menu to speak through Discord, a custom Windows title bar and a themed scrollbar.
- Added a public site for GitHub Pages with SEO, English summary, install and Discord guides, and a workflow that publishes it.
- Added local usage diagnostics in Settings > About (stored only on this device) and Spanish and English translations for all new screens.

### Changed

- Reorganized Settings into six groups (Home, Console, Engineer, Dashboard and devices, Accounts and data, About) with a health summary, search, a compact device list, and advanced options collapsed. Raw packet recording is now off on new installations.
- Applied one design system (Pit Wall tokens, shared components, a single modal) across the live dashboard and the analysis area, with accessibility fixes for contrast, text size and 44 px touch targets, one glossary for labels, and actionable empty states.

### Fixed

- Fixed the Windows title bar layout on narrow windows.
- Replaced the misleading "Radio ready" status with the real engineer state when no track or reference exists.

## [0.1.4] - 2026-11-11

### Changed

- Replaced the microphone icon with a handheld radio and added bottom spacing below the live dashboard controls.

### Fixed

- Positioned the live menu and other dialogs below the Windows title bar so their headers and controls stay accessible.

## [0.1.3] - 2026-11-10

<!-- release-notes-base: 0.1.2 -->

### Added

- Added Brazilian Portuguese, English and Spanish in Settings, with three offline neural radio voices and the same call catalogue in each language. The selected voice also applies to Discord output from the Windows app.

## [0.1.2] - 2026-11-10

### Added

- Added a microphone button beside the live dashboard menu and lock. It toggles the radio card, remembers the choice on the current device, and leaves playback running.
- Added a live-menu switch for routing the race radio to Discord.
- Added GitHub Actions to validate pull requests and pushes to `main`, build Windows x64 installer and portable executables, and publish new package versions with these release notes.
- Added an English README, a Brazilian Portuguese guide, current screenshots, and an MIT license.

### Changed

- Redesigned the live dashboard, menus, and analysis pages around the Pit Wall interface, with shared styling for controls, dialogs, icons, and status indicators.
- Updated the Windows title bar to match the app theme and added matching scrollbars.
- Synchronized the desktop package and the server's reported version with the release version in the root package manifest.

### Fixed

- Included the track-name lookup in source checkouts so a clean checkout can build the dashboard.
- Made startup and coach coverage tests work with Windows port reservations and line endings.

## [0.1.1] - 2026-11-10

### Added

- Added deterministic Training, Qualifying, and Race radio modes with neural Brazilian Portuguese voices and per-device audio routing.
- Added track-learning, pace improvement, consistency, and free-driving profiles, with configurable call detail, summaries, and positive feedback.
- Added distance-based braking calls with an optional target percentage from a compatible reference lap.
- Added driving-event review in lap comparisons and radio coaching for high-confidence events.
- Added Discord voice output for the PS5, in-app bot configuration with encrypted credential storage, and ten-beep latency calibration for time-sensitive calls.
- Added an in-app fullscreen control for the desktop and browser.
- Added a bundled MCP stdio executable mode to the Windows desktop app.

### Changed

- Replaced the earlier radio voice selection with offline clips for Alex, Santa, and Bruno.
- Refined replay reference capture and consolidated app data under the Bono Engineer identity.

## [0.1.0] - 2026-11-09

### Added

- Initial Windows desktop and browser app for Gran Turismo 7 telemetry, with automatic console discovery, a setup assistant, and a synthetic demo.
- Added live timing, reference deltas, vehicle telemetry, track maps, next-corner training, a customizable dashboard, and remote device controls.
- Added automatic session capture, lap validity, history by circuit, and car and track catalogs with automatic track recognition.
- Added replay reference capture, distance-aligned lap comparisons, synchronized telemetry charts, consistency and progress analysis, and data exports.
- Added the driving guide, an Anthropic-powered AI debrief, and MCP tools for telemetry, laps, sessions, tracks, comparisons, and PNG charts.

[Unreleased]: https://github.com/lucassm02/bono-engineer/compare/v0.8.0...main
[0.8.0]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.8.0
[0.7.1]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.7.1
[0.4.0]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.4.0
[0.3.1]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.3.1
[0.3.0]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.3.0
[0.2.0]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.2.0
[0.1.4]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.1.4
[0.1.3]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.1.3
[0.1.2]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.1.2
[0.1.1]: https://github.com/lucassm02/bono-engineer/compare/2ffa36b...94f577d
[0.1.0]: https://github.com/lucassm02/bono-engineer/tree/2ffa36b
