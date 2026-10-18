import { Timer, DEFAULTS, normalizeSettings, formatTime, durationLabel } from './timer-core.js';
import { AlarmAudio } from './audio.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'tap-time.settings.v1';
let settings;
try { settings = normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}); }
catch { settings = { ...DEFAULTS }; }
const timer = new Timer(settings);
let alarmActive = false;
let alarmUntil = 0;
let alarmTimeout;
let toastTimeout;
let wakeLock = null;
let wakePending = false;
let wakeFailed = false;
let lastOpener = null;
const audio = new AlarmAudio(updateAudioStatus);

function setText(id, text) {
  const element = $(id);
  if (element.textContent !== text) element.textContent = text;
}
function announce(message) { setText('announcer', message); }
function toast(message) {
  clearTimeout(toastTimeout);
  setText('toast', message);
  $('toast').classList.add('show');
  toastTimeout = setTimeout(() => $('toast').classList.remove('show'), 2000);
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); return true; }
  catch { return false; }
}
function updateAudioStatus() {
  const muted = !settings.sound || settings.volume === 0;
  setText('soundSummary', muted ? 'アラーム OFF' : 'アラーム ON');
  setText('audioStatus', muted ? '終了は画面でお知らせします' : audio.ready ? '音の準備OK・端末の音量もご確認ください' : '最初に「音を試す」で確認できます');
}
function unlockAudio() {
  // Resume is invoked in the original click event for Safari's audio policy.
  const pending = audio.unlock();
  pending.then(ok => {
    updateAudioStatus();
    if (ok && alarmActive && !audio.source && Date.now() < alarmUntil) {
      const remaining = Number.isFinite(alarmUntil) ? Math.max(0.01, (alarmUntil - Date.now()) / 1000) : 0;
      audio.play({ ...settings, alarmDuration: remaining });
    }
  });
  return pending;
}
function needsWakeLock() {
  return settings.keepAwake && (timer.state === 'running' || alarmActive) && document.visibilityState === 'visible';
}
function updateWakeStatus() {
  const supported = 'wakeLock' in navigator;
  let text = '実行中は画面をオンに保ちます';
  if (!settings.keepAwake) text = '画面の自動ロック防止 OFF';
  else if (!supported) text = 'このブラウザは画面の自動ロック防止に未対応';
  else if (wakeLock && !wakeLock.released) text = '画面をオンに維持しています';
  else if (wakeFailed) text = '画面の維持ができません・自動ロックにご注意ください';
  setText('wakeStatus', text);
  $('wakeIndicator').classList.toggle('active', !!wakeLock && !wakeLock.released);
}
async function syncWakeLock() {
  if (!needsWakeLock()) {
    const previous = wakeLock;
    wakeLock = null;
    if (previous) { try { await previous.release(); } catch {} }
    updateWakeStatus();
    return;
  }
  if (!('wakeLock' in navigator) || wakePending || (wakeLock && !wakeLock.released)) {
    updateWakeStatus(); return;
  }
  wakePending = true;
  try {
    const requested = await navigator.wakeLock.request('screen');
    if (!needsWakeLock()) await requested.release();
    else {
      wakeLock = requested;
      wakeFailed = false;
      requested.addEventListener('release', () => {
        if (wakeLock === requested) { wakeLock = null; wakeFailed = needsWakeLock(); }
        updateWakeStatus();
      });
    }
  } catch { wakeFailed = true; }
  finally { wakePending = false; updateWakeStatus(); }
}

