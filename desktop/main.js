const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, Tray } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOTKEY_PRESETS = {
  ControlLeft: {
    label: 'Left Ctrl',
    accelerator: 'Control+Space'
  },
  ControlRight: {
    label: 'Right Ctrl',
    accelerator: 'Control+Space'
  },
  AltRight: {
    label: 'Right Option',
    accelerator: 'Alt+Space'
  },
  AltLeft: {
    label: 'Left Option',
    accelerator: 'Alt+Space'
  },
  Space: {
    label: 'Space',
    accelerator: 'CommandOrControl+Shift+Space'
  }
};

const DEFAULT_RECORD_KEY = 'ControlLeft';
const DEFAULT_REWRITE_SYSTEM_PROMPT = '你是 Vibing 的后台文本整理模型。请把语音识别原文整理成可以直接粘贴使用的最终文本。保留真实含义，不编造；删除口头禅、无意义信息、重复信息和自我修正残留；表达更精确、有条理、精简。若原文包含多个事项，优先输出编号列表。只输出最终文本，不要解释过程。';

const DEFAULT_SETTINGS = {
  hotkeys: {
    record: {
      label: 'Left Ctrl',
      key: DEFAULT_RECORD_KEY,
      mode: 'hold',
      electronAccelerator: HOTKEY_PRESETS[DEFAULT_RECORD_KEY].accelerator
    },
    cancel: {
      label: 'Escape',
      key: 'Escape'
    }
  },
  speechRecognition: {
    runtimeMode: 'demo',
    engine: 'whisper-cpp',
    language: 'auto',
    local: {
      scheme: 'whisper.cpp',
      endpoint: 'http://127.0.0.1:8178/v1/audio/transcriptions',
      modelPath: '~/Models/whisper/ggml-large-v3-turbo.bin',
      executablePath: '/opt/homebrew/bin/whisper-cli',
      device: 'auto'
    }
  },
  models: {
    rewrite: {
      enabled: true,
      provider: 'OpenAI compatible',
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5:14b-instruct',
      apiKey: '',
      temperature: 0.2,
      systemPrompt: DEFAULT_REWRITE_SYSTEM_PROMPT
    },
    intent: {
      provider: 'local',
      model: 'qwen2.5:7b-instruct'
    },
    translation: {
      provider: 'local',
      model: 'qwen2.5:14b-instruct'
    },
    localRerank: {
      enabled: true,
      provider: 'sentence-transformers',
      model: 'BAAI/bge-reranker-v2-m3',
      endpoint: 'http://127.0.0.1:8001/rerank',
      topK: 4
    },
    cloudRerank: {
      enabled: false,
      provider: 'Cohere',
      model: 'rerank-v3.5',
      endpoint: 'https://api.cohere.com/v2/rerank',
      apiKey: ''
    }
  },
  workflow: {
    autoPaste: true,
    autoPasteToFrontmost: true,
    copyToClipboard: true,
    runInBackground: true,
    showRawBeforeRewrite: true,
    stripFillers: true,
    punctuation: true,
    rewriteTone: 'concise'
  },
  privacy: {
    sendActiveAppContext: true,
    sendScreenshots: false
  }
};

let mainWindow;
let tray;
let currentSettings = null;
let isQuitting = false;
let rendererReady = false;
const pendingRecordHotkeyPayloads = [];

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  const output = { ...base };
  Object.keys(override || {}).forEach((key) => {
    if (isPlainObject(base[key]) && isPlainObject(override[key])) {
      output[key] = deepMerge(base[key], override[key]);
    } else {
      output[key] = override[key];
    }
  });
  return output;
}

function defaultAcceleratorForKey(key) {
  return HOTKEY_PRESETS[key]?.accelerator || HOTKEY_PRESETS[DEFAULT_RECORD_KEY].accelerator;
}

function keyLabel(key) {
  if (HOTKEY_PRESETS[key]) return HOTKEY_PRESETS[key].label;
  return key || HOTKEY_PRESETS[DEFAULT_RECORD_KEY].label;
}

