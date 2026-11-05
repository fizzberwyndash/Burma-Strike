export interface InputCallbacks {
  onPause: () => void;
  onShoot: () => void;
  onReload: () => void;
  onJump: () => void;
}

/** Owns desktop events; touch UI feeds its independent pointers into this class. */
export class GameInput {
  public sensitivity = 1;
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

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: InputCallbacks,
  ) {
    // Use the primary pointer: touch-capable laptops still need mouse capture.
    this.isTouch = window.matchMedia('(pointer: coarse)').matches;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
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

  public touchMove(x: number, y: number): void {
    if (!this.active) return;
    this.joystickX = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
    this.joystickY = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0;
  }

  public touchLook(dx: number, dy: number): void {
    if (!this.active || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.lookX += dx * this.sensitivity * 0.004;
    this.lookY += dy * this.sensitivity * 0.004;
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

  public dispose(): void {
    if (this.disposed) return;
    this.enabled = false;
    this.disposed = true;
    this.clearState();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private clearState(): void {
    this.keys.clear();
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
    if (!this.active) return;
    const code = event.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'KeyR', 'Escape'].includes(code)) {
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
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.active || document.pointerLockElement !== this.canvas) return;
    this.lookX += event.movementX * this.sensitivity * 0.002;
    this.lookY += event.movementY * this.sensitivity * 0.002;
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0 || event.pointerType === 'touch') return;
    if (document.pointerLockElement !== this.canvas) {
      this.requestPointerLock();
      return;
    }
    this.callbacks.onShoot();
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
