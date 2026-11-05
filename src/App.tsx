import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, ChevronRight, Crosshair, Flag, MapPin, Menu, Mouse, Pause, RotateCcw, Settings2, Shield, X } from 'lucide-react';
import { StrikeGame, INITIAL_HUD } from './game/game';
import type { GameMode } from './game/game';
import { loadSettings, saveSettings } from './game/settings';
import type { GameSettings } from './game/settings';
import SettingsPanel from './components/SettingsPanel';
import TouchControls from './components/TouchControls';

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}><span className="brand-mark"><span>B</span></span><span>BURMA<span className="brand-word">STRIKE</span></span></div>;
}

export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<StrikeGame | null>(null);
  const [mode, setMode] = useState<GameMode>('menu');
  const [hud, setHud] = useState(INITIAL_HUD);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'settings' | 'guide' | null>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    if (!canvas.current) return;
    let instance: StrikeGame | null = null;
    try {
      instance = new StrikeGame(canvas.current, setHud, () => setMode('paused'), loadSettings());
      game.current = instance;
      setTouch(instance.input.isTouch);
      setReady(true);
    } catch (cause) {
      console.error(cause);
      setError('The 3D renderer could not start. Enable WebGL / hardware acceleration in your browser, then reload.');
    }
    return () => { instance?.dispose(); game.current = null; };
  }, []);

  useEffect(() => { game.current?.setMode(mode); }, [mode]);
  useEffect(() => {
    game.current?.configure(settings);
    saveSettings(settings);
  }, [settings]);

  function play() {
    if (!game.current || !ready || error) return;
    game.current.setMode('playing');
    setMode('playing'); setDialog(null);
  }
  function restart() { game.current?.restart(); play(); }
  function backToMenu() { setMode('menu'); setDialog(null); }

  return <main className={`app mode-${mode}`}>
    <canvas ref={canvas} className="game-canvas" aria-label="BURMA STRIKE 3D fortress practice range" />
    <div className="world-grain" aria-hidden="true" />

    {mode === 'menu' && <div className="menu-screen">
      <header className="topbar">
        <Brand />
        <nav className="main-nav" aria-label="Main navigation">
          <button className="nav-active" onClick={() => setDialog(null)}><span>01</span> PLAY</button>
          <button onClick={() => setDialog('guide')}><span>02</span> FIELD GUIDE</button>
          <button onClick={() => setDialog('settings')}><Settings2 size={15} /> SETTINGS</button>
        </nav>
        <div className="connection"><i /> LOCAL SESSION <span className="connection-separator">/</span><span className="muted">V. 1.0</span></div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span className="short-rule" /> THE GOLDEN FRONTIER <span className="edition">VOL. 01</span></div>
        <h1>BURMA<br /><span>STRIKE<span className="title-dot">.</span></span></h1>
        <div className="hero-subtitle"><span className="tiny-square" /> AN ORIGINAL TACTICAL FPS EXPERIENCE</div>
        <p>Old walls. New instincts.<br />Find your focus in the heart of the golden kingdom.</p>
        <div className="hero-actions">
          <button className="play-button" disabled={!ready || !!error} onClick={play}><span className="play-button-icon"><Crosshair size={22} strokeWidth={1.5} /></span><span><strong>{ready ? 'PLAY PRACTICE' : 'PREPARING RANGE'}</strong><small>YOUR RANGE. YOUR PACE.</small></span><ArrowUpRight size={26} strokeWidth={1.5} /></button>
          <button className="secondary-button" onClick={() => setDialog('settings')}><Settings2 size={17} /> SETTINGS <ChevronRight size={16} /></button>
        </div>
        <div className="hero-note"><Shield size={13} /><span>SOLO PRACTICE</span><b>·</b><span>NO ACCOUNT NEEDED</span></div>
      </section>

      <div className="world-caption" aria-hidden="true"><div className="caption-cross">+</div><span>20° 56′ N &nbsp; 94° 53′ E</span><span>THE AEYAR FORTRESS</span><div className="caption-rule" /></div>
      <div className="vertical-note" aria-hidden="true">BUILT ON HISTORY. MADE FOR WHAT’S NEXT.</div>

      <footer className="menu-footer">
        <div className="location-card"><div className="location-thumb"><Flag size={24} strokeWidth={1} /></div><div><span className="micro">PRACTICE GROUNDS / 001</span><strong>AEYAR FORTRESS <ArrowUpRight size={14} /></strong><span className="location-description"><MapPin size={10} /> BAGAN-INSPIRED · FICTIONAL FRONTIER</span></div></div>
        <div className="footer-detail"><span className="micro">MISSION</span><span>Sharpen your instincts.</span><div className="detail-dots"><i /><i /><i /><i /><i /></div></div>
        <button className="field-guide" onClick={() => setDialog('guide')}><span className="field-guide-icon"><Mouse size={19} strokeWidth={1.5} /></span><span><strong>FIRST TIME IN THE FIELD?</strong><small>Get to know your controls <ArrowRight size={12} /></small></span></button>
        <div className="footer-index"><span>01</span><small>/ 01</small><div /><ArrowDown size={15} /></div>
      </footer>
      <div className="bottomline"><span><i /> ALL SYSTEMS READY</span><span>ORIGINAL WORLD. PURE PRACTICE.</span><span>© 2026 BURMA STRIKE</span></div>
    </div>}

    {mode !== 'menu' && <>
      <div className="hud-top"><div className="range-label"><Crosshair size={18} /><div><strong>PRACTICE RANGE</strong><small>AEYAR FORTRESS</small></div></div><div className="range-score"><span>ELIMINATIONS <b>{String(hud.kills).padStart(2, '0')}</b></span><span>ACCURACY <b>{hud.shots ? Math.round(hud.hits / hud.shots * 100) : 0}%</b></span></div><button className="pause-button" onClick={() => setMode('paused')} aria-label="Pause game"><Pause size={18} /><span>ESC</span></button></div>
      {mode === 'playing' && <>
        <div className={`crosshair ${hud.ads ? 'aiming' : ''}`} aria-hidden="true"><i /><i /><i /><i /><b /></div>
        {hud.ads && hud.weaponKind === 'sniper' && <div className="scope-overlay" aria-hidden="true"><div className="scope-reticle"><i /><b /></div></div>}
        {performance.now() - hud.hitAt < 230 && hud.hitAt > 0 && <div className={`hit-marker ${hud.headshot ? 'headshot' : ''}`}><X size={36} strokeWidth={1.5} />{hud.headshot && <small>HEADSHOT</small>}</div>}
        {hud.action !== 'ready' && <div className={`reload-notice action-${hud.action}`}>{hud.reloading && <RotateCcw size={14} />} {hud.action === 'holstering' || hud.action === 'drawing' ? 'SWITCHING WEAPON' : hud.action.toUpperCase()}</div>}
        {!touch && !hud.locked && <button className="capture-prompt" onClick={() => game.current?.input.requestPointerLock()}><Mouse size={17} /> CLICK TO CAPTURE MOUSE <span>ESC TO PAUSE</span></button>}
        {touch && game.current && <TouchControls input={game.current.input} onShoot={() => game.current?.shoot()} onReload={() => game.current?.reload()} onJump={() => game.current?.jump()} onSlot={slot => game.current?.equipSlot(slot)} onInspect={() => game.current?.inspect()} onPrimaryCycle={() => game.current?.cyclePrimary()} slot={hud.slot} primaryName={hud.primaryId.toUpperCase()} />}
      </>}
      <div className="hud-bottom"><div className="health"><Shield size={23} /><strong>{hud.health}</strong><div><span>HEALTH</span><i /></div></div><div className="weapon-readout"><div className="ammo"><strong className={hud.weaponKind !== 'knife' && hud.ammo <= 3 ? 'low-ammo' : ''}>{hud.weaponKind === 'knife' ? '∞' : String(hud.ammo).padStart(2, '0')}</strong>{hud.weaponKind !== 'knife' && <span>/ {String(hud.reserve).padStart(2, '0')}</span>}</div><div><strong>{hud.weaponName}</strong><small>{hud.weaponKind !== 'knife' && hud.reserve === 0 && hud.ammo === 0 ? 'PAUSE → RESET RANGE TO RESUPPLY' : hud.weaponKind === 'knife' ? 'MELEE · CLOSE RANGE' : `${hud.weaponKind.toUpperCase()} · ${hud.ads ? 'ADS' : 'HIP FIRE'}`}</small></div></div></div>
      {!touch && <div className="weapon-slot-strip" aria-label="Weapon inventory">{([{ slot: 1, label: hud.primaryId.toUpperCase() }, { slot: 2, label: 'PISTOL' }, { slot: 3, label: 'KNIFE' }] as const).map(item => <button key={item.slot} className={hud.slot === item.slot ? 'selected' : ''} onClick={() => game.current?.equipSlot(item.slot)} aria-label={`Equip ${item.label}`}><kbd>{item.slot}</kbd>{item.label}</button>)}<button disabled aria-label="Objective device not carried"><kbd>4</kbd>NO DEVICE</button></div>}
      {!touch && <div className="control-strip"><span><kbd>W A S D</kbd> MOVE</span><span><kbd>R</kbd> RELOAD</span><span><kbd>SPACE</kbd> JUMP</span><span><kbd>LMB / RMB</kbd> FIRE / ADS</span><span><kbd>SHIFT</kbd> SPRINT</span><span><kbd>F</kbd> INSPECT</span></div>}
      {settings.showFps && <div className="fps-counter">{hud.fps} FPS <i /> LOCAL</div>}
    </>}

    {mode === 'paused' && !dialog && <div className="modal-backdrop"><section className="dialog pause-dialog" role="dialog" aria-modal="true" aria-labelledby="pause-title"><span className="dialog-eyebrow">TAKE A BREATH</span><h2 id="pause-title">ON HOLD<span>.</span></h2><p>The fortress can wait. Your session is paused.</p><button className="solid-button" onClick={play}>RESUME PRACTICE <ArrowRight size={18} /></button><button className="outline-button" onClick={restart}><RotateCcw size={16} /> RESET RANGE & RESUPPLY</button><button className="outline-button" onClick={() => setDialog('settings')}><Settings2 size={16} /> SETTINGS</button><div className="practice-loadout"><span>PRACTICE PRIMARY <small>B TO CYCLE IN THE FIELD</small></span><div>{(['rifle', 'smg', 'sniper'] as const).map(id => <button key={id} aria-pressed={hud.primaryId === id} className={hud.primaryId === id ? 'selected' : ''} onClick={() => game.current?.selectPrimary(id)}>{id.toUpperCase()}</button>)}</div></div><button className="text-button" onClick={backToMenu}>RETURN TO MAIN MENU</button></section></div>}

    {dialog && <div className="modal-backdrop"><section className={`dialog ${dialog === 'settings' ? 'settings-dialog' : 'guide-dialog'}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="close-button" aria-label="Close dialog" onClick={() => setDialog(null)}><X size={20} /></button><span className="dialog-eyebrow">BURMA STRIKE / FIELD EQUIPMENT</span><h2 id="dialog-title">{dialog === 'settings' ? 'MAKE IT YOURS' : 'KNOW THE FIELD'}<span>.</span></h2>
      {dialog === 'settings' ? <SettingsPanel settings={settings} onChange={setSettings} /> : <><p>A complete practice arsenal. Three targets. Room to find your rhythm.</p><div className="guide-grid"><span>MOVE</span><kbd>W A S D</kbd><span>AIM / FIRE</span><kbd>MOUSE / LEFT CLICK</kbd><span>RELOAD / JUMP</span><kbd>R / SPACE</kbd><span>WEAPON SLOTS</span><kbd>1 PRIMARY / 2 PISTOL / 3 KNIFE</kbd><span>PRIMARY / INSPECT</span><kbd>B CYCLE / F INSPECT</kbd><span>ADS / SPRINT</span><kbd>HOLD RIGHT MOUSE / SHIFT</kbd><span>PAUSE</span><kbd>ESC</kbd></div><p className="guide-note">On mobile, play in landscape. Use the left stick to move, drag the right side to aim, and use Fire, ADS, reload, jump, and weapon-slot buttons together.</p><div className="dialog-tip"><Crosshair size={18} /> Dummies have 100 HP. Damage, range, and fire rate vary by weapon.<br />Targets respawn after 3 seconds. Reset the range to resupply.</div></>}
      <button className="solid-button" onClick={() => setDialog(null)}>BACK TO {mode === 'menu' ? 'BASE' : 'PAUSE'} <ArrowRight size={18} /></button>
    </section></div>}

    {touch && <div className="rotate-notice"><div><Menu size={22} /><RotateCcw size={40} /><h2>A WIDER HORIZON.</h2><p>Rotate your device to landscape<br />for the best practice experience.</p></div></div>}
    {error && <div className="error-notice" role="alert"><h2>RENDERER UNAVAILABLE</h2><p>{error}</p><button onClick={() => window.location.reload()}>RETRY</button></div>}
  </main>;
}