function normalizeSettings(settings) {
  const normalized = deepMerge(DEFAULT_SETTINGS, settings || {});

  if (!HOTKEY_PRESETS[normalized.hotkeys.record.key]) {
    normalized.hotkeys.record.key = DEFAULT_RECORD_KEY;
  }

  if (!normalized.hotkeys.record.electronAccelerator || !String(normalized.hotkeys.record.electronAccelerator).trim()) {
    normalized.hotkeys.record.electronAccelerator = defaultAcceleratorForKey(normalized.hotkeys.record.key);
  }

  normalized.hotkeys.record.label = keyLabel(normalized.hotkeys.record.key);

  normalized.models.rewrite.enabled = normalized.models.rewrite.enabled !== false;
  normalized.models.rewrite.temperature = Number(normalized.models.rewrite.temperature ?? DEFAULT_SETTINGS.models.rewrite.temperature);
  if (!Number.isFinite(normalized.models.rewrite.temperature)) {
    normalized.models.rewrite.temperature = DEFAULT_SETTINGS.models.rewrite.temperature;
  }
  normalized.models.rewrite.systemPrompt = String(normalized.models.rewrite.systemPrompt || '').trim() || DEFAULT_REWRITE_SYSTEM_PROMPT;

  return normalized;
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    currentSettings = normalizeSettings(JSON.parse(raw));
  } catch (error) {
    currentSettings = normalizeSettings(DEFAULT_SETTINGS);
  }
  return currentSettings;
}

function saveSettings(nextSettings) {
  currentSettings = normalizeSettings(nextSettings);
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(currentSettings, null, 2));
  registerConfiguredShortcut(currentSettings);
  updateTrayMenu();
  return currentSettings;
}

function iconPath() {
  return path.join(__dirname, '..', 'src', 'logo.png');
}

function createWindow() {
  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: 'Vibing',
    backgroundColor: '#f6f3ec',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });
  mainWindow.webContents.on('did-finish-load', flushPendingRecordHotkeys);
  mainWindow.once('ready-to-show', () => showMainWindow());
  mainWindow.on('close', (event) => {
    if (!isQuitting && currentSettings.workflow.runInBackground) {
      event.preventDefault();
      hideMainWindow();
    }
  });
  mainWindow.on('closed', () => {
    rendererReady = false;
    pendingRecordHotkeyPayloads.length = 0;
    mainWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
  }
  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  if (process.platform === 'darwin' && app.dock && currentSettings.workflow.runInBackground) {
    app.dock.hide();
  }
}

function setupTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(iconPath()).resize({ width: 18, height: 18 });
  tray = new Tray(image);
  tray.setToolTip('Vibing is running in the background');
  tray.on('double-click', showMainWindow);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const accelerator = currentSettings?.hotkeys?.record?.electronAccelerator || '未设置';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Vibing', click: showMainWindow },
    { label: `Record hotkey: ${accelerator}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Start / Stop Recording',
      click: () => {
        void sendRecordHotkey('tray-menu');
      }
    },
    { label: 'Hide to Background', click: hideMainWindow },
    { type: 'separator' },
    {
      label: 'Quit Vibing',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
}

function runAppleScript(lines) {
  const args = lines.flatMap((line) => ['-e', line]);
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', args, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: (stdout || '').trim(),
        error: error ? (stderr || error.message || 'AppleScript failed').trim() : null
      });
    });
  });
}

async function getFrontmostAppName() {
  if (process.platform !== 'darwin') return null;
  const result = await runAppleScript([
    'tell application "System Events" to get name of first application process whose frontmost is true'
  ]);
  if (!result.ok) return null;
  return result.stdout || null;
}

function flushPendingRecordHotkeys() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!rendererReady || mainWindow.webContents.isLoading()) return;
  while (pendingRecordHotkeyPayloads.length) {
    const payload = pendingRecordHotkeyPayloads.shift();
    mainWindow.webContents.send('record-hotkey-triggered', payload);
  }
}

function queueRecordHotkey(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  pendingRecordHotkeyPayloads.push(payload);
  flushPendingRecordHotkeys();
}

async function sendRecordHotkey(source = 'global-shortcut') {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  const frontmostApp = await getFrontmostAppName();
  queueRecordHotkey({
    source,
    triggeredAt: Date.now(),
    frontmostApp: frontmostApp && frontmostApp !== 'Vibing' ? frontmostApp : null
  });
}

function registerRecordAccelerator(accelerator) {
  return globalShortcut.register(accelerator, () => {
    void sendRecordHotkey('global-shortcut');
  });
}

function normalizeAccelerator(value) {
  return String(value || '').trim();
}

function validateGlobalAccelerator(accelerator) {
  const candidate = normalizeAccelerator(accelerator);
  if (!candidate) {
    return {
      ok: false,
      available: false,
      validFormat: false,
      reason: 'empty',
      message: '请输入全局热键组合。'
    };
  }

  const active = normalizeAccelerator(currentSettings?.hotkeys?.record?.electronAccelerator);
  if (active && active === candidate && globalShortcut.isRegistered(active)) {
    return {
      ok: true,
      available: true,
      validFormat: true,
      reason: 'current',
      message: '当前组合键已被 Vibing 使用。'
    };
  }

  const shouldRestoreActive = Boolean(active && globalShortcut.isRegistered(active));
  if (shouldRestoreActive) {
    globalShortcut.unregister(active);
  }

  let registered = false;
  try {
    registered = globalShortcut.register(candidate, () => {});
  } catch (error) {
    if (shouldRestoreActive) {
      const restored = registerRecordAccelerator(active);
      if (!restored) {
        console.warn(`Could not restore accelerator after validation failure: ${active}`);
      }
    }
    return {
      ok: false,
      available: false,
      validFormat: false,
      reason: 'invalid',
      message: `热键格式无效：${error.message || 'unknown error'}`
    };
  }

  if (registered) {
    globalShortcut.unregister(candidate);
  }

  if (shouldRestoreActive) {
    const restored = registerRecordAccelerator(active);
    if (!restored) {
      console.warn(`Could not restore accelerator after validation: ${active}`);
    }
  }

  if (!registered) {
    return {
      ok: true,
      available: false,
      validFormat: true,
      reason: 'occupied',
      message: '该组合键可能被系统或其他应用占用，请更换。'
    };
  }

  return {
    ok: true,
    available: true,
    validFormat: true,
    reason: 'available',
    message: '该组合键可注册。'
  };
}

function registerConfiguredShortcut(settings) {
  globalShortcut.unregisterAll();
  const accelerator = normalizeAccelerator(settings.hotkeys.record.electronAccelerator);
  if (!accelerator) return;

  const registered = registerRecordAccelerator(accelerator);
  if (!registered) {
    console.warn(`Could not register accelerator: ${accelerator}`);
  }
}

function demoTranscript(durationMs) {
  if (durationMs > 8500) {
    return '我想把这一段录音马上识别成文字，然后让模型去掉口头禅、整理顺序，再输出一版可以直接粘贴的内容。还有就是如果我说了很多重复的信息，希望它能自动删掉。';
  }
  return '嗯我想测试一下 Vibing 的录音识别，然后把结果重新排列一下，让它更适合直接发送，然后不要让我再手动复制粘贴。';
}

function stripFillers(text) {
  return text
    .replace(/\b(um|uh|like|you know)\b/gi, ' ')
    .replace(/[，,。\s]*(嗯|呃|啊|就是|那个|然后然后|对吧)[，,。\s]*/g, '，')
    .replace(/，{2,}/g, '，')
    .replace(/^，|，$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function dedupeFragments(text) {
  const fragments = text
    .split(/(?<=[。！？!?])|[；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const output = [];
  fragments.forEach((fragment) => {
    if (!output.includes(fragment) && output[output.length - 1] !== fragment) {
      output.push(fragment);
    }
  });
  return output.join('');
}

function maybeListify(text, settings) {
  const shouldList = settings.workflow.rewriteTone === 'bullet' || /(第一|第二|第三|首先|其次|最后|一是|二是|三是|还有|另外)/.test(text);
  if (!shouldList) return text;

  const parts = text
    .replace(/(第一|首先|一是)/g, '\n')
    .replace(/(第二|其次|二是|还有|另外)/g, '\n')
    .replace(/(第三|最后|三是)/g, '\n')
    .split('\n')
    .map((part) => part.replace(/^[，,。\s]+|[，,。\s]+$/g, '').trim())
    .filter(Boolean);

  if (parts.length < 2) return text;
  return parts.map((part, index) => `${index + 1}. ${part.replace(/[。.]$/g, '')}`).join('\n');
}

function rewriteTranscript(text, settings) {
  const cleaned = dedupeFragments(settings.workflow.stripFillers ? stripFillers(text) : text.trim());
  if (settings.workflow.rewriteTone === 'formal') {
    return maybeListify(cleaned, settings).replace('我想', '我希望').replace('不要让我', '无需用户');
  }
  return maybeListify(cleaned, settings)
    .replace('重新排列一下', '自动重排')
    .replace('更适合直接发送', '可以直接发送')
    .replace('不要让我再手动复制粘贴', '处理完成后自动粘贴到当前输入位置');
}

function rewritePrompt(text) {
  return `原始识别文本：\n${text}`;
}

function normalizeProvider(provider) {
  const value = String(provider || '').toLowerCase();
  if (value.includes('anthropic')) return 'anthropic';
  if (value.includes('gemini')) return 'gemini';
  return 'openai-compatible';
}

function rewriteSystemPrompt(rewrite) {
  return String(rewrite.systemPrompt || '').trim() || DEFAULT_REWRITE_SYSTEM_PROMPT;
}

async function requestOpenAICompatibleRewrite(promptText, rewrite) {
  if (!rewrite.endpoint) return null;
  const headers = { 'content-type': 'application/json' };
  if (rewrite.apiKey) headers.authorization = `Bearer ${rewrite.apiKey}`;

  const response = await fetch(rewrite.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: rewrite.model,
      temperature: Number(rewrite.temperature || 0.2),
      messages: [
        { role: 'system', content: rewriteSystemPrompt(rewrite) },
        { role: 'user', content: promptText }
      ]
    })
  });

  if (!response.ok) throw new Error(`rewrite endpoint returned ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || data.text?.trim() || null;
}

