export interface InputCallbacks {
  onPause: () => void;
  onShoot: () => void;
  onReload: () => void;
  onJump: () => void;
  onSlot?: (slot: number) => void;
  onPrimaryCycle?: () => void;
  onInspect?: () => void;
  onAds?: (active: boolean) => void;
  onShop?: () => void;
  onInteract?: (held: boolean) => void;
  onScoreboard?: (held: boolean) => void;
}

/** Owns desktop events; touch UI feeds its independent pointers into this class. */
export class GameInput {
  public sensitivity = 0.35;
  public touchSensitivity = 1;
  public aimMultiplier = 1;
  public invertY = false;
  public fireHeld = false;
  public adsHeld = false;
  public interactHeld = false;
  public scoreboardHeld = false;
  public sprinting = false;
  /** Shop hotkeys remain available while gameplay input is suspended by its overlay. */
  public shopEnabled = false;
  public lookX = 0;
  public lookY = 0;
  public moveX = 0;
  public moveY = 0;
  public readonly isTouch: boolean;

  private enabled = false;
  private disposed = false;
  private pauseRequested = false;
  private hadPointerLock = false;
  private readonly keys = new Set<string>();
  private joystickX = 0;
  private joystickY = 0;
  private touchSprinting = false;
  private shopVisible = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: InputCallbacks,
  ) {
    // Use the primary pointer: touch-capable laptops still need mouse capture.
    this.isTouch = window.matchMedia('(pointer: coarse)').matches;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  public get active(): boolean {
    return this.enabled;
  }

  public set active(value: boolean) {
    if (this.disposed) return;
    if (value && !this.enabled) this.pauseRequested = false;
    this.enabled = value;
    if (!value) this.clearState();
  }

  public get shopOpen(): boolean {
    return this.shopVisible;
  }

  public set shopOpen(value: boolean) {
    this.shopVisible = value;
    if (value) this.clearState();
  }

  public touchMove(x: number, y: number): void {
    if (!this.active) return;
    this.joystickX = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
    this.joystickY = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0;
  }

  public touchLook(dx: number, dy: number): void {
    if (!this.active || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.accumulateLook(dx, dy, this.touchSensitivity * 0.004);
  }

  /** Independent touch pointers call these without synthesizing mouse events. */
  public touchTrigger(held: boolean): void {
    if (!this.active) return;
    const rising = held && !this.fireHeld;
    this.fireHeld = held;
    if (rising) this.callbacks.onShoot();
  }

  public touchAds(held: boolean): void {
    if (!this.active && held) return;
    this.setAds(held);
  }

  /** Release remains valid after an overlay disables gameplay input. */
  public touchInteract(held: boolean): void {
    if (held && (!this.active || this.shopOpen)) return;
    this.setInteract(held);
  }

  public touchScoreboard(held: boolean): void {
    if (held && (!this.active || this.shopOpen)) return;
    this.setScoreboard(held);
  }

  public touchSprint(held: boolean): void {
    this.touchSprinting = this.active && held;
    this.sprinting = this.touchSprinting || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  private setAds(held: boolean): void {
    if (this.adsHeld === held) return;
    this.adsHeld = held;
    this.callbacks.onAds?.(held);
  }

  private setInteract(held: boolean): void {
    if (this.interactHeld === held) return;
    this.interactHeld = held;
    this.callbacks.onInteract?.(held);
  }

  private setScoreboard(held: boolean): void {
    if (this.scoreboardHeld === held) return;
    this.scoreboardHeld = held;
    this.callbacks.onScoreboard?.(held);
  }

  private accumulateLook(dx: number, dy: number, scale: number): void {
    if (![dx, dy, scale, this.aimMultiplier].every(Number.isFinite)) return;
    // Pixel deltas already express distance; multiplying by frame time causes acceleration.
    this.lookX += dx * scale * this.aimMultiplier;
    this.lookY += dy * scale * this.aimMultiplier * (this.invertY ? -1 : 1);
  }

  public consumeLook(): { x: number; y: number } {
    const result = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return result;
  }

  public update(): void {
    if (!this.active) {
      this.moveX = 0;
      this.moveY = 0;
      return;
    }
    this.sprinting = this.touchSprinting || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const back = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const x = Number(right) - Number(left) + this.joystickX;
    const y = Number(forward) - Number(back) + this.joystickY;
    const scale = Math.max(1, Math.hypot(x, y));
    this.moveX = x / scale;
    this.moveY = y / scale;
  }

  public requestPointerLock(): void {
    if (!this.active || this.isTouch || document.pointerLockElement === this.canvas) return;
    // Some browsers return a Promise, others retain the original void API.
    try {
      const request = this.canvas.requestPointerLock();
      if (request) void request.catch(() => undefined);
    } catch {
      // A subsequent user click can retry if the browser denied this gesture.
    }
  }

  /** Intentional UI transitions release capture without treating its later event as a pause. */
  public releasePointerLock(): void {
    this.hadPointerLock = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.enabled = false;
    this.disposed = true;
    this.clearState();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.releasePointerLock();
  }

  private clearState(): void {
    this.keys.clear();
    this.fireHeld = false;
    this.setAds(false);
    this.setInteract(false);
    this.setScoreboard(false);
    this.sprinting = false;
    this.touchSprinting = false;
    this.moveX = 0;
    this.moveY = 0;
    this.joystickX = 0;
    this.joystickY = 0;
    this.lookX = 0;
    this.lookY = 0;
  }

  private requestPause(): void {
    this.clearState();
    if (!this.active || this.pauseRequested) return;
    this.pauseRequested = true;
    this.callbacks.onPause();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const code = event.code;
    if ((code === 'KeyB' && this.shopEnabled) || (code === 'Escape' && this.shopOpen)) {
      event.preventDefault();
      if (!event.repeat) this.callbacks.onShop?.();
      return;
    }
    if (!this.active) return;
    if (this.shopOpen && (code === 'KeyF' || code === 'Tab')) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'KeyR', 'Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyB', 'KeyN', 'KeyF', 'KeyV', 'Tab', 'ShiftLeft', 'ShiftRight'].includes(code)) {
      event.preventDefault();
    }
    if (code === 'Escape') {
      this.requestPause();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      return;
    }
    this.keys.add(code);
    if (event.repeat) return;
    if (code === 'KeyR') this.callbacks.onReload();
    if (code === 'Space') this.callbacks.onJump();
    if (/^Digit[1-4]$/.test(code)) this.callbacks.onSlot?.(Number(code.slice(-1)));
    if (code === 'KeyN') this.callbacks.onPrimaryCycle?.();
    if (code === 'KeyV') this.callbacks.onInspect?.();
    if (code === 'KeyF') this.setInteract(true);
    if (code === 'Tab') this.setScoreboard(true);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    if (event.code === 'KeyF') this.setInteract(false);
    if (event.code === 'Tab') this.setScoreboard(false);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.active || document.pointerLockElement !== this.canvas) return;
    this.accumulateLook(event.movementX, event.movementY, this.sensitivity * 0.002);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.active || (event.button !== 0 && event.button !== 2) || event.pointerType === 'touch') return;
    if (document.pointerLockElement !== this.canvas) {
      this.requestPointerLock();
      return;
    }
    event.preventDefault();
    if (event.button === 0) this.touchTrigger(true);
    if (event.button === 2) this.setAds(true);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    if (event.button === 0) this.fireHeld = false;
    if (event.button === 2) this.setAds(false);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') {
      this.fireHeld = false;
      this.setAds(false);
    }
  };

  private readonly onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    if (this.hadPointerLock && !locked) this.requestPause();
    this.hadPointerLock = locked;
  };

  private readonly onBlur = (): void => this.requestPause();

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.requestPause();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.active) event.preventDefault();
  };
}
