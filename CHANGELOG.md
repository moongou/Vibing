# Changelog

All notable changes to Vibing will be documented in this file.

## [0.1.0] - 2026-04-29

### Added

- Added an Electron desktop prototype for Vibing.
- Added a recording workbench that captures audio, shows the raw transcript first, rewrites it in the background, and delivers the final text automatically.
- Added configurable local speech recognition, rewrite models, intent/translation models, local rerank models, and cloud rerank models.
- Added background operation with tray controls and a configurable global recording hotkey.
- Added automatic clipboard delivery and macOS foreground paste support.
- Added macOS DMG packaging with app icon and microphone/speech recognition permission descriptions.
- Added Windows NSIS installer packaging and a GitHub Actions workflow for Windows installer builds.

### Changed

- Documented desktop usage, macOS DMG builds, Windows installer builds, and the automatic paste workflow in the README.
- Disabled Windows auto-publish during CI so installer artifacts are uploaded by the workflow instead.

### Notes

- macOS automatic paste requires Accessibility permission.
- macOS DMG builds are currently unsigned and unnotarized.
