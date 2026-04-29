<div align="center">

<img src="src/logo_transparent.png" alt="Vibing" width="360">

[![Demo Page](https://img.shields.io/badge/Demo-Page-green?logo=githubpages)](https://vibingjustspeakit.github.io/Vibing/)
[![GitHub](https://img.shields.io/badge/GitHub-Repo-black?logo=github)](https://github.com/VibingJustSpeakIt/Vibing)
[![Powered by VibeVoice](https://img.shields.io/badge/Powered_by-VibeVoice-orange?logo=microsoft)](https://github.com/microsoft/VibeVoice)

</div>

---

## Video Introduction

<div align="center">

https://github.com/user-attachments/assets/db0bb23f-ae06-4135-a66a-1ff1669f4f84

</div>


## How to Use

<p align="center">
  <img src="src/usage.png" alt="How to Use" width="100%">
</p>

## Installation Guide (Mac)

Step-by-step setup instructions for macOS — accessibility, screen recording & microphone permissions.

👉 [**Mac Setup Guide**](https://vibingjustspeakit.github.io/Vibing/installation-guide.html)

## Desktop Prototype

This repository also contains an Electron desktop prototype for the configurable recording workflow: local speech recognition settings, local/cloud rerank models, rewrite models, background operation, automatic clipboard delivery, and a default in-window recording key of **Right Option** on macOS.

```bash
npm install
npm start
```

Build an Apple Silicon DMG:

```bash
npm run build:dmg
```

Build a Windows installer locally when the host has the required electron-builder Windows tooling available:

```bash
npm run build:win
```

The repository includes a GitHub Actions workflow at `.github/workflows/build-windows.yml` that builds the Windows NSIS installer on `windows-latest` whenever desktop code is pushed to `main`, or manually via `workflow_dispatch`.

The desktop prototype starts in demo mode so the recording -> recognition -> rerank -> rewrite -> automatic paste flow can be tested before a local ASR server is connected. In local ASR mode, Vibing posts recorded audio to the configured endpoint, shows the raw transcript first, then sends the text to the configured rewrite model. The final text is copied and, on macOS with Accessibility permission, pasted into the active foreground input automatically.

## Key Features

- **Long-Form Voice Input** — Over 5 minutes of continuous speech in a single recording.
- **Personalized Hotwords** — Custom vocabulary for names, jargon, and domain-specific terms.
- **Context-Aware Intent Understanding** — Understands what you mean, not just what you say.
- **Multilingual** — Speak in any of 50+ languages with automatic detection.
- **Mixed-Language Input** — Switch between languages freely within a single sentence.
- **LLM-Powered Rewriting** — AI rewrites your speech into polished, context-appropriate text.
- **Translation** — Real-time voice translation across languages.

## Privacy

**Data processing:** To provide more accurate transcription, context-aware rewriting, and translation results, Vibing sends your audio and contextual information (such as screenshots, text in the active input field, and the current application name) to our servers. This data is used solely to process your request and return results. It is not retained after processing is complete.

**Privacy commitment:** Your data is never stored or used for model training, analytics, or any other purpose beyond fulfilling your immediate request.