async function requestAnthropicRewrite(promptText, rewrite) {
  const endpoint = rewrite.endpoint || 'https://api.anthropic.com/v1/messages';
  if (!rewrite.apiKey) throw new Error('Anthropic provider requires API key.');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': rewrite.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: rewrite.model,
      temperature: Number(rewrite.temperature || 0.2),
      max_tokens: 1200,
      system: rewriteSystemPrompt(rewrite),
      messages: [
        { role: 'user', content: promptText }
      ]
    })
  });

  if (!response.ok) throw new Error(`rewrite endpoint returned ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.content)) return null;
  return data.content.map((part) => part?.text || '').join('').trim() || null;
}

function buildGeminiEndpoint(rewrite) {
  let endpoint = String(rewrite.endpoint || '').trim();
  if (!endpoint) {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(rewrite.model)}:generateContent`;
  } else if (!endpoint.includes(':generateContent')) {
    const trimmed = endpoint.replace(/\/$/, '');
    if (trimmed.includes('/models/')) {
      endpoint = `${trimmed}:generateContent`;
    } else if (trimmed.endsWith('/v1beta')) {
      endpoint = `${trimmed}/models/${encodeURIComponent(rewrite.model)}:generateContent`;
    } else {
      endpoint = `${trimmed}/v1beta/models/${encodeURIComponent(rewrite.model)}:generateContent`;
    }
  }

  if (rewrite.apiKey && !/[?&]key=/.test(endpoint)) {
    endpoint += `${endpoint.includes('?') ? '&' : '?'}key=${encodeURIComponent(rewrite.apiKey)}`;
  }
  return endpoint;
}

async function requestGeminiRewrite(promptText, rewrite) {
  const endpoint = buildGeminiEndpoint(rewrite);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: rewriteSystemPrompt(rewrite) }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }]
        }
      ],
      generationConfig: {
        temperature: Number(rewrite.temperature || 0.2)
      }
    })
  });

  if (!response.ok) throw new Error(`rewrite endpoint returned ${response.status}`);
  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  return parts.map((part) => part?.text || '').join('').trim() || null;
}

async function requestLocalTranscription(payload, settings) {
  if (settings.speechRecognition.runtimeMode !== 'local') return null;
  const endpoint = settings.speechRecognition.local.endpoint;
  if (!endpoint) return null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        audioBase64: payload.audioBase64,
        language: settings.speechRecognition.language,
        modelPath: settings.speechRecognition.local.modelPath,
        scheme: settings.speechRecognition.local.scheme
      })
    });

    if (!response.ok) throw new Error(`ASR endpoint returned ${response.status}`);
    const data = await response.json();
    return data.text || data.transcript || data.result || null;
  } catch (error) {
    console.warn(`Local ASR fallback: ${error.message}`);
    return null;
  }
}

