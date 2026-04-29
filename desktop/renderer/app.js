const state = {
  settings: null,
  isRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  startedAt: 0,
  stream: null
};

const fieldTypes = new Map([
  ['models.localRerank.topK', 'number'],
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
  if (key === 'AltRight') return 'Right Option';
  if (key === 'AltLeft') return 'Left Option';
  return key;
}

function updateRoutes() {
  const settings = state.settings;
  $('#hotkey-label').textContent = hotkeyLabel(settings.hotkeys.record.key);
  $('#global-hotkey-label').textContent = settings.hotkeys.record.electronAccelerator || '未设置';
  $('#runtime-mode').textContent = settings.speechRecognition.runtimeMode === 'local' ? 'Local ASR' : 'Demo mode';
  $('#asr-route').textContent = `${settings.speechRecognition.local.scheme} / ${settings.speechRecognition.language}`;
  $('#rerank-route').textContent = settings.models.localRerank.enabled
    ? settings.models.localRerank.model
    : settings.models.cloudRerank.enabled
      ? settings.models.cloudRerank.model
      : 'rerank disabled';
  $('#rewrite-route').textContent = settings.models.rewrite.model;
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
  next.hotkeys.record.label = hotkeyLabel(next.hotkeys.record.key);
  return next;
}

function setRecordVisual(recording, label, hint) {
  state.isRecording = recording;
  $('#pulse-stage').classList.toggle('recording', recording);
  $('#record-state').textContent = label;
  $('#record-hint').textContent = hint;
  $('#record-button').textContent = recording ? '停止并识别' : '开始录音';
}

async function startRecording() {
  if (state.isRecording) return;
  state.audioChunks = [];
  state.startedAt = Date.now();
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
    setRecordVisual(true, '正在录音', '说完后松开 Right Option，或点击停止并识别');
  } catch (error) {
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
  setRecordVisual(false, '已取消', '按住 Right Option 可重新开始');
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
    settings: state.settings
  });

  if (delivery.pasted) {
    $('#copy-state').textContent = '已自动粘贴到当前输入位置';
  } else if (delivery.copied) {
    $('#copy-state').textContent = delivery.error ? `已复制，自动粘贴需要权限：${delivery.error}` : '已复制到剪贴板';
  } else {
    $('#copy-state').textContent = '已生成，自动复制已关闭';
  }
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
    if (event.key === 'Escape') {
      cancelRecording();
    }
  });

  window.vibing.onRecordHotkey(() => {
    if (state.isRecording) {
      stopRecording();
    } else {
      startRecording();
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
  $('#save-settings').addEventListener('click', async () => {
    state.settings = await window.vibing.saveSettings(readForm());
    fillForm(state.settings);
    updateRoutes();
    $('#copy-state').textContent = '设置已保存';
  });
}

async function init() {
  state.settings = await window.vibing.loadSettings();
  fillForm(state.settings);
  updateRoutes();
  bindNavigation();
  bindActions();
  bindHotkeys();
}

init();