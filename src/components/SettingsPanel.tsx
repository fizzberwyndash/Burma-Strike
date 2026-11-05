import { Check, RotateCcw } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../game/settings';
import type { GameSettings } from '../game/settings';

interface Props {
  settings: GameSettings;
  onChange: (settings: GameSettings) => void;
}

export default function SettingsPanel({ settings, onChange }: Props) {
  function slider(key: 'sensitivity' | 'adsSensitivity' | 'scopedSensitivity' | 'touchSensitivity' | 'fov', label: string, description: string, min: number, max: number, step = 0.01) {
    return <label className="tactical-setting" key={key}>
      <span className="setting-copy"><strong>{label}</strong><small>{description}</small></span>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={settings[key]} onChange={event => onChange({ ...settings, [key]: Number(event.target.value) })} />
      <output>{key === 'fov' ? `${Math.round(settings[key])}°` : settings[key].toFixed(2)}</output>
    </label>;
  }
  function toggle(key: 'invertY' | 'headBob' | 'sound' | 'showFps', label: string, description: string) {
    return <button key={key} type="button" role="switch" aria-checked={settings[key]} className="tactical-setting tactical-toggle" onClick={() => onChange({ ...settings, [key]: !settings[key] })}>
      <span className="setting-copy"><strong>{label}</strong><small>{description}</small></span>
      <span className={`toggle ${settings[key] ? 'on' : ''}`} aria-hidden="true">{settings[key] && <Check size={12} />}</span>
    </button>;
  }
  return <div className="settings-panel">
    <p>Changes apply immediately and save automatically. Mouse input uses a constant scale per pixel, with no added acceleration.</p>
    <h3>AIM & INPUT</h3>
    {slider('sensitivity', 'Mouse sensitivity', 'Hip-fire mouse look', 0.05, 2)}
    {slider('adsSensitivity', 'ADS sensitivity multiplier', 'Applied while aiming down sights', 0.1, 1.5)}
    {slider('scopedSensitivity', 'Scoped sensitivity multiplier', 'Additional multiplier for the sniper scope', 0.1, 1.5)}
    {slider('touchSensitivity', 'Mobile touch sensitivity', 'Independent drag-to-aim speed', 0.1, 3)}
    {toggle('invertY', 'Invert Y-axis', 'Reverse vertical mouse and touch look')}
    <h3>CAMERA & FEEDBACK</h3>
    {slider('fov', 'Field of view', 'Horizontal hip-fire field of view; ADS narrows it', 70, 110, 1)}
    {toggle('headBob', 'Restrained head bob', 'Subtle movement feedback; off by default')}
    {toggle('sound', 'Sound effects', 'Procedural weapon and hit feedback')}
    {toggle('showFps', 'FPS counter', 'Display render performance in Practice')}
    <div className="settings-footer"><small>Sensitivity is specific to BURMA STRIKE; it is not calibrated to another game.</small><button className="reset-settings" onClick={() => onChange({ ...DEFAULT_SETTINGS })}><RotateCcw size={14} /> RESET TO DEFAULTS</button></div>
  </div>;
}
