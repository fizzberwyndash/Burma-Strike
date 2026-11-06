export type GraphicsQuality = 'low' | 'medium' | 'high';
export interface GraphicsPreferences {
  graphics: 'auto' | GraphicsQuality;
  targetFps: 30 | 60;
  adaptiveResolution: boolean;
}
interface ResolutionEngine { setHardwareScalingLevel(value: number): void; }
export function resolveGraphicsQuality(setting: GraphicsPreferences['graphics'], coarse: boolean): GraphicsQuality {
  return setting === 'auto' ? coarse ? 'medium' : 'high' : setting;
}

/** Rendering budget only: never changes mouse deltas, physics, objective time or cover. */
export class GraphicsController {
  quality: GraphicsQuality = 'high';
  targetFps: 30 | 60 = 60;
  renderScale = 1;
  fps = 0;
  private adaptive = true;
  private initialized = false;
  private minimum = 1;
  private maximum = 1.8;
  private renderBudget = 1;
  private sampleTime = 0;
  private renderedFrames = 0;
  private warmup = 4;
  private healthyWindows = 0;

  constructor(private engine: ResolutionEngine, private coarse: boolean, private pixelRatio = 1) {}

  configure(preferences: GraphicsPreferences): boolean {
    const quality = resolveGraphicsQuality(preferences.graphics, this.coarse);
    const changed = !this.initialized || quality !== this.quality;
    const controlsChanged = changed || this.adaptive !== preferences.adaptiveResolution || this.targetFps !== preferences.targetFps;
    this.quality = quality;
    this.targetFps = preferences.targetFps;
    this.adaptive = preferences.adaptiveResolution;
    if (controlsChanged) {
      const ratio = Number.isFinite(this.pixelRatio) ? Math.max(1, Math.min(1.5, this.pixelRatio)) : 1;
      this.minimum = quality === 'high' ? 1 / ratio : quality === 'medium' ? 1.15 : 1.5;
      this.maximum = quality === 'high' ? 1.6 : quality === 'medium' ? 2 : 2.5;
      this.setScale(this.minimum);
      this.sampleTime = 0; this.renderedFrames = 0; this.warmup = 4; this.healthyWindows = 0;
      this.renderBudget = 1;
    }
    this.initialized = true;
    return changed;
  }

  /** Called every engine tick. A 30 FPS selection skips rendering, never simulation ticks. */
  shouldRender(dt: number): boolean {
    if (!Number.isFinite(dt) || dt < 0) return false;
    this.renderBudget += dt;
    this.sampleTime += dt;
    this.warmup = Math.max(0, this.warmup - dt);
    const interval = 1 / this.targetFps;
    const render = this.renderBudget + 1e-6 >= interval;
    if (render) {
      const intervals = Math.max(1, Math.floor((this.renderBudget + 1e-6) / interval));
      this.renderBudget = Math.max(0, this.renderBudget - intervals * interval);
      this.renderedFrames++;
    }
    if (this.sampleTime >= 2) {
      this.fps = Math.round(this.renderedFrames / this.sampleTime);
      if (this.adaptive && this.warmup === 0) {
        if (this.fps < this.targetFps * .82) {
          this.healthyWindows = 0;
          this.setScale(Math.min(this.maximum, this.renderScale * 1.12));
        } else if (this.fps >= this.targetFps * .96) {
          this.healthyWindows++;
          if (this.healthyWindows >= 3) {
            this.setScale(Math.max(this.minimum, this.renderScale / 1.06));
            this.healthyWindows = 0;
          }
        } else this.healthyWindows = 0;
      }
      this.sampleTime = 0; this.renderedFrames = 0;
    }
    return render;
  }
  private setScale(value: number) {
    if (this.initialized && Math.abs(value - this.renderScale) < .001) return;
    this.renderScale = Math.round(value * 1000) / 1000;
    this.engine.setHardwareScalingLevel(this.renderScale);
  }
}
