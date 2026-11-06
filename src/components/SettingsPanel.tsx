import { Check, RotateCcw } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../game/settings';
import type { GameSettings } from '../game/settings';
import { useI18n } from '../i18n';

interface Props {
  settings: GameSettings;
  onChange: (settings: GameSettings) => void;
}

export default function SettingsPanel({ settings, onChange }: Props) {
  const { t } = useI18n();
  function slider(key: 'sensitivity' | 'adsSensitivity' | 'scopedSensitivity' | 'touchSensitivity' | 'fov', label: string, description: string, min: number, max: number, step = 0.01) {
    return <label className="tactical-setting" key={key}>
      <span className="setting-copy"><strong>{t(label)}</strong><small>{t(description)}</small></span>
      <input aria-label={t(label)} type="range" min={min} max={max} step={step} value={settings[key]} onChange={event => onChange({ ...settings, [key]: Number(event.target.value) })} />
      <output>{key === 'fov' ? `${Math.round(settings[key])}°` : settings[key].toFixed(2)}</output>
    </label>;
  }
  function toggle(key: 'invertY' | 'headBob' | 'sound' | 'showFps' | 'adaptiveResolution', label: string, description: string) {
    return <button key={key} type="button" role="switch" aria-checked={settings[key]} className="tactical-setting tactical-toggle" onClick={() => onChange({ ...settings, [key]: !settings[key] })}>
      <span className="setting-copy"><strong>{t(label)}</strong><small>{t(description)}</small></span>
      <span className={`toggle ${settings[key] ? 'on' : ''}`} aria-hidden="true">{settings[key] && <Check size={12} />}</span>
    </button>;
  }
  return <div className="settings-panel">
    <p>{t('Changes apply immediately and save automatically. Mouse input uses a constant scale per pixel, with no added acceleration.')}</p>
    <h3>{t('LANGUAGE & PERFORMANCE')}</h3>
    <label className="tactical-setting setting-select"><span className="setting-copy"><strong>{t('Language')}</strong><small>{t('Menu, shop and gameplay interface language')}</small></span><select aria-label={t('Language')} value={settings.language} onChange={event => onChange({ ...settings, language: event.target.value as GameSettings['language'] })}><option value="en">English</option><option value="my">မြန်မာ</option></select></label>
    <label className="tactical-setting setting-select"><span className="setting-copy"><strong>{t('Graphics quality')}</strong><small>{t('Auto chooses a starting preset for your device')}</small></span><select aria-label={t('Graphics quality')} value={settings.graphics} onChange={event => onChange({ ...settings, graphics: event.target.value as GameSettings['graphics'] })}>{(['auto', 'low', 'medium', 'high'] as const).map(value => <option value={value} key={value}>{t(value[0].toUpperCase() + value.slice(1))}</option>)}</select></label>
    <label className="tactical-setting setting-select"><span className="setting-copy"><strong>{t('Target frame rate')}</strong><small>{t('Choose 30 or 60 FPS; actual performance depends on your device')}</small></span><select aria-label={t('Target frame rate')} value={settings.targetFps} onChange={event => onChange({ ...settings, targetFps: Number(event.target.value) as 30 | 60 })}><option value="30">30 FPS</option><option value="60">60 FPS</option></select></label>
    {toggle('adaptiveResolution', 'Adaptive rendering resolution', 'Adjust resolution to help maintain your target frame rate')}
    <h3>{t('AIM & INPUT')}</h3>
    {slider('sensitivity', 'Mouse sensitivity', 'Hip-fire mouse look', 0.05, 2)}
    {slider('adsSensitivity', 'ADS sensitivity multiplier', 'Applied while aiming down sights', 0.1, 1.5)}
    {slider('scopedSensitivity', 'Scoped sensitivity multiplier', 'Additional multiplier for the sniper scope', 0.1, 1.5)}
    {slider('touchSensitivity', 'Mobile touch sensitivity', 'Independent drag-to-aim speed', 0.1, 3)}
    {toggle('invertY', 'Invert Y-axis', 'Reverse vertical mouse and touch look')}
    <h3>{t('CAMERA & FEEDBACK')}</h3>
    {slider('fov', 'Field of view', 'Horizontal hip-fire field of view; ADS narrows it', 70, 110, 1)}
    {toggle('headBob', 'Restrained head bob', 'Subtle movement feedback; off by default')}
    {toggle('sound', 'Sound effects', 'Procedural weapon, wind, market and surface footsteps')}
    {toggle('showFps', 'FPS counter', 'Display render performance in Practice')}
    <div className="settings-footer"><small>{t('Sensitivity is specific to BURMA STRIKE; it is not calibrated to another game.')}</small><button className="reset-settings" onClick={() => onChange({ ...DEFAULT_SETTINGS })}><RotateCcw size={14} />{t('RESET TO DEFAULTS')}</button></div>
  </div>;
}
