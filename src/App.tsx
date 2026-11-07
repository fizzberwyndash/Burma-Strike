import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, ChevronRight, Crosshair, Flag, MapPin, Menu, Mouse, Pause, RotateCcw, Settings2, Shield, ShieldCheck, ShoppingBag, Coins, Users, X } from 'lucide-react';
import { StrikeGame, INITIAL_HUD } from './game/game';
import type { GameMode } from './game/game';
import { loadSettings, saveSettings } from './game/settings';
import type { GameSettings } from './game/settings';
import { I18nProvider, useI18n } from './i18n';
import SettingsPanel from './components/SettingsPanel';
import TouchControls from './components/TouchControls';
import BuyMenu from './components/BuyMenu';
import ObjectiveHud, { ObjectiveSandboxPanel } from './components/ObjectiveHud';
import RoomPanel from './components/RoomPanel';
import { OnlineClient } from './network/client';
import type { ConnectionState } from './network/client';

function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 48"><path d="M20 2 37 12v24L20 46 3 36V12Z M20 9l11 7v16l-11 7-11-7V16Z M12 31l8-15 8 15M16 25h8" /></svg></span><span>BURMA<span className="brand-word">STRIKE</span><small className="brand-myanmar" lang="my">မြန်မာ့ဗျူဟာ</small></span></div>;
}

/** The provider changes UI copy without remounting Babylon or its input handlers. */
export default function App() {
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  return <I18nProvider language={settings.language}><GameShell settings={settings} setSettings={setSettings} /></I18nProvider>;
}

