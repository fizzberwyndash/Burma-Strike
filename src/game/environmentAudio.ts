/** Original synthesized ambience and foley. No recorded sound assets are used. */
export interface EnvironmentAudioState {
  active: boolean;
  speed: number;
  sprinting: boolean;
  grounded: boolean;
  surface: 'sand' | 'stone' | 'wood';
  position: { x: number; z: number };
}

type VoiceKind = 'step' | 'market' | 'interface';
interface Voice {
  source: AudioScheduledSourceNode;
  gain: GainNode;
  nodes: AudioNode[];
  kind: VoiceKind;
}

const MAX_VOICES = 11; // Leave one source available for the wind loop: 12 in total.

export class EnvironmentAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private readonly voices = new Set<Voice>();
  private enabled = false;
  private active = false;
  private disposed = false;
  private distance = 0;
  private elapsed = 0;
  private nextWindUpdate = 0;
  private marketDelay = 3;
  private alternatingFoot = false;

  private readonly unlock = (event: Event): void => {
    if (!event.isTrusted || !this.enabled || this.disposed) return;
    if (!this.context) {
      const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      try {
        const context = new Audio();
        const master = context.createGain();
        master.gain.value = 0.48;
        master.connect(context.destination);
        this.context = context;
        this.master = master;
        // Reuse this noise for wind, cloth and all footstep transients.
        this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * 3), context.sampleRate);
        const samples = this.noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * 0.55;
      } catch {
        // Browsers without audio support can still run the complete game.
        return;
      }
    }
    const context = this.context;
    if (context.state === 'suspended') {
      // Resume is called here, never from the render/update loop.
      void context.resume().then(() => {
        if (this.enabled && !this.disposed && this.active) this.startWind();
      }).catch(() => undefined);
    } else if (context.state === 'running' && this.active) {
      this.startWind();
    }
  };

  constructor() {
    document.addEventListener('pointerdown', this.unlock, { passive: true });
    document.addEventListener('keydown', this.unlock);
  }

  configure(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    this.distance = 0;
    const context = this.context;
    if (!enabled) {
      this.stopWind();
      for (const voice of [...this.voices]) this.stopVoice(voice);
    } else if (context?.state === 'running' && this.active) {
      this.startWind();
    }
  }

  update(dt: number, state: EnvironmentAudioState): void {
    if (this.disposed) return;
    const wasActive = this.active;
    this.active = state.active;
    // Suspend the ambience during menus, pauses and browser visibility pauses.
    if (!state.active) {
      this.distance = 0;
      if (wasActive) {
        this.stopWind();
        for (const voice of [...this.voices]) if (voice.kind !== 'interface') this.stopVoice(voice);
      }
      return;
    }
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running') return;
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    this.elapsed += step;
    this.startWind();
    if (this.windGain && this.elapsed >= this.nextWindUpdate) {
      this.windGain.gain.setTargetAtTime(0.042 + Math.sin(this.elapsed * 0.23) * 0.009, context.currentTime, 0.35);
      this.nextWindUpdate = this.elapsed + 0.15;
    }

    const speed = Number.isFinite(state.speed) ? Math.min(16, Math.max(0, state.speed)) : 0;
    if (state.grounded && speed > 0.3) {
      this.distance += speed * step;
      const stride = state.sprinting ? 2.4 : 2.05;
      if (this.distance >= stride) {
        this.distance %= stride;
        this.footstep(state.surface, state.sprinting);
      }
    } else {
      this.distance = 0;
    }

    this.marketDelay -= step;
    if (this.marketDelay <= 0) {
      this.marketDelay = 4 + Math.random() * 5;
      const distance = Math.hypot(state.position.x + 20, state.position.z);
      const attenuation = Math.max(0, 1 - distance / 42) ** 2;
      if (Number.isFinite(attenuation) && attenuation > 0.025) {
        // An occasional stall creak or cloth flutter, never simulated speech.
        if (Math.random() > 0.45) {
          this.tone(165 + Math.random() * 65, 0.16, 0.026 * attenuation, 'market', 'triangle', 0, 0.62);
          this.noiseBurst(0.08, 0.018 * attenuation, 650, 'lowpass', 'market');
        } else {
          this.noiseBurst(0.65, 0.04 * attenuation, 1250, 'lowpass', 'market', 0.08);
        }
      }
    }
  }

  shop(open: boolean): void {
    if (open) {
      this.tone(440, 0.09, 0.035, 'interface', 'sine');
      this.tone(660, 0.12, 0.028, 'interface', 'sine', 0.065);
    } else {
      this.tone(550, 0.075, 0.027, 'interface', 'sine');
      this.tone(367, 0.1, 0.025, 'interface', 'sine', 0.055);
    }
  }

  roundStart(): void {
    this.distance = 0;
    this.tone(294, 0.14, 0.05, 'interface', 'triangle');
    this.tone(440, 0.16, 0.045, 'interface', 'triangle', 0.12);
    this.tone(587, 0.22, 0.04, 'interface', 'sine', 0.25);
  }

  victory(won: boolean): void {
    const notes = won ? [392, 494, 587, 784] : [349, 294, 220];
    notes.forEach((note, i) => this.tone(note, i === notes.length - 1 ? 0.48 : 0.18, 0.045, 'interface', 'sine', i * 0.16));
  }

  private startWind(): void {
    const context = this.context;
    if (this.wind || !this.enabled || !this.active || !context || context.state !== 'running' || !this.noise || !this.master) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noise;
    source.loop = true;
    filter.type = 'lowpass';
    filter.frequency.value = 670;
    filter.Q.value = 0.3;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.042, context.currentTime + 0.4);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      if (this.wind === source) {
        this.wind = null;
        this.windFilter = null;
        this.windGain = null;
      }
    };
    source.start();
    this.wind = source;
    this.windFilter = filter;
    this.windGain = gain;
  }

  private stopWind(): void {
    const context = this.context;
    const source = this.wind;
    if (!source || !context) return;
    const filter = this.windFilter;
    const gain = this.windGain;
    if (context.state === 'running') {
      // Keep ownership until onended so rapid pause/mute toggles cannot overlap loops.
      if (gain) this.fadeOut(gain.gain, context.currentTime);
      try { source.stop(context.currentTime + 0.012); } catch { /* Already stopped. */ }
    } else {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
      filter?.disconnect();
      gain?.disconnect();
      this.wind = null;
      this.windFilter = null;
      this.windGain = null;
    }
  }

  private footstep(surface: EnvironmentAudioState['surface'], sprinting: boolean): void {
    this.alternatingFoot = !this.alternatingFoot;
    const gain = (sprinting ? 0.095 : 0.065) * (this.alternatingFoot ? 1 : 0.9);
    if (surface === 'wood') {
      this.noiseBurst(0.055, gain * 0.6, 720, 'lowpass', 'step');
      this.tone(this.alternatingFoot ? 122 : 107, 0.075, gain * 0.65, 'step', 'triangle', 0, 0.56);
    } else if (surface === 'stone') {
      this.noiseBurst(0.075, gain * 0.8, 1650, 'highpass', 'step', 0.002);
    } else {
      this.noiseBurst(0.15, gain, 1050, 'lowpass', 'step', 0.012);
    }
  }

  private canPlay(): boolean {
    return this.enabled && !this.disposed && this.context?.state === 'running' && this.master !== null;
  }

  private noiseBurst(duration: number, volume: number, frequency: number, type: BiquadFilterType, kind: VoiceKind, attack = 0.006): void {
    if (!this.canPlay() || !this.noise) return;
    const context = this.context!;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    source.buffer = this.noise;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.45;
    const voice = this.addVoice(source, kind, duration, volume, 0, attack, [filter]);
    source.connect(filter);
    filter.connect(voice.gain);
    source.start(context.currentTime, Math.random() * (this.noise.duration - duration));
    source.stop(context.currentTime + duration + 0.005);
  }

  private tone(frequency: number, duration: number, volume: number, kind: VoiceKind, shape: OscillatorType, delay = 0, endPitch = 1): void {
    if (!this.canPlay()) return;
    const context = this.context!;
    const source = context.createOscillator();
    source.type = shape;
    source.frequency.setValueAtTime(frequency, context.currentTime + delay);
    source.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * endPitch), context.currentTime + delay + duration);
    const voice = this.addVoice(source, kind, duration, volume, delay, 0.008);
    source.connect(voice.gain);
    source.start(context.currentTime + delay);
    source.stop(context.currentTime + delay + duration + 0.005);
  }

  private addVoice(source: AudioScheduledSourceNode, kind: VoiceKind, duration: number, volume: number, delay: number, attack: number, effects: AudioNode[] = []): Voice {
    const context = this.context!;
    // Evict before allocating the new envelope so active sources stay bounded.
    if (this.voices.size >= MAX_VOICES) this.removeVoice(this.voices.values().next().value!);
    const gain = context.createGain();
    const start = context.currentTime + delay;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + Math.min(attack, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    gain.gain.setValueAtTime(0, start + duration + 0.003);
    gain.connect(this.master!);
    const voice = { source, gain, nodes: [source, ...effects, gain], kind };
    source.onended = () => this.removeVoice(voice);
    this.voices.add(voice);
    return voice;
  }

  private fadeOut(parameter: AudioParam, time: number): void {
    if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(time);
    else {
      const value = parameter.value;
      parameter.cancelScheduledValues(time);
      parameter.setValueAtTime(value, time);
    }
    parameter.linearRampToValueAtTime(0, time + 0.008);
  }

  private stopVoice(voice: Voice): void {
    const context = this.context;
    if (context?.state === 'running') {
      this.fadeOut(voice.gain.gain, context.currentTime);
      try { voice.source.stop(context.currentTime + 0.012); } catch { this.removeVoice(voice); }
    } else this.removeVoice(voice);
  }

  private removeVoice(voice: Voice): void {
    voice.source.onended = null;
    try { voice.source.stop(); } catch { /* Ended sources may already be stopped. */ }
    for (const node of voice.nodes) node.disconnect();
    this.voices.delete(voice);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    document.removeEventListener('pointerdown', this.unlock);
    document.removeEventListener('keydown', this.unlock);
    const context = this.context;
    if (this.wind) {
      this.wind.onended = null;
      try { this.wind.stop(); } catch { /* Already stopped. */ }
      this.wind.disconnect();
      this.windFilter?.disconnect();
      this.windGain?.disconnect();
      this.wind = null;
      this.windFilter = null;
      this.windGain = null;
    }
    for (const voice of [...this.voices]) this.removeVoice(voice);
    this.master?.disconnect();
    this.master = null;
    this.noise = null;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }
}