function clearAlarm() {
  clearTimeout(alarmTimeout);
  alarmActive = false;
  alarmUntil = 0;
  audio.stop();
}
function finish() {
  clearTimeout(alarmTimeout);
  alarmActive = true;
  alarmUntil = settings.alarmDuration ? Date.now() + settings.alarmDuration * 1000 : Infinity;
  const played = audio.play(settings);
  if (settings.alarmDuration) {
    alarmTimeout = setTimeout(() => {
      clearAlarm();
      render();
      syncWakeLock();
    }, settings.alarmDuration * 1000);
  }
  announce('時間になりました。残り0秒です。');
  if (settings.sound && settings.volume > 0 && !played) toast('時間です。音を出すには「音を試す」をタップ');
  syncWakeLock();
}
function render() {
  const ms = timer.remaining();
  const display = formatTime(ms);
  setText('timeDisplay', display);
  $('timeDisplay').setAttribute('aria-label', `残り${durationLabel(Math.ceil(ms / 1000))}`);
  $('timeDisplay').classList.toggle('long', display.length > 5);
  const state = timer.state;
  $('timerFace').dataset.state = state;
  $('timerFace').dataset.urgent = state === 'running' && ms <= 3000 ? 'true' : 'false';
  $('ringProgress').style.strokeDashoffset = String(100 * (1 - Math.min(1, ms / timer.span)));
  setText('statusLabel', { ready: '開始待ち', running: 'カウントダウン中', paused: '一時停止中', ended: 'タイムアップ' }[state]);
  setText('timeLabel', state === 'ended' ? 'TIME UP' : '残り時間');
  setText('dialCaption', {
    ready: '準備ができたらスタート', running: '自分のペースで、もう少し。',
    paused: '補充ボタンでも再開できます', ended: '補充ボタンで、また続けられます'
  }[state]);
  setText('startLabel', state === 'running' ? '一時停止' : state === 'paused' ? '再開' : state === 'ended' ? '最初から開始' : 'スタート');
  $('startIcon').setAttribute('href', state === 'running' ? '#i-pause' : '#i-play');
  $('alarmStrip').hidden = !alarmActive;
  $('faceBottom').hidden = alarmActive;
  setText('alarmText', '時間になりました');
  $('silenceBtn').querySelector('span').textContent = settings.sound && settings.volume > 0 ? 'アラーム停止' : '確認';
  document.title = state === 'ready' ? 'タップタイマー' : `${display} · ${state === 'ended' ? '時間です' : state === 'paused' ? '一時停止' : 'タップタイマー'}`;
}
function renderSettings() {
  const add = settings.mode === 'add';
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === settings.mode)));
  setText('initialSummary', String(settings.initialSec));
  setText('addSummary', String(settings.addSec));
  const amount = durationLabel(add ? settings.addSec : settings.initialSec);
  setText('refillLabel', add ? `${amount}を加算` : `${amount}にリセット`);
  $('refillIcon').setAttribute('href', add ? '#i-plus' : '#i-reset');
  $('refillBtn').setAttribute('aria-label', add ? `残り時間に${amount}を加算してカウントダウンを継続` : `${amount}にリセットしてカウントダウンを継続`);
  setText('currentMode', add ? '残り時間にプラス' : '初期時間に戻す');
  setText('refillHint', add ? `1タップ ＋${amount}` : `1タップ → ${amount}`);
  setText('exampleMode', add ? '加算式の動き' : 'リセット式の動き');
  const before = settings.initialSec === 10 ? 7 : Math.max(1, Math.floor(settings.initialSec * .7));
  setText('exampleBefore', formatTime(before * 1000));
  setText('exampleAfter', formatTime((add ? before + settings.addSec : settings.initialSec) * 1000));
  setText('exampleDescription', add ? `残り時間に${amount}を加えて、そのまま続行。` : `いつ押しても${amount}に戻して、そのまま続行。`);
  updateAudioStatus();
  updateWakeStatus();
}
function refresh() { render(); syncWakeLock(); }

$('startBtn').addEventListener('click', () => {
  if (timer.state === 'running') {
    if (timer.tick()) { finish(); render(); return; }
    timer.pause();
    audio.stop();
    announce('一時停止しました。');
  } else {
    clearAlarm();
    unlockAudio();
    timer.start();
    announce('カウントダウンを開始しました。');
  }
  refresh();
});
$('refillBtn').addEventListener('click', () => {
  clearAlarm();
  unlockAudio();
  timer.refill();
  const message = settings.mode === 'add' ? `＋${durationLabel(settings.addSec)}` : `${durationLabel(settings.initialSec)}にリセット`;
  toast(message);
  announce(`${message}。カウントダウンを続けます。`);
  refresh();
});
$('stopBtn').addEventListener('click', () => {
  clearAlarm();
  timer.stop();
  announce('停止して初期時間に戻しました。');
  refresh();
});
$('silenceBtn').addEventListener('click', () => {
  clearAlarm();
  announce('アラームを停止しました。');
  refresh();
});
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  if (settings.mode === button.dataset.mode) return;
  settings = { ...settings, mode: button.dataset.mode };
  timer.configure(settings);
  persist();
  renderSettings();
  render();
  announce(`${settings.mode === 'add' ? '加算式' : 'リセット式'}に切り替えました。`);
}));

