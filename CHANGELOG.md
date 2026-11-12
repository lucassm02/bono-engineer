# Changelog

All notable changes to Bono Engineer are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added exact values to the **Best lap by day** chart on the track page: pointing at (or touching) a day shows its time to the thousandth for every line, and a table under the chart lists every day with the best lap, the average of the best three and the difference to the base.

### Changed

- Made the **Key corner** chart on the track page easier to read: it always shows the zero line (the base), writes each day's value on its point and opens with a sentence on how to read it, the latest day, the change from the previous day and the best day.

### Fixed

- Fixed the missing space between cards on the session summary and on **My goal** (the track page), which left them touching each other.

## [0.5.0] - 2026-11-12

<!-- release-notes-since: 0.1.0 -->

### Added

- Added a goal per track (**My goal** on the track page): type a lap time or take the suggestion (the ideal lap, or 0.5% under your best). Live, a small line shows the difference to the goal pace; after each valid lap the engineer says how far you are ("Distância para a meta") or "Boa volta." when you reach it. Goals reached go to a history and travel in the `.bono` backup.
- Added a **Sectors** tab on the track page: best time of each sector and the lap that made it, the average of the best five, what your best lap leaves behind, and the ideal lap (sum of the best sectors), with a button to use it as the goal.
- Added a **session summary** (`#/analise/sessao/:id/resumo`): best lap against your record, pace (average of the best five and median), consistency and trend, comparison with the last session, the best one or the goal, where you gained and lost per corner, and up to three rule-made tips. It opens from the "Session saved" notice, a card on Home or the session page, and can be copied as text.
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

- Added a help center (Help in the menu, `#/ajuda`) with short guides by topic, in Portuguese, English and Spanish, and URL parameters to start the guided tours directly (`?tour=live` and `?tour=analysis`).
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

[Unreleased]: https://github.com/lucassm02/bono-engineer/compare/v0.4.0...main
[0.4.0]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.4.0
[0.3.1]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.3.1
[0.3.0]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.3.0
[0.2.0]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.2.0
[0.1.4]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.1.4
[0.1.3]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.1.3
[0.1.2]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.1.2
[0.1.1]: https://github.com/lucassm02/bono-engineer/compare/2ffa36b...94f577d
[0.1.0]: https://github.com/lucassm02/bono-engineer/tree/2ffa36b
