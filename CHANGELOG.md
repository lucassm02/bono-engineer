# Changelog

All notable changes to Bono Engineer are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/lucassm02/bono-engineer/compare/v0.1.4...main
[0.1.4]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.1.4
[0.1.3]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.1.3
[0.1.2]: https://github.com/lucassm02/bono-engineer/releases/tag/v0.1.2
[0.1.1]: https://github.com/lucassm02/bono-engineer/compare/2ffa36b...94f577d
[0.1.0]: https://github.com/lucassm02/bono-engineer/tree/2ffa36b
