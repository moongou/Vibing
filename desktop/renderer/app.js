const state = {
  settings: null,
  isRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  startedAt: 0,
  stream: null,
  deliveryTargetApp: null,
  hotkeyCapture: {
    mode: null
  },
  hotkeyValidation: {
    requestId: 0,
    timer: null
  }
};

const SUPPORTED_RECORD_KEYS = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'Space']);
const HOTKEY_CAPTURE_MODES = {
  recordKey: 'record-key',
  globalAccelerator: 'global-accelerator'
};

const fieldTypes = new Map([
  ['models.localRerank.topK', 'number'],
  ['models.rewrite.temperature', 'number'],
  ['models.rewrite.enabled', 'boolean'],
  ['workflow.stripFillers', 'boolean'],
  ['workflow.autoPaste', 'boolean'],
  ['workflow.autoPasteToFrontmost', 'boolean'],
  ['workflow.copyToClipboard', 'boolean'],
  ['workflow.runInBackground', 'boolean'],
  ['workflow.showRawBeforeRewrite', 'boolean'],
  ['models.localRerank.enabled', 'boolean'],
  ['models.cloudRerank.enabled', 'boolean']
]);

function getPath(object, path) {
  return path.split('.').reduce((value, key) => (value ? value[key] : undefined), object);
}

function setPath(object, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  let cursor = object;
  parts.forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') {
      cursor[part] = {};
    }
    cursor = cursor[part];
  });
  cursor[last] = value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function hotkeyLabel(key) {
  if (key === 'ControlLeft') return 'Left Ctrl';
  if (key === 'ControlRight') return 'Right Ctrl';
  if (key === 'AltRight') return 'Right Option';
  if (key === 'AltLeft') return 'Left Option';
  if (key === 'Space') return 'Space';
  return key || 'Left Ctrl';
}

function defaultGlobalAccelerator(key) {
  if (key === 'ControlLeft' || key === 'ControlRight') return 'Control+Space';
  if (key === 'AltLeft' || key === 'AltRight') return 'Alt+Space';
  if (key === 'Space') return 'CommandOrControl+Shift+Space';
  return 'Control+Space';
}

function updateRoutes() {
  const settings = state.settings;
  const recordKeyLabel = hotkeyLabel(settings.hotkeys.record.key);
  $('#hotkey-label').textContent = recordKeyLabel;
  $('#global-hotkey-label').textContent = settings.hotkeys.record.electronAccelerator || '未设置';
  $('#recording-title').textContent = `按住 ${recordKeyLabel}，说完松开。`;
  $('#pipeline-hotkey-hint').textContent = settings.hotkeys.record.mode === 'hold'
    ? `${recordKeyLabel} 按住录音，松开识别`
    : `${recordKeyLabel} 按一次开始，再按一次停止`;
  if (!state.isRecording) {
    $('#record-hint').textContent = `按住 ${recordKeyLabel} 或点击按钮开始录音`;
  }
  $('#runtime-mode').textContent = settings.speechRecognition.runtimeMode === 'local' ? 'Local ASR' : 'Demo mode';
  $('#asr-route').textContent = `${settings.speechRecognition.local.scheme} / ${settings.speechRecognition.language}`;
  $('#rerank-route').textContent = settings.models.localRerank.enabled
    ? settings.models.localRerank.model
    : settings.models.cloudRerank.enabled
      ? settings.models.cloudRerank.model
      : 'rerank disabled';
  $('#rewrite-route').textContent = `${settings.models.rewrite.provider} / ${settings.models.rewrite.model}`;
}

function setPipelineStep(step) {
  $all('.pipeline-step').forEach((item) => {
    item.classList.toggle('active', item.dataset.step === step);
  });
}