function GameShell({ settings, setSettings }: { settings: GameSettings; setSettings: (settings: GameSettings) => void }) {
  const { language, t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<StrikeGame | null>(null);
  const [mode, setMode] = useState<GameMode>('menu');
  const [hud, setHud] = useState(INITIAL_HUD);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState({ progress: 0, label: 'Preparing renderer' });
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'settings' | 'guide' | 'rooms' | null>(null);
  const [touch, setTouch] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopPresent, setShopPresent] = useState(false);
  const network = useRef<OnlineClient | null>(null);
  const attachedSession = useRef('');
  const [roomView, setRoomView] = useState<'create' | 'join'>('create');
  const [connection, setConnection] = useState<ConnectionState>({ status: 'disconnected', snapshot: null, sessionId: '', error: '', reconnectAvailable: false });

  useEffect(() => {
    let client: OnlineClient;
    try { client = new OnlineClient(); }
    catch (cause) {
      setConnection({ status:'error', snapshot:null, sessionId:'', reconnectAvailable:false,
        error:cause instanceof Error ? cause.message : 'Invalid multiplayer server URL.' });
      return;
    }
    network.current = client;
    const unsubscribe = client.subscribe(setConnection);
    return () => { unsubscribe(); client.dispose(); network.current = null; };
  }, []);

  useEffect(() => {
    if (mode === 'menu') { setShopPresent(false); return; }
    if (shopOpen) { setShopPresent(true); return; }
    const timer = window.setTimeout(() => setShopPresent(false), 160);
    return () => window.clearTimeout(timer);
  }, [shopOpen, mode]);

  useEffect(() => {
    if (!canvas.current) return;
    let instance: StrikeGame | null = null;
    let disposed = false;
    try {
      instance = new StrikeGame(canvas.current, setHud, () => setMode('paused'), loadSettings(), setShopOpen, (progress, label) => {
        if (disposed) return;
        if (progress < 0) { setError('The 3D renderer could not start. Enable WebGL / hardware acceleration in your browser, then reload.'); return; }
        setLoading({ progress, label });
        if (progress >= 1) setReady(true);
      });
      game.current = instance;
      setTouch(instance.input.isTouch);
    } catch (cause) {
      console.error(cause);
      setError('The 3D renderer could not start. Enable WebGL / hardware acceleration in your browser, then reload.');
    }
    return () => { disposed = true; instance?.dispose(); game.current = null; };
  }, []);

  useEffect(() => { game.current?.setMode(mode); }, [mode]);
  useEffect(() => { game.current?.configure(settings); saveSettings(settings); }, [settings]);
  useEffect(() => {
    const client = network.current;
    const stage = connection.snapshot?.stage;
    if (!client || !ready || !game.current) return;
    if ((stage === 'match' || stage === 'finished') && connection.sessionId) {
      if (attachedSession.current !== connection.sessionId) {
        game.current.attachOnline(client); attachedSession.current = connection.sessionId;
        game.current.setMode('playing'); setMode('playing'); setDialog(null);
      }
    } else if (attachedSession.current) {
      game.current.detachOnline(); attachedSession.current = '';
      game.current.setMode('menu'); setMode('menu'); setShopOpen(false);
      setDialog(connection.snapshot ? 'rooms' : null);
    }
    if (stage === 'finished') setDialog('rooms');
  }, [connection.snapshot?.stage, connection.sessionId, ready]);
  useEffect(() => {
    if (connection.status === 'reconnecting' && attachedSession.current) setMode('paused');
  }, [connection.status]);

  function play() {
    if (!game.current || !ready || error) return;
    game.current.setMode('playing');
    setMode('playing'); setDialog(null);
  }
  async function localMode(start: () => void) {
    if (connection.snapshot) await network.current?.leave();
    game.current?.detachOnline(); attachedSession.current = '';
    start(); play();
  }
  function playFree() { void localMode(() => game.current?.startFreePractice()); }
  function economyDrill() { void localMode(() => game.current?.startEconomyDrill()); }
  function objectiveSandbox() { void localMode(() => game.current?.startObjectiveSandbox()); }
  function openRooms(view: 'create' | 'join') { setRoomView(view); setDialog('rooms'); }
  async function leaveRoom() {
    await network.current?.leave(); game.current?.detachOnline(); attachedSession.current = '';
    game.current?.setMode('menu'); setMode('menu'); setDialog(null); setShopOpen(false);
  }
  function restart() { if (hud.objective) game.current?.rematchObjective(); else game.current?.restart(); play(); }
  function backToMenu() { if (hud.online) { void leaveRoom(); return; } game.current?.setMode('menu'); setMode('menu'); setDialog(null); setShopOpen(false); }
  const primaryLabel = hud.economyMode && !hud.economy?.primaryId ? 'PRIMARY' : hud.primaryId.toUpperCase();
  const ownsSlot = (slot: number) => !hud.economyMode || slot === 3 || (slot === 1 ? !!hud.economy?.primaryId : !!hud.economy?.ownedWeapons.includes('pistol'));
  const actionLabel = hud.action === 'holstering' || hud.action === 'drawing' ? 'SWITCHING WEAPON' : hud.action.toUpperCase();
  const guideControls = [
    ['MOVE', 'W A S D'], ['AIM / FIRE', 'MOUSE / LEFT CLICK'], ['RELOAD / JUMP', 'R / SPACE'],
    ['WEAPON SLOTS', '1 PRIMARY / 2 PISTOL / 3 KNIFE'], ['PRIMARY / INSPECT', 'N CYCLE / V INSPECT'],
    ['ARMORY', 'B OPEN SHOP'], ['SIGNAL CORE', '4 EQUIP / HOLD F PLANT OR DEFUSE'],
    ['SCOREBOARD', 'HOLD TAB'], ['ADS / SPRINT', 'HOLD RIGHT MOUSE / SHIFT'], ['PAUSE', 'ESC'],
  ];

  return <main data-language={language} className={`app mode-${mode} ${hud.objective ? 'objective-mode' : ''}`}>
    <canvas ref={canvas} className="game-canvas" aria-label={t('BURMA STRIKE 3D fortress practice range')} />
    <div className="world-grain" aria-hidden="true" />
    {mode === 'menu' && <div className="menu-screen">
      <header className="topbar">
        <Brand />
        <nav className="main-nav" aria-label={t('Main navigation')}>
          <button className={!dialog ? 'nav-active' : ''} onClick={() => setDialog(null)}><span>01</span>{t('PLAY')}</button>
          <button onClick={() => setDialog('guide')}><span>02</span>{t('FIELD GUIDE')}</button>
          <button onClick={() => setDialog('rooms')}><Users size={15} />{t('ROOMS')}</button>
          <button onClick={() => setDialog('settings')}><Settings2 size={15} />{t('SETTINGS')}</button>
        </nav>
        <div className="connection"><i />{t(connection.snapshot ? 'PRIVATE ONLINE ROOM' : 'LOCAL SESSION')}<span className="connection-separator">/</span><span className="muted">V. 1.0</span></div>
      </header>
      <section className="hero">
        <div className="eyebrow"><span className="short-rule" />{t('THE GOLDEN FRONTIER')}<span className="edition">VOL. 01</span></div>
        <h1>BURMA<br /><span>STRIKE<span className="title-dot">.</span></span></h1>
        <div className="hero-subtitle"><span className="tiny-square" />{t('AN ORIGINAL TACTICAL FPS EXPERIENCE')}</div>
        <p>{t('Old walls. New instincts.')}<br />{t('Find your focus in the heart of the golden kingdom.')}</p>
        <div className="hero-actions">
          <button className="play-button" disabled={!ready || !!error} onClick={playFree}><span className="play-button-icon"><Crosshair size={22} strokeWidth={1.5} /></span><span><strong>{t(ready ? 'PLAY PRACTICE' : 'PREPARING RANGE')}</strong><small>{t('YOUR RANGE. YOUR PACE.')}</small></span><ArrowUpRight size={26} strokeWidth={1.5} /></button>
          <button className="secondary-button" onClick={() => setDialog('settings')}><Settings2 size={17} />{t('SETTINGS')}<ChevronRight size={16} /></button>
        </div>
        <div className="custom-room-actions"><button className="create-custom-room" onClick={() => openRooms('create')}><Users size={15} />{t('CREATE CUSTOM ROOM')}<ArrowRight size={14} /></button><button className="join-custom-room" onClick={() => openRooms('join')}><Users size={15} />{t('JOIN CUSTOM ROOM')}<ArrowRight size={14} /></button></div>
        {!ready && !error && <div className="loading-progress" role="progressbar" aria-label={t(loading.label)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(loading.progress * 100)}><span>{t(loading.label)}</span><strong>{Math.round(loading.progress * 100)}%</strong><div><i style={{ width: `${loading.progress * 100}%` }} /></div></div>}
        <button className="economy-entry" disabled={!ready || !!error} onClick={economyDrill}><ShoppingBag size={14} /><span>{t('ECONOMY DRILL')}</span><small>{t('800 CREDITS · BUILD YOUR KIT')}</small><ArrowRight size={13} /></button>
        <button className="economy-entry objective-entry" disabled={!ready || !!error} onClick={objectiveSandbox}><Flag size={14} /><span>{t('ROYAL SIGNAL CORE')}</span><small>{t('PLANT / DEFUSE · LOCAL SANDBOX')}</small><ArrowRight size={13} /></button>
        <div className="hero-note"><Shield size={13} /><span>{t('SOLO PRACTICE')}</span><b>·</b><span>{t('NO ACCOUNT NEEDED')}</span></div>
      </section>
      <div className="world-caption" aria-hidden="true"><div className="caption-cross">+</div><span>20° 56′ N &nbsp; 94° 53′ E</span><span>{t('BAGAN OLD CITY')}</span><div className="caption-rule" /></div>
      <div className="vertical-note" aria-hidden="true">{t('BUILT ON HISTORY. MADE FOR WHAT’S NEXT.')}</div>
      <footer className="menu-footer">
        <div className="location-card"><div className="location-thumb"><Flag size={24} strokeWidth={1} /></div><div><span className="micro">{t('PRACTICE GROUNDS / 001')}</span><strong>{t('BAGAN OLD CITY')}<ArrowUpRight size={14} /></strong><span className="location-description"><MapPin size={10} />{t('BAGAN-INSPIRED · FICTIONAL FRONTIER')}</span></div></div>
        <div className="footer-detail"><span className="micro">{t('MISSION')}</span><span>{t('Sharpen your instincts.')}</span><div className="detail-dots"><i /><i /><i /><i /><i /></div></div>
        <button className="field-guide" onClick={() => setDialog('guide')}><span className="field-guide-icon"><Mouse size={19} strokeWidth={1.5} /></span><span><strong>{t('FIRST TIME IN THE FIELD?')}</strong><small>{t('Get to know your controls')}<ArrowRight size={12} /></small></span></button>
        <div className="footer-index"><span>01</span><small>/ 01</small><div /><ArrowDown size={15} /></div>
      </footer>
      <div className="bottomline"><span><i />{t(ready ? 'ALL SYSTEMS READY' : 'PREPARING YOUR WORLD')}</span><span>{t('ORIGINAL WORLD. PURE PRACTICE.')}</span><span>© 2026 BURMA STRIKE</span></div>
    </div>}

    {mode !== 'menu' && <>
      <div className="hud-top"><div className="range-label"><Crosshair size={18} /><div><strong>{hud.objective ? t('SIGNAL CORE / ROUND {round}', { round: hud.objective.round }) : hud.economyMode ? t('LOCAL DRILL / ROUND {round}', { round: hud.round }) : t('PRACTICE RANGE')}</strong><small>{hud.objective ? t(hud.online ? 'PRIVATE ONLINE MATCH' : 'LOCAL OBJECTIVE SANDBOX') : hud.economyMode ? t('{phase} PHASE · {credits} CREDITS', { phase: t(hud.phase.toUpperCase()), credits: hud.credits.toLocaleString() }) : t('BAGAN OLD CITY')}</small><span className="location-callout"><MapPin size={10} />{t(hud.location)}</span></div></div><div className="range-score"><span>{t('ELIMINATIONS')}<b>{String(hud.kills).padStart(2, '0')}</b></span><span>{t('ACCURACY')}<b>{hud.shots ? Math.round(hud.hits / hud.shots * 100) : 0}%</b></span></div><button className="pause-button" onClick={() => setMode('paused')} aria-label={t('Pause game')}><Pause size={18} /><span>ESC</span></button></div>
      {mode === 'playing' && !shopOpen && <>
        {hud.economyMode && !hud.objective && hud.phase !== 'live' && <button className="buy-phase-hint" onClick={() => game.current?.openShop()} aria-label={t('Open armory for round controls')}><ShoppingBag size={15} /><span><strong>{t(hud.phase === 'buy' ? 'BUY PHASE' : 'ROUND COMPLETE')}</strong><small>{t(hud.phase === 'buy' ? 'OPEN ARMORY · START ROUND TO FIRE' : 'OPEN ARMORY · PREPARE NEXT ROUND')}</small></span><ArrowRight size={15} /></button>}
        <div className={`crosshair ${hud.ads ? 'aiming' : ''}`} aria-hidden="true"><i /><i /><i /><i /><b /></div>
        {hud.ads && hud.weaponKind === 'sniper' && <div className="scope-overlay" aria-hidden="true"><div className="scope-reticle"><i /><b /></div></div>}
        {performance.now() - hud.hitAt < 230 && hud.hitAt > 0 && <div className={`hit-marker ${hud.headshot ? 'headshot' : ''}`}><X size={36} strokeWidth={1.5} />{hud.headshot && <small>{t('HEADSHOT')}</small>}</div>}
        {hud.action !== 'ready' && <div className={`reload-notice action-${hud.action}`}>{hud.reloading && <RotateCcw size={14} />}{t(actionLabel)}</div>}
        {!touch && !hud.locked && hud.objective?.phase !== 'result' && hud.objective?.phase !== 'transition' && <button className="capture-prompt" onClick={() => game.current?.input.requestPointerLock()}><Mouse size={17} />{t('CLICK TO CAPTURE MOUSE')}<span>{t('ESC TO PAUSE')}</span></button>}
        {touch && game.current && <TouchControls input={game.current.input} onShoot={() => game.current?.shoot()} onReload={() => game.current?.reload()} onJump={() => game.current?.jump()} onSlot={slot => game.current?.equipSlot(slot)} onInspect={() => game.current?.inspect()} onPrimaryCycle={() => game.current?.cyclePrimary()} slot={hud.slot} primaryName={primaryLabel} ownedSlots={hud.economyMode ? [1, 2, 3].filter(ownsSlot) : undefined} />}
      </>}
      <div className="hud-bottom"><div className="health"><Shield size={23} /><strong>{Math.ceil(hud.health)}</strong><div><span>{t('HEALTH')}</span><i /></div></div><div className="armor-hud" aria-label={t('Armor {points} points', { points: Math.ceil(hud.armor) })}><ShieldCheck size={21} /><strong>{Math.ceil(hud.armor)}</strong><span>{t('ARMOR')}</span></div><div className="weapon-readout"><div className="ammo"><strong className={hud.objectiveEquipped ? 'objective-ammo' : hud.weaponKind !== 'knife' && hud.ammo <= 3 ? 'low-ammo' : ''}>{hud.objectiveEquipped ? t('CORE') : hud.weaponKind === 'knife' ? '∞' : String(hud.ammo).padStart(2, '0')}</strong>{!hud.objectiveEquipped && hud.weaponKind !== 'knife' && <span>/ {String(hud.reserve).padStart(2, '0')}</span>}</div><div><strong>{t(hud.weaponName)}</strong><small>{hud.objectiveEquipped ? t('HOLD F IN AN ACTIVE SITE TO ARM') : hud.weaponKind !== 'knife' && hud.reserve === 0 && hud.ammo === 0 ? t('PAUSE → RESET RANGE TO RESUPPLY') : hud.weaponKind === 'knife' ? t('MELEE · CLOSE RANGE') : `${t(hud.weaponKind.toUpperCase())} · ${t(hud.ads ? 'ADS' : 'HIP FIRE')}`}</small></div></div></div>
      {!touch && <div className="weapon-slot-strip" aria-label={t('Weapon inventory')}>{([{ slot: 1, label: primaryLabel }, { slot: 2, label: 'PISTOL' }, { slot: 3, label: 'KNIFE' }] as const).map(item => <button key={item.slot} disabled={!ownsSlot(item.slot)} className={hud.slot === item.slot ? 'selected' : ''} onClick={() => game.current?.equipSlot(item.slot)} aria-label={t('Equip {weapon}', { weapon: t(item.label) })}><kbd>{item.slot}</kbd>{t(item.label)}</button>)}<button disabled={!hud.objective || hud.objective.carrierId !== hud.controlledId || hud.objective.coreState !== 'carried'} className={hud.objectiveEquipped ? 'selected' : ''} onClick={() => game.current?.equipSlot(4)} aria-label={t(hud.objective?.carrierId === hud.controlledId ? 'Equip Royal Signal Core' : 'Objective device not carried')}><kbd>4</kbd>{t(hud.objective?.carrierId === hud.controlledId && hud.objective.coreState === 'carried' ? 'SIGNAL CORE' : 'NO DEVICE')}</button></div>}
      {!touch && <div className="control-strip">{[['W A S D', 'MOVE'], ['R', 'RELOAD'], ['SPACE', 'JUMP'], ['LMB / RMB', 'FIRE / ADS'], ['SHIFT', 'SPRINT'], ['V', 'INSPECT'], ['B', 'SHOP'], ...(hud.objective ? [['4 / F', 'CORE / INTERACT'], ['TAB', 'SCORE']] : [])].map(([key, label]) => <span key={key}><kbd>{key}</kbd>{t(label)}</span>)}</div>}
      {hud.objective && mode === 'playing' && !shopOpen && <ObjectiveHud online={hud.online} snapshot={hud.objective} controlledId={hud.controlledId} objectiveEquipped={hud.objectiveEquipped} interactHeld={hud.interactHeld} scoreboard={hud.scoreboard} canInteract={hud.canInteract} interactLabel={hud.interactLabel} position={hud.playerPosition} touch={touch} onEquip={() => game.current?.equipSlot(4)} onInteract={held => game.current?.interact(held)} onScoreboard={held => game.current?.showScoreboard(held)} onNextRound={() => game.current?.nextObjectiveRound()} onRematch={() => game.current?.rematchObjective()} />}
      {settings.showFps && <div className="fps-counter">{hud.fps} FPS<i />{t(hud.graphicsQuality.toUpperCase())} · {Math.round(100 / hud.renderScale)}%</div>}
      {mode === 'playing' && !shopOpen && <button className="shop-launcher" onClick={() => game.current?.openShop()} aria-label={t('Open buy shop')}><ShoppingBag size={16} /><span>{t('SHOP')}</span>{hud.economyMode ? <strong><Coins size={11} />{hud.credits.toLocaleString()}</strong> : <kbd>B</kbd>}</button>}
    </>}

    {mode === 'paused' && !dialog && <div className="modal-backdrop"><section className={`dialog pause-dialog ${hud.objective ? 'objective-pause-dialog' : ''}`} role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <span className="dialog-eyebrow">{t('TAKE A BREATH')}</span><h2 id="pause-title">{t('ON HOLD')}<span>.</span></h2><p>{t(hud.online ? 'Your controls are paused. The online round continues on the server.' : hud.objective ? 'Your local objective drill is paused. Switch roles below to test either side.' : 'The fortress can wait. Your session is paused.')}</p>
      <button className="solid-button" onClick={play}>{t(hud.objective ? 'RESUME OBJECTIVE' : 'RESUME PRACTICE')}<ArrowRight size={18} /></button>
      {!hud.online && <button className="outline-button" onClick={restart}><RotateCcw size={16} />{t(hud.objective ? 'REMATCH · RESET OBJECTIVE' : hud.economyMode ? 'RESET DRILL · 800 CREDITS' : 'RESET RANGE & RESUPPLY')}</button>}
      <button className="outline-button" onClick={() => setDialog('settings')}><Settings2 size={16} />{t('SETTINGS')}</button>
      {hud.objective && !hud.online && <ObjectiveSandboxPanel snapshot={hud.objective} controlledId={hud.controlledId} onControl={id => game.current?.controlObjectivePlayer(id)} onDisconnect={id => game.current?.disconnectObjectivePlayer(id)} onDamage={() => game.current?.objectiveTestDamage()} onTravel={site => game.current?.teleportObjectiveSite(site)} onConfigure={config => { game.current?.configureObjective(config); play(); }} onRematch={() => { game.current?.rematchObjective(); play(); }} />}
      {!hud.online && <div className="practice-loadout"><span>{t(hud.economyMode ? 'OWNED PRIMARY' : 'PRACTICE PRIMARY')}<small>{t('N TO CYCLE IN THE FIELD')}</small></span><div>{(['rifle', 'smg', 'sniper'] as const).map(id => <button key={id} disabled={hud.economyMode && !hud.economy?.ownedWeapons.includes(id)} aria-pressed={hud.primaryId === id} className={hud.primaryId === id ? 'selected' : ''} onClick={() => game.current?.selectPrimary(id)}>{t(id.toUpperCase())}</button>)}</div></div>}
      <button className="outline-button" onClick={() => { setDialog(null); game.current?.openShop(); }}><ShoppingBag size={16} />{t('OPEN ARMORY')}</button>{hud.online && <button className="outline-button online-room-menu" onClick={() => setDialog('rooms')}><Users size={16} />{t('ROOM / LOBBY')}</button>}<button className="text-button" onClick={backToMenu}>{t(hud.online ? 'LEAVE ONLINE MATCH' : 'RETURN TO MAIN MENU')}</button>
    </section></div>}

    {dialog && <div className="modal-backdrop"><section className={`dialog ${dialog === 'settings' ? 'settings-dialog' : dialog === 'rooms' ? 'rooms-dialog' : 'guide-dialog'}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="close-button" aria-label={t('Close dialog')} onClick={() => setDialog(null)}><X size={20} /></button><span className="dialog-eyebrow">{t('BURMA STRIKE / FIELD EQUIPMENT')}</span><h2 id="dialog-title">{t(dialog === 'settings' ? 'MAKE IT YOURS' : dialog === 'rooms' ? 'ONLINE ROOMS' : 'KNOW THE FIELD')}<span>.</span></h2>
      {dialog === 'settings' ? <SettingsPanel settings={settings} onChange={setSettings} /> : dialog === 'rooms' ? <RoomPanel client={network.current} connection={connection} initialView={roomView} onLeave={() => void leaveRoom()} onResume={play} /> : <>
        <p>{t('A complete practice arsenal. Three targets. Room to find your rhythm.')}</p><div className="guide-grid">{guideControls.map(([label, key]) => <div className="guide-control" key={label}><span>{t(label)}</span><kbd>{t(key)}</kbd></div>)}</div>
        <p className="guide-note">{t('On mobile, play in landscape. Use the left stick to move, drag the right side to aim, and use Fire, ADS, reload, jump, and weapon-slot buttons together. Royal Signal Core adds a device button, a contextual hold-to-interact button and a scoreboard.')}</p>
        <div className="dialog-tip"><Crosshair size={18} /><span>{t('Dummies have 100 HP. Damage, range, and fire rate vary by weapon.')}<br />{t('Targets respawn after 3 seconds. Free Range keeps the full arsenal; Economy Drill uses buy-phase purchases and local round rewards. Royal Signal Core is an offline objective sandbox: use Esc → Sandbox controls to switch roles and configure the active site.')}</span></div>
      </>}
      <button className="solid-button dialog-back-button" onClick={() => setDialog(null)}>{t(mode === 'menu' ? 'BACK TO BASE' : 'BACK TO PAUSE')}<ArrowRight size={18} /></button>
    </section></div>}
    {(shopOpen || shopPresent) && mode !== 'menu' && <div inert={!shopOpen} aria-hidden={!shopOpen} className={`shop-presence ${shopOpen ? '' : 'is-closing'}`}><BuyMenu online={hud.online} active={shopOpen} objectiveMode={!!hud.objective} objectiveStatus={hud.objective ? t('{phase} · {seconds}s', { phase:t(hud.objective.phase.toUpperCase()), seconds:Math.ceil(hud.objective.remaining) }) : undefined} snapshot={hud.economy} onClose={() => game.current?.closeShop()} onBuy={id => game.current?.buyItem(id)} onSell={id => game.current?.sellItem(id)} onEquip={id => game.current?.shopEquipWeapon(id)} onStartDrill={economyDrill} onStartRound={() => game.current?.startRound()} onFinishRound={outcome => game.current?.finishRound(outcome)} onNewRound={() => game.current?.newRound()} onTestDamage={() => game.current?.testDamage(40)} /></div>}
    {hud.online && mode !== 'menu' && !dialog && <div className={`online-session-status ${connection.status}`} role="status"><span>{t(connection.status === 'reconnecting' ? 'CONNECTION INTERRUPTED · RECONNECTING' : connection.status === 'error' ? 'CONNECTION ERROR' : 'PRIVATE ONLINE MATCH')}</span><strong>{connection.snapshot?.code}</strong>{connection.error && <small>{t(connection.error)}</small>}{connection.status === 'error' && connection.reconnectAvailable && <button onClick={() => void network.current?.reconnect()}>{t('REJOIN')}</button>}</div>}
    {touch && <div className="rotate-notice"><div><Menu size={22} /><RotateCcw size={40} /><h2>{t('A WIDER HORIZON.')}</h2><p>{t('Rotate your device to landscape for the best practice experience.')}</p></div></div>}
    {error && <div className="error-notice" role="alert"><h2>{t('RENDERER UNAVAILABLE')}</h2><p>{t(error)}</p><button onClick={() => window.location.reload()}>{t('RETRY')}</button></div>}
  </main>;
}