async function requestRewriteModel(text, settings) {
  const rewrite = settings.models.rewrite;
  if (!rewrite.enabled || !rewrite.model) return null;

  const promptText = rewritePrompt(text);
  const provider = normalizeProvider(rewrite.provider);

  try {
    if (provider === 'anthropic') {
      return await requestAnthropicRewrite(promptText, rewrite);
    }
    if (provider === 'gemini') {
      return await requestGeminiRewrite(promptText, rewrite);
    }
    return await requestOpenAICompatibleRewrite(promptText, rewrite);
  } catch (error) {
    console.warn(`Rewrite model fallback: ${error.message}`);
    return null;
  }
}

async function transcribeAudio(payload) {
  const settings = normalizeSettings(payload.settings || currentSettings);
  const localTranscript = await requestLocalTranscription(payload, settings);
  const rawTranscript = localTranscript || demoTranscript(payload.durationMs || 0);
  return {
    mode: localTranscript ? 'local' : 'demo-fallback',
    rawTranscript,
    modelRoute: {
      asr: settings.speechRecognition.local.scheme
    }
  };
}

async function rewriteText(payload) {
  const settings = normalizeSettings(payload.settings || currentSettings);
  const modelText = await requestRewriteModel(payload.rawTranscript, settings);
  const finalText = modelText || rewriteTranscript(payload.rawTranscript, settings);
  return {
    mode: modelText ? 'model' : 'heuristic-fallback',
    finalText,
    modelRoute: {
      rewrite: `${settings.models.rewrite.provider}/${settings.models.rewrite.model}`,
      localRerank: settings.models.localRerank.enabled ? settings.models.localRerank.model : 'disabled',
      cloudRerank: settings.models.cloudRerank.enabled ? settings.models.cloudRerank.model : 'disabled'
    }
  };
}

async function osascriptPaste(targetApp) {
  const scriptLines = [];
  if (targetApp) {
    const appName = String(targetApp).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    scriptLines.push(`tell application "${appName}" to activate`);
    scriptLines.push('delay 0.12');
  } else {
    scriptLines.push('delay 0.08');
  }
  scriptLines.push('tell application "System Events" to keystroke "v" using command down');

  const result = await runAppleScript(scriptLines);
  return { pasted: result.ok, error: result.error };
}

async function deliverText(payload) {
  const settings = normalizeSettings(payload.settings || currentSettings);
  const text = payload.text || '';
  const shouldCopy = settings.workflow.copyToClipboard || settings.workflow.autoPaste || settings.workflow.autoPasteToFrontmost;
  if (shouldCopy) clipboard.writeText(text);

  if (!settings.workflow.autoPaste || !settings.workflow.autoPasteToFrontmost) {
    return { copied: shouldCopy, pasted: false, error: null };
  }

  if (process.platform !== 'darwin') {
    return { copied: true, pasted: false, error: 'Automatic paste is currently implemented for macOS.' };
  }

  const targetApp = payload.targetApp && payload.targetApp !== 'Vibing' ? payload.targetApp : null;
  return { copied: true, ...(await osascriptPaste(targetApp)) };
}

async function processAudio(payload) {
  const transcription = await transcribeAudio(payload);
  const rewrite = await rewriteText({ rawTranscript: transcription.rawTranscript, settings: payload.settings });
  const delivery = await deliverText({ text: rewrite.finalText, settings: payload.settings, targetApp: payload.targetApp });
  return { ...transcription, ...rewrite, ...delivery };
}

ipcMain.handle('settings:load', () => loadSettings());
ipcMain.handle('settings:save', (_event, settings) => saveSettings(settings));
ipcMain.handle('hotkey:validate-global-accelerator', (_event, accelerator) => validateGlobalAccelerator(accelerator));
ipcMain.handle('workflow:transcribe-audio', (_event, payload) => transcribeAudio(payload));
ipcMain.handle('workflow:rewrite-text', (_event, payload) => rewriteText(payload));
ipcMain.handle('workflow:deliver-text', (_event, payload) => deliverText(payload));
ipcMain.handle('workflow:process-audio', (_event, payload) => processAudio(payload));
ipcMain.handle('workflow:copy', (_event, text) => {
  clipboard.writeText(text || '');
  return true;
});
ipcMain.handle('app:renderer-ready', () => {
  rendererReady = true;
  flushPendingRecordHotkeys();
  return true;
});
ipcMain.handle('app:hide-window', () => {
  hideMainWindow();
  return true;
});
ipcMain.handle('app:show-window', () => {
  showMainWindow();
  return true;
});

app.whenReady().then(() => {
  loadSettings();
  setupTray();
  registerConfiguredShortcut(currentSettings);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});