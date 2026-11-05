export interface GameSettings {
  sensitivity: number;
  adsSensitivity: number;
  scopedSensitivity: number;
  touchSensitivity: number;
  invertY: boolean;
  fov: number;
  headBob: boolean;
  sound: boolean;
  showFps: boolean;
}

export const SETTINGS_KEY = 'burma-strike-settings';
export const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 0.35,
  adsSensitivity: 1,
  scopedSensitivity: 1,
  touchSensitivity: 1,
  invertY: false,
  fov: 90,
  headBob: false,
  sound: true,
  showFps: true,
};

/** Accept legacy settings while rejecting malformed storage and nonfinite values. */
export function normalizeSettings(value: unknown): GameSettings {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const numeric = (key: keyof GameSettings, min: number, max: number): number => {
    const candidate = saved[key];
    return typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.round(Math.max(min, Math.min(max, candidate)) * 100) / 100
      : DEFAULT_SETTINGS[key] as number;
  };
  const boolean = (key: keyof GameSettings) => typeof saved[key] === 'boolean' ? saved[key] as boolean : DEFAULT_SETTINGS[key] as boolean;
  return {
    sensitivity: numeric('sensitivity', 0.05, 2),
    adsSensitivity: numeric('adsSensitivity', 0.1, 1.5),
    scopedSensitivity: numeric('scopedSensitivity', 0.1, 1.5),
    touchSensitivity: numeric('touchSensitivity', 0.1, 3),
    fov: numeric('fov', 70, 110),
    invertY: boolean('invertY'), headBob: boolean('headBob'),
    sound: boolean('sound'), showFps: boolean('showFps'),
  };
}

export function loadSettings(): GameSettings {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(settings: GameSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch { /* Settings remain active when browser storage is unavailable. */ }
}