function fillForm(settings) {
  $all('#settings-form [name]').forEach((input) => {
    const value = getPath(settings, input.name);
    if (input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else {
      input.value = value ?? '';
    }
  });
}

function readForm() {
  const next = clone(state.settings);
  $all('#settings-form [name]').forEach((input) => {
    const type = fieldTypes.get(input.name) || 'string';
    let value = input.value;
    if (type === 'boolean') value = input.checked;
    if (type === 'number') value = Number(input.value || 0);
    setPath(next, input.name, value);
  });
  next.hotkeys.record.electronAccelerator = String(next.hotkeys.record.electronAccelerator || '').trim() || defaultGlobalAccelerator(next.hotkeys.record.key);
  next.hotkeys.record.label = hotkeyLabel(next.hotkeys.record.key);
  next.models.rewrite.temperature = Number(next.models.rewrite.temperature || 0.2);
  if (!Number.isFinite(next.models.rewrite.temperature)) {
    next.models.rewrite.temperature = 0.2;
  }
  return next;
}

function setRecordVisual(recording, label, hint) {
  state.isRecording = recording;
  $('#pulse-stage').classList.toggle('recording', recording);
  $('#record-state').textContent = label;
  $('#record-hint').textContent = hint;
  $('#record-button').textContent = recording ? '停止并识别' : '开始录音';
}

function isHotkeyCaptureActive() {
  return Boolean(state.hotkeyCapture.mode);
}

function captureButtonSelector(mode) {
  return mode === HOTKEY_CAPTURE_MODES.recordKey ? '#capture-record-key' : '#capture-global-hotkey';
}

function captureStatusSelector(mode) {
  return mode === HOTKEY_CAPTURE_MODES.recordKey ? '#capture-record-key-state' : '#capture-global-hotkey-state';
}

function captureIdleLabel(mode) {
  return mode === HOTKEY_CAPTURE_MODES.recordKey
    ? '按一下键，自动设置录音键'
    : '按组合键，自动设置全局热键';
}

function captureActiveLabel(mode) {
  return mode === HOTKEY_CAPTURE_MODES.recordKey
    ? '请按目标录音键（Esc取消）'
    : '请按组合键（Esc取消）';
}

function capturePrompt(mode) {
  return mode === HOTKEY_CAPTURE_MODES.recordKey
    ? '请按目标录音键（Esc取消）。'
    : '请按组合键（Esc取消），至少包含一个修饰键。';
}

function setCaptureStatus(mode, text, error = false) {
  const status = $(captureStatusSelector(mode));
  if (!status) return;
  status.textContent = text;
  status.classList.remove('success', 'warning');
  status.classList.toggle('error', error);
}

function refreshCaptureButtons() {
  const mode = state.hotkeyCapture.mode;
  [HOTKEY_CAPTURE_MODES.recordKey, HOTKEY_CAPTURE_MODES.globalAccelerator].forEach((item) => {
    const button = $(captureButtonSelector(item));
    if (!button) return;
    const active = mode === item;
    button.classList.toggle('capturing', active);
    button.textContent = active ? captureActiveLabel(item) : captureIdleLabel(item);
  });
}

function startHotkeyCapture(mode) {
  if (state.hotkeyCapture.mode === mode) return;
  state.hotkeyCapture.mode = mode;
  refreshCaptureButtons();
  setCaptureStatus(mode, capturePrompt(mode));
}

function stopHotkeyCapture(message, error = false, mode = state.hotkeyCapture.mode) {
  if (!mode) return;
  state.hotkeyCapture.mode = null;
  refreshCaptureButtons();
  setCaptureStatus(mode, message, error);
}

function setGlobalHotkeyValidation(status, text) {
  const element = $('#capture-global-hotkey-state');
  if (!element) return;
  element.textContent = text;
  element.classList.remove('success', 'warning', 'error');
  if (status === 'success' || status === 'warning' || status === 'error') {
    element.classList.add(status);
  }
}

async function validateGlobalHotkeyValue(accelerator, options = {}) {
  const showChecking = options.showChecking !== false;
  const value = String(accelerator || '').trim();
  if (!value) {
    const result = {
      ok: false,
      available: false,
      validFormat: false,
      reason: 'empty',
      message: '请输入全局热键组合。'
    };
    setGlobalHotkeyValidation('warning', result.message);
    return result;
  }

  const requestId = ++state.hotkeyValidation.requestId;
  if (showChecking) {
    setGlobalHotkeyValidation('checking', `正在检查 ${value} 是否可注册...`);
  }

  try {
    const result = await window.vibing.validateGlobalHotkey(value);
    if (requestId !== state.hotkeyValidation.requestId) return null;

    if (!result?.validFormat) {
      setGlobalHotkeyValidation('error', result?.message || '热键格式无效。');
      return result;
    }

    if (!result.available) {
      setGlobalHotkeyValidation('warning', result.message || '该组合键不可用，请更换。');
      return result;
    }

    setGlobalHotkeyValidation('success', result.message || '该组合键可注册。');
    return result;
  } catch (error) {
    if (requestId !== state.hotkeyValidation.requestId) return null;
    const result = {
      ok: false,
      available: false,
      validFormat: false,
      reason: 'validation-error',
      message: `校验失败：${error.message}`
    };
    setGlobalHotkeyValidation('error', result.message);
    return result;
  }
}

function queueGlobalHotkeyValidation(accelerator) {
  if (state.hotkeyValidation.timer) {
    clearTimeout(state.hotkeyValidation.timer);
  }
  setGlobalHotkeyValidation('checking', '正在检查全局热键...');
  state.hotkeyValidation.timer = setTimeout(() => {
    state.hotkeyValidation.timer = null;
    void validateGlobalHotkeyValue(accelerator, { showChecking: false });
  }, 240);
}

function buildAcceleratorFromEvent(event) {
  const modifierCodes = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);
  const keyMap = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Escape: 'Esc',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`'
  };

  if (modifierCodes.has(event.code)) {
    return { accelerator: null, error: '请在修饰键之外再按一个普通键。' };
  }

  const modifiers = [];
  if (event.metaKey) modifiers.push('Command');
  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');

  if (modifiers.length === 0) {
    return { accelerator: null, error: '全局热键请至少包含一个修饰键（Command/Ctrl/Alt/Shift）。' };
  }

  let key = null;
  if (/^Key[A-Z]$/.test(event.code)) {
    key = event.code.replace('Key', '');
  } else if (/^Digit[0-9]$/.test(event.code)) {
    key = event.code.replace('Digit', '');
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) {
    key = event.code;
  } else if (keyMap[event.code]) {
    key = keyMap[event.code];
  }

  if (!key) {
    return { accelerator: null, error: `暂不支持 ${event.key || event.code} 作为全局热键主键。` };
  }

  return { accelerator: [...new Set(modifiers), key].join('+'), error: null };
}

function applyCapturedRecordKey(nextKey) {
  const previousKey = state.settings.hotkeys.record.key;
  const previousAccelerator = String(state.settings.hotkeys.record.electronAccelerator || '').trim();
  const previousDefaultAccelerator = defaultGlobalAccelerator(previousKey);

  state.settings.hotkeys.record.key = nextKey;
  state.settings.hotkeys.record.label = hotkeyLabel(nextKey);

  if (!previousAccelerator || previousAccelerator === previousDefaultAccelerator) {
    state.settings.hotkeys.record.electronAccelerator = defaultGlobalAccelerator(nextKey);
  }

  fillForm(state.settings);
  updateRoutes();
  stopHotkeyCapture(`已设置录音键为 ${hotkeyLabel(nextKey)}。点击“保存设置”后生效。`, false, HOTKEY_CAPTURE_MODES.recordKey);
  void validateGlobalHotkeyValue(state.settings.hotkeys.record.electronAccelerator);
}

function applyCapturedGlobalAccelerator(accelerator) {
  state.settings.hotkeys.record.electronAccelerator = accelerator;
  fillForm(state.settings);
  updateRoutes();
  stopHotkeyCapture(`已设置全局热键为 ${accelerator}。点击“保存设置”后生效。`, false, HOTKEY_CAPTURE_MODES.globalAccelerator);
  void validateGlobalHotkeyValue(accelerator);
}

async function startRecording(targetApp = null) {
  if (state.isRecording) return;
  state.audioChunks = [];
  state.startedAt = Date.now();
  state.deliveryTargetApp = targetApp || null;
  setPipelineStep('capture');

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.mediaRecorder = new MediaRecorder(state.stream);
    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.audioChunks.push(event.data);
      }
    };
    state.mediaRecorder.onstop = finishRecording;
    state.mediaRecorder.start();
    const recordKeyLabel = hotkeyLabel(state.settings?.hotkeys?.record?.key);
    setRecordVisual(true, '正在录音', `说完后松开 ${recordKeyLabel}，或点击停止并识别`);
  } catch (error) {
    state.deliveryTargetApp = null;
    setRecordVisual(false, '麦克风不可用', '请授予麦克风权限，或先用演示流程检查界面');
    $('#copy-state').textContent = error.message;
  }
}

function stopRecording() {
  if (!state.isRecording) return;
  setRecordVisual(false, '正在识别', '先显示识别原文，再交给后台模型整理');
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  } else {
    finishRecording();
  }
}

function cancelRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.onstop = null;
    state.mediaRecorder.stop();
  }
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  state.deliveryTargetApp = null;
  const recordKeyLabel = hotkeyLabel(state.settings?.hotkeys?.record?.key);
  setRecordVisual(false, '已取消', `按住 ${recordKeyLabel} 可重新开始`);
  setPipelineStep('capture');
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

async function finishRecording() {
  const durationMs = Date.now() - state.startedAt;
  const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
  const targetApp = state.deliveryTargetApp;
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }

  setPipelineStep('asr');
  $('#copy-state').textContent = '正在识别原文...';
  const audioBase64 = blob.size ? await blobToBase64(blob) : '';

  const transcription = await window.vibing.transcribeAudio({
    audioBase64,
    durationMs,
    settings: state.settings
  });

  $('#raw-output').value = transcription.rawTranscript;
  $('#copy-state').textContent = '原文已生成，后台正在整理...';
  setPipelineStep('rerank');

  const rewrite = await window.vibing.rewriteText({
    rawTranscript: transcription.rawTranscript,
    settings: state.settings
  });

  setPipelineStep('rewrite');
  $('#final-output').value = rewrite.finalText;
  $('#copy-state').textContent = '整理完成，正在自动粘贴...';
  setPipelineStep('deliver');

  const delivery = await window.vibing.deliverText({
    text: rewrite.finalText,
    settings: state.settings,
    targetApp
  });

  if (delivery.pasted) {
    $('#copy-state').textContent = '已自动粘贴到当前输入位置';
  } else if (delivery.copied) {
    $('#copy-state').textContent = delivery.error ? `已复制，自动粘贴需要权限：${delivery.error}` : '已复制到剪贴板';
  } else {
    $('#copy-state').textContent = '已生成，自动复制已关闭';
  }
  state.deliveryTargetApp = null;
  setRecordVisual(false, '处理完成', '可继续下一段，或隐藏到后台使用全局热键');
}

function bindNavigation() {
  $all('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      $all('.nav-item').forEach((item) => item.classList.remove('active'));
      $all('.view-panel').forEach((panel) => panel.classList.remove('active'));
      button.classList.add('active');
      $(`#view-${button.dataset.view}`).classList.add('active');
    });
  });
}