const dialog = $('settingsDialog');
function fillSettings() {
  $('initialSec').value = settings.initialSec;
  $('addSec').value = settings.addSec;
  $('soundEnabled').checked = settings.sound;
  $('alarmTone').value = settings.tone;
  $('volume').value = settings.volume;
  $('alarmDuration').value = settings.alarmDuration;
  $('keepAwake').checked = settings.keepAwake;
  $('formError').hidden = true;
  $('initialSec').removeAttribute('aria-invalid');
  $('addSec').removeAttribute('aria-invalid');
  setText('previewStatus', '端末の音量や消音設定も確認してください。');
  updateDraftLabels();
}
function updateDraftLabels() {
  for (const [input, label] of [['initialSec', 'initialFormatted'], ['addSec', 'addFormatted']]) {
    const value = Number($(input).value);
    setText(label, Number.isInteger(value) && value >= 1 && value <= 86400 ? durationLabel(value) : '1〜86,400秒で指定');
  }
  setText('volumeOutput', `${$('volume').value}%`);
}
function closeSettings() {
  if (audio.isPreview) audio.stop();
  dialog.close();
}
document.querySelectorAll('.settings-open').forEach(button => button.addEventListener('click', () => {
  lastOpener = button;
  fillSettings();
  dialog.showModal();
  // Avoid opening the iPhone keyboard unless a time field was explicitly tapped.
  $(button.dataset.focus || 'closeSettings').focus({ preventScroll: true });
}));
$('closeSettings').addEventListener('click', closeSettings);
$('cancelSettings').addEventListener('click', closeSettings);
dialog.addEventListener('close', () => {
  if (audio.isPreview) audio.stop();
  lastOpener?.focus({ preventScroll: true });
});
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeSettings();
});
['initialSec', 'addSec', 'volume'].forEach(id => $(id).addEventListener('input', updateDraftLabels));
$('settingsForm').addEventListener('submit', event => {
  event.preventDefault();
  for (const id of ['initialSec', 'addSec']) {
    const field = $(id);
    const value = Number(field.value);
    const valid = field.value.trim() !== '' && Number.isInteger(value) && value >= 1 && value <= 86400;
    field.setAttribute('aria-invalid', String(!valid));
    if (!valid) {
      setText('formError', `${id === 'initialSec' ? '初期時間' : '加算する時間'}を1〜86,400の整数で入力してください。`);
      $('formError').hidden = false;
      field.focus();
      return;
    }
  }
  settings = normalizeSettings({ ...settings,
    initialSec: Number($('initialSec').value), addSec: Number($('addSec').value),
    sound: $('soundEnabled').checked, tone: $('alarmTone').value,
    volume: Number($('volume').value), alarmDuration: Number($('alarmDuration').value),
    keepAwake: $('keepAwake').checked
  });
  timer.configure(settings);
  const saved = persist();
  if (alarmActive) clearAlarm();
  closeSettings();
  renderSettings();
  refresh();
  toast(saved ? '設定を保存しました' : '設定を適用しました。このブラウザでは保存できません');
});

async function testAudio(useDraft = false) {
  const candidate = useDraft ? { ...settings, volume: Number($('volume').value), tone: $('alarmTone').value } : settings;
  // A tap can also unlock a previously blocked, active alarm.
  const ok = await unlockAudio();
  if (alarmActive) { toast(ok ? 'アラーム音を確認してください' : '音を再生できません。Safariと端末の音量を確認してください'); return; }
  const played = ok && audio.play(candidate, true);
  const message = candidate.volume === 0 ? '音量が0%です。設定で音量を上げてください' : played ? '音を試しています。端末の音量も確認してください' : '音を再生できません。Safariと端末の音量を確認してください';
  if (useDraft) setText('previewStatus', message);
  else toast(message);
}
$('testSound').addEventListener('click', () => testAudio());
$('previewSound').addEventListener('click', () => testAudio(true));
document.addEventListener('keydown', event => {
  if (dialog.open || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest('button,input,select,textarea,a,[contenteditable="true"]')) return;
  if (event.code === 'Space') { event.preventDefault(); $('startBtn').click(); }
  if (event.code === 'Enter') { event.preventDefault(); $('refillBtn').click(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (timer.tick()) finish();
    render();
  }
  syncWakeLock();
});
window.addEventListener('pageshow', () => {
  if (timer.tick()) finish();
  refresh();
});
setInterval(() => {
  if (timer.tick()) finish();
  if (timer.state === 'running' || timer.state === 'ended') render();
}, 50);
renderSettings();
render();
