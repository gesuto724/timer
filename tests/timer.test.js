import test from 'node:test';
import assert from 'node:assert/strict';
import { Timer, DEFAULTS, normalizeSettings, formatTime } from '../dist/timer-core.js';
import { AlarmAudio, makeAlarmBuffer } from '../dist/audio.js';

function setup(patch = {}) {
  let now = 100000;
  const timer = new Timer({ ...DEFAULTS, ...patch }, () => now);
  return { timer, advance: ms => { now += ms; } };
}
test('requested example: add at seven seconds gives twelve, continuing immediately', () => {
  const { timer, advance } = setup();
  timer.start(); advance(3000);
  assert.equal(timer.remaining(), 7000);
  timer.refill();
  assert.equal(timer.remaining(), 12000);
  assert.equal(timer.state, 'running');
  advance(1234);
  assert.equal(timer.remaining(), 10766);
});
test('requested example: reset at seven seconds gives ten, continuing immediately', () => {
  const { timer, advance } = setup({ mode: 'reset' });
  timer.start(); advance(3000); timer.refill();
  assert.equal(timer.remaining(), 10000);
  advance(1234);
  assert.equal(timer.remaining(), 8766);
});
test('fast repeated additions keep the elapsed milliseconds', () => {
  const { timer, advance } = setup();
  timer.start();
  for (let i = 0; i < 100; i++) { advance(13); timer.refill(); }
  assert.equal(timer.remaining(), 10000 + 100 * 5000 - 1300);
});
test('changing modes leaves the deadline intact; reset can reduce the remaining time', () => {
  const { timer, advance } = setup();
  timer.start(); timer.refill(); advance(700);
  timer.configure({ ...timer.settings, mode: 'reset' });
  assert.equal(timer.remaining(), 14300);
  timer.refill();
  assert.equal(timer.remaining(), 10000);
  assert.equal(timer.state, 'running');
});
test('pause keeps exact remaining time; both modes resume on refill', () => {
  for (const mode of ['add', 'reset']) {
    const { timer, advance } = setup({ mode });
    timer.start(); advance(3000); timer.pause(); advance(60000);
    assert.equal(timer.remaining(), 7000);
    timer.refill();
    assert.equal(timer.remaining(), mode === 'add' ? 12000 : 10000);
    advance(1000);
    assert.equal(timer.remaining(), mode === 'add' ? 11000 : 9000);
  }
});
test('pause and resume never restart from the initial time', () => {
  const { timer, advance } = setup();
  timer.start(); advance(1234); timer.pause(); advance(9000); timer.start();
  assert.equal(timer.remaining(), 8766);
  advance(8765); assert.equal(timer.tick(), false);
  advance(1); assert.equal(timer.tick(), true);
});
test('zero fires exactly once and delayed callbacks cannot make the timer negative', () => {
  const { timer, advance } = setup();
  timer.start(); advance(9999);
  assert.equal(timer.tick(), false);
  assert.equal(formatTime(timer.remaining()), '00:01');
  advance(1); assert.equal(timer.tick(), true);
  assert.equal(timer.remaining(), 0);
  assert.equal(timer.state, 'ended');
  advance(100000); assert.equal(timer.tick(), false);
  assert.equal(timer.remaining(), 0);
});
test('a delayed background callback catches up with the actual elapsed time', () => {
  const { timer, advance } = setup({ initialSec: 120 });
  timer.start(); advance(91000);
  assert.equal(timer.remaining(), 29000);
  assert.equal(timer.tick(), false);
  advance(100000);
  assert.equal(timer.tick(), true);
});
test('refill after expiration works even if the display tick has not run yet', () => {
  const { timer, advance } = setup();
  timer.start(); advance(15000); timer.refill();
  assert.equal(timer.remaining(), 5000);
  assert.equal(timer.state, 'running');
});
test('settings changes apply to the next refill without changing a running countdown', () => {
  const { timer, advance } = setup();
  timer.start(); advance(3000);
  timer.configure({ ...timer.settings, initialSec: 60, addSec: 20 });
  assert.equal(timer.remaining(), 7000);
  timer.refill(); assert.equal(timer.remaining(), 27000);
  timer.stop(); assert.equal(timer.remaining(), 60000);
  assert.equal(timer.state, 'ready');
});
test('invalid stored settings fall back safely; integer seconds up to 24 hours work', () => {
  const bad = normalizeSettings({ initialSec: -4, addSec: 1.2, volume: 500, alarmDuration: 22 });
  assert.equal(bad.initialSec, 10); assert.equal(bad.addSec, 5);
  assert.equal(bad.volume, 70); assert.equal(bad.alarmDuration, 0);
  const { timer } = setup({ initialSec: 86400, addSec: 86400 });
  timer.refill(); assert.equal(formatTime(timer.remaining()), '48:00:00');
});
test('display rounds up until zero, and supports hours', () => {
  assert.equal(formatTime(7001), '00:08');
  assert.equal(formatTime(7000), '00:07');
  assert.equal(formatTime(1), '00:01');
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(-1), '00:00');
  assert.equal(formatTime(3661000), '01:01:01');
});

class FakeContext {
  constructor() { this.sampleRate = 44100; this.currentTime = 100; this.state = 'suspended'; this.destination = {}; this.sources = []; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createBuffer(channels, length, rate) { const data = new Float32Array(length); return { getChannelData: () => data, duration: length / rate }; }
  createBufferSource() {
    const node = { loop: false, connect() {}, disconnect() { this.disconnected = true; }, start(at) { this.startAt = at; }, stop(at) { this.stopAt = at; this.stopped = true; } };
    this.sources.push(node); return node;
  }
  createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
}
test('each alarm tone produces a finite, audible signal with safe sample amplitude', () => {
  const context = new FakeContext();
  const waves = [];
  for (const tone of ['beep', 'bell', 'digital']) {
    const data = makeAlarmBuffer(context, tone).getChannelData(0);
    let energy = 0;
    for (const value of data) { assert.ok(Number.isFinite(value)); assert.ok(Math.abs(value) <= 1); energy += value * value; }
    assert.ok(energy > 10);
    waves.push(energy);
  }
  assert.equal(new Set(waves).size, 3);
});
test('audio unlock, repeat, stop, preview, duration and volume are wired correctly', async () => {
  const audio = new AlarmAudio(() => {}, FakeContext);
  assert.equal(await audio.unlock(), true);
  assert.equal(audio.play(DEFAULTS), true);
  assert.equal(audio.source.loop, true);
  assert.equal(audio.gain.gain.value, .7);
  const previous = audio.source;
  audio.play({ ...DEFAULTS, alarmDuration: 5 });
  assert.equal(previous.stopped, true);
  assert.equal(previous.disconnected, true);
  assert.equal(audio.source.stopAt, 105);
  audio.stop(); assert.equal(audio.source, null);
  audio.play(DEFAULTS, true);
  assert.equal(audio.source.loop, false);
  assert.equal(audio.isPreview, true);
  audio.stop(); assert.equal(audio.isPreview, false);
  assert.equal(audio.play({ ...DEFAULTS, sound: false }), false);
  assert.equal(audio.play({ ...DEFAULTS, volume: 0 }), false);
});
test('a browser without audio does not prevent timer operation', async () => {
  const audio = new AlarmAudio(() => {}, null);
  assert.equal(await audio.unlock(), false);
  assert.equal(audio.play(DEFAULTS), false);
  audio.stop();
});