function bindHotkeys() {
  document.addEventListener('keydown', (event) => {
    if (isHotkeyCaptureActive()) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const mode = state.hotkeyCapture.mode;

      if (event.key === 'Escape') {
        stopHotkeyCapture('已取消按键捕获。', false, mode);
        return;
      }

      if (mode === HOTKEY_CAPTURE_MODES.recordKey) {
        const nextKey = event.code;
        if (!SUPPORTED_RECORD_KEYS.has(nextKey)) {
          setCaptureStatus(mode, `不支持 ${event.key || nextKey}。请按 Ctrl / Option / Space。`, true);
          return;
        }

        applyCapturedRecordKey(nextKey);
        return;
      }

      if (mode === HOTKEY_CAPTURE_MODES.globalAccelerator) {
        const { accelerator, error } = buildAcceleratorFromEvent(event);
        if (!accelerator) {
          setCaptureStatus(mode, error, true);
          return;
        }

        applyCapturedGlobalAccelerator(accelerator);
        return;
      }

      return;
    }

    const recordKey = state.settings?.hotkeys.record.key;
    if (!recordKey || event.code !== recordKey || event.repeat) return;
    const target = event.target;
    if (target.matches && target.matches('input, textarea, select')) return;
    event.preventDefault();
    if (state.settings.hotkeys.record.mode === 'toggle' && state.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  document.addEventListener('keyup', (event) => {
    const recordKey = state.settings?.hotkeys.record.key;
    if (!recordKey || event.code !== recordKey) return;
    if (state.settings.hotkeys.record.mode === 'hold') {
      event.preventDefault();
      stopRecording();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (isHotkeyCaptureActive()) return;
    if (event.key === 'Escape') {
      cancelRecording();
    }
  });

  window.vibing.onRecordHotkey((payload) => {
    if (isHotkeyCaptureActive()) return;
    if (state.isRecording) {
      stopRecording();
    } else {
      startRecording(payload?.frontmostApp || null);
    }
  });
}

function bindActions() {
  $('#record-button').addEventListener('click', () => {
    if (state.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
  $('#cancel-button').addEventListener('click', cancelRecording);
  $('#copy-button').addEventListener('click', async () => {
    await window.vibing.copyText($('#final-output').value);
    $('#copy-state').textContent = '已复制到剪贴板';
  });
  $('#hide-button').addEventListener('click', async () => {
    await window.vibing.hideWindow();
  });
  const globalHotkeyInput = $('input[name="hotkeys.record.electronAccelerator"]');
  globalHotkeyInput.addEventListener('input', (event) => {
    queueGlobalHotkeyValidation(event.target.value);
  });
  globalHotkeyInput.addEventListener('blur', (event) => {
    void validateGlobalHotkeyValue(event.target.value);
  });
  $('#save-settings').addEventListener('click', async () => {
    const draft = readForm();
    const validation = await validateGlobalHotkeyValue(draft.hotkeys.record.electronAccelerator);
    if (!validation || !validation.validFormat || !validation.available) {
      $('#copy-state').textContent = '全局热键不可注册，已阻止保存，请更换后重试';
      return;
    }

    state.settings = await window.vibing.saveSettings(draft);
    fillForm(state.settings);
    updateRoutes();
    void validateGlobalHotkeyValue(state.settings.hotkeys.record.electronAccelerator, { showChecking: false });
    $('#copy-state').textContent = '设置已保存';
  });
  $('#capture-record-key').addEventListener('click', () => {
    if (state.hotkeyCapture.mode === HOTKEY_CAPTURE_MODES.recordKey) {
      stopHotkeyCapture('已取消按键捕获。', false, HOTKEY_CAPTURE_MODES.recordKey);
      return;
    }
    startHotkeyCapture(HOTKEY_CAPTURE_MODES.recordKey);
  });
  $('#capture-global-hotkey').addEventListener('click', () => {
    if (state.hotkeyCapture.mode === HOTKEY_CAPTURE_MODES.globalAccelerator) {
      stopHotkeyCapture('已取消组合键捕获。', false, HOTKEY_CAPTURE_MODES.globalAccelerator);
      return;
    }
    startHotkeyCapture(HOTKEY_CAPTURE_MODES.globalAccelerator);
  });
}

async function init() {
  state.settings = await window.vibing.loadSettings();
  fillForm(state.settings);
  updateRoutes();
  setGlobalHotkeyValidation('checking', '正在检查当前全局热键...');
  bindNavigation();
  bindActions();
  bindHotkeys();
  void validateGlobalHotkeyValue(state.settings.hotkeys.record.electronAccelerator, { showChecking: false });
  await window.vibing.markRendererReady();
}

init();