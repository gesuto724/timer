export function makeAlarmBuffer(context, tone) {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.ceil(rate * 1.4), rate);
  const data = buffer.getChannelData(0);
  const pulses = tone === 'bell' ? [0, 0.38] : [0, 0.24, 0.48];
  for (const start of pulses) {
    const duration = tone === 'bell' ? 0.7 : 0.16;
    const frequency = tone === 'bell' ? 660 : tone === 'digital' ? 1046.5 : 880;
    const offset = Math.floor(start * rate);
    for (let i = 0; i < duration * rate && offset + i < data.length; i++) {
      const t = i / rate;
      const attack = Math.min(1, t / 0.008);
      const release = Math.min(1, (duration - t) / 0.025);
      const envelope = attack * release * (tone === 'bell' ? Math.exp(-t * 7) : 1);
      let wave = Math.sin(2 * Math.PI * frequency * t);
      if (tone === 'bell') wave += 0.35 * Math.sin(2 * Math.PI * frequency * 2.76 * t);
      if (tone === 'digital') wave += 0.2 * Math.sin(2 * Math.PI * frequency * 3 * t);
      data[offset + i] += 0.35 * wave * envelope;
    }
  }
  return buffer;
}

export class AlarmAudio {
  constructor(onChange = () => {}, AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext) {
    this.Context = AudioContextClass;
    this.context = null;
    this.source = null;
    this.gain = null;
    this.onChange = onChange;
  }
  get ready() { return this.context?.state === 'running'; }
  // Called synchronously in a tap handler, before any asynchronous work.
  unlock() {
    if (!this.Context) return Promise.resolve(false);
    try {
      if (!this.context || this.context.state === 'closed') {
        this.context = new this.Context();
        this.context.onstatechange = () => this.onChange();
      }
      const result = this.context.resume();
      const silent = this.context.createBufferSource();
      silent.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
      silent.connect(this.context.destination);
      silent.onended = () => silent.disconnect();
      silent.start(0);
      return Promise.resolve(result).then(() => { this.onChange(); return this.ready; }, () => false);
    } catch { return Promise.resolve(false); }
  }
  play(settings, preview = false) {
    this.stop();
    if (!this.ready || (!preview && !settings.sound) || settings.volume === 0) return false;
    try {
      const context = this.context;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = makeAlarmBuffer(context, settings.tone);
      source.loop = !preview;
      gain.gain.value = settings.volume / 100;
      source.connect(gain);
      gain.connect(context.destination);
      this.source = source;
      this.gain = gain;
      this.isPreview = preview;
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (this.source === source) { this.source = null; this.gain = null; this.isPreview = false; }
      };
      source.start(context.currentTime);
      if (!preview && settings.alarmDuration > 0) source.stop(context.currentTime + settings.alarmDuration);
      return true;
    } catch { this.stop(); return false; }
  }
  stop() {
    const source = this.source;
    const gain = this.gain;
    this.source = null;
    this.gain = null;
    this.isPreview = false;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    }
    if (gain) { try { gain.disconnect(); } catch {} }
  }
}
