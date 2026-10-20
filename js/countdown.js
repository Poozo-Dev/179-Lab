// countdown.js — optional countdown before recording. The state machine is pure (timers are injected so it
// can be unit-tested); the beeps use the Web Audio API and are generated on the phone.
//
// idle --start(n)--> counting --(n s)--> done          (onGo: recording starts here)
//                       |  └ at n-1 s: onWarn (warning beep, if n >= 2)
//                       └--cancel()--> cancelled
// The beeps are scheduled on the audio clock and recording is started by a timer aimed at the same moment.
// They are close (typically within a few tens of ms) but NOT guaranteed to coincide: the countdown is a
// convenience, the frame times always come from the camera timestamps.

export class Countdown {
  constructor({ onTick = () => {}, onWarn = () => {}, onGo = () => {}, onCancel = () => {},
    setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
    Object.assign(this, { onTick, onWarn, onGo, onCancel, setTimer, clearTimer });
    this.state = 'idle'; this.remaining = 0; this.timers = [];
  }

  start(seconds) {
    if (this.state === 'counting') return false;
    if (!(seconds >= 1)) throw new RangeError('countdown must be at least 1 s');
    this.state = 'counting'; this.remaining = seconds;
    this.onTick(seconds);
    for (let s = 1; s <= seconds; s++) {
      this.timers.push(this.setTimer(() => {
        if (this.state !== 'counting') return;
        this.remaining = seconds - s;
        if (this.remaining === 0) { this.state = 'done'; this.timers = []; this.onGo(); }
        else { this.onTick(this.remaining); if (this.remaining === 1) this.onWarn(); }
      }, s * 1000));
    }
    return true;
  }

  cancel() {
    if (this.state !== 'counting') return false;
    for (const t of this.timers) this.clearTimer(t);
    this.timers = []; this.state = 'cancelled'; this.remaining = 0;
    this.onCancel();
    return true;
  }
}

// ---------------- beeps ----------------
let actx = null;
/** Must be called from a tap (mobile browsers only allow audio after a user gesture). */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!actx) actx = new AC();
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  } catch (_) { return null; }
}
/** Schedule a beep `delayS` seconds from now on the audio clock. Returns a cancel function. */
export function beep(delayS, { freq = 880, dur = 0.12, gain = 0.4 } = {}) {
  const ctx = actx; if (!ctx) return () => {};
  try {
    const t = ctx.currentTime + Math.max(0, delayS);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.setValueAtTime(gain, t + dur - 0.02); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.01);
    return () => { try { o.stop(); } catch (_) {} };
  } catch (_) { return () => {}; }
}
