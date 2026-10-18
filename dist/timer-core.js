export const DEFAULTS = Object.freeze({
  initialSec: 10, addSec: 5, mode: 'add', sound: true,
  volume: 70, tone: 'beep', alarmDuration: 0, keepAwake: true
});

export function normalizeSettings(raw = {}) {
  const integer = (v, min, max, fallback) =>
    Number.isInteger(v) && v >= min && v <= max ? v : fallback;
  return {
    initialSec: integer(raw.initialSec, 1, 86400, DEFAULTS.initialSec),
    addSec: integer(raw.addSec, 1, 86400, DEFAULTS.addSec),
    mode: raw.mode === 'reset' ? 'reset' : 'add',
    sound: typeof raw.sound === 'boolean' ? raw.sound : DEFAULTS.sound,
    volume: integer(raw.volume, 0, 100, DEFAULTS.volume),
    tone: ['beep', 'bell', 'digital'].includes(raw.tone) ? raw.tone : DEFAULTS.tone,
    alarmDuration: [0, 5, 10, 30, 60].includes(raw.alarmDuration) ? raw.alarmDuration : DEFAULTS.alarmDuration,
    keepAwake: typeof raw.keepAwake === 'boolean' ? raw.keepAwake : DEFAULTS.keepAwake
  };
}

export function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  const pad = value => String(value).padStart(2, '0');
  return hours ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function durationLabel(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const rest = seconds % 60;
  return [hours && `${hours}時間`, minutes && `${minutes}分`, rest && `${rest}秒`].filter(Boolean).join('') || '0秒';
}

// Absolute deadlines prevent delayed browser callbacks from slowing the timer.
// The clock is injected so the exact boundaries can be verified without waiting.
export class Timer {
  constructor(settings = DEFAULTS, now = () => Date.now()) {
    this.now = now;
    this.settings = normalizeSettings(settings);
    this.state = 'ready';
    this.deadline = null;
    this.stored = this.settings.initialSec * 1000;
    this.span = this.stored;
  }
  remaining(at = this.now()) {
    return this.state === 'running' ? Math.max(0, this.deadline - at) : this.stored;
  }
  tick(at = this.now()) {
    if (this.state !== 'running' || this.remaining(at) > 0) return false;
    this.stored = 0;
    this.deadline = null;
    this.state = 'ended';
    return true;
  }
  start(at = this.now()) {
    if (this.state === 'running') return;
    if (this.stored <= 0) this.stored = this.settings.initialSec * 1000;
    this.deadline = at + this.stored;
    this.span = Math.max(this.span, this.stored);
    this.state = 'running';
  }
  pause(at = this.now()) {
    if (this.state !== 'running') return;
    if (this.tick(at)) return;
    this.stored = this.remaining(at);
    this.deadline = null;
    this.state = 'paused';
  }
  refill(at = this.now()) {
    const ms = this.settings.mode === 'reset'
      ? this.settings.initialSec * 1000
      : this.remaining(at) + this.settings.addSec * 1000;
    this.stored = ms;
    this.span = ms;
    this.deadline = at + ms;
    this.state = 'running';
    return ms;
  }
  stop() {
    this.state = 'ready';
    this.deadline = null;
    this.stored = this.settings.initialSec * 1000;
    this.span = this.stored;
  }
  configure(settings) {
    this.settings = normalizeSettings(settings);
    if (this.state === 'ready') this.stop();
  }
}
