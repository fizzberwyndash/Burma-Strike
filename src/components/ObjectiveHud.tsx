import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowRight, ChevronDown, Flag, Heart, MapPin, Radio, RotateCcw, Shield, Users, X } from 'lucide-react';
import { OBJECTIVE_SITES } from '../game/objective';
import type { ObjectiveConfig, ObjectiveSnapshot } from '../game/objective';

type Point = { x: number; y: number; z: number };

interface ObjectiveHudProps {
  snapshot: ObjectiveSnapshot;
  controlledId: string;
  objectiveEquipped: boolean;
  interactHeld: boolean;
  scoreboard: boolean;
  canInteract: boolean;
  interactLabel: string;
  position: Point;
  touch: boolean;
  onEquip: () => void;
  onInteract: (held: boolean) => void;
  onScoreboard: (held: boolean) => void;
  onNextRound: () => void;
  onRematch: () => void;
}

const teamName = (team: 'attackers' | 'defenders') => team === 'attackers' ? 'ATTACKERS' : 'DEFENDERS';
const clock = (seconds: number) => `${Math.floor(Math.max(0, Math.ceil(seconds)) / 60)}:${String(Math.max(0, Math.ceil(seconds)) % 60).padStart(2, '0')}`;
const mapPoint = (point: Point) => ({ x: 12 + (point.x + 27) / 54 * 156, y: 168 - (point.z + 20) / 50 * 156 });

/** A read-only view of rule snapshots. No UI timer decides a round outcome. */
export default function ObjectiveHud({ snapshot, controlledId, objectiveEquipped, interactHeld, scoreboard, canInteract, interactLabel, position, touch, onEquip, onInteract, onScoreboard, onNextRound, onRematch }: ObjectiveHudProps) {
  const pointer = useRef<number | null>(null);
  const interactCallback = useRef(onInteract);
  const scoreboardCallback = useRef(onScoreboard);
  interactCallback.current = onInteract;
  scoreboardCallback.current = onScoreboard;
  useEffect(() => () => {
    pointer.current = null;
    interactCallback.current(false);
    scoreboardCallback.current(false);
  }, []);

  const player = snapshot.players.find(item => item.id === controlledId);
  const carrier = snapshot.players.find(item => item.id === snapshot.carrierId);
  const interaction = snapshot.interaction?.playerId === controlledId ? snapshot.interaction : null;
  const progress = Math.max(0, Math.min(1, interaction?.progress ?? 0));
  const carried = snapshot.carrierId === controlledId && snapshot.coreState === 'carried';
  const live = snapshot.phase === 'combat' || snapshot.phase === 'planted';
  const corePosition = snapshot.coreState === 'carried' ? carrier?.position : snapshot.corePosition;
  const coreMap = corePosition ? mapPoint(corePosition) : null;
  const actorMap = mapPoint(position);
  const phaseLabel = snapshot.phase === 'planted' ? 'CORE ACTIVE' : snapshot.phase === 'result' ? 'ROUND RESOLVED' : snapshot.phase === 'transition' ? 'NEXT ROUND' : `${snapshot.phase.toUpperCase()} PHASE`;
  const phaseNote = snapshot.phase === 'buy' ? 'B · ARMORY / EQUIP YOUR KIT' : snapshot.phase === 'planted' ? `${snapshot.plantedSite ?? ''} SITE · DEFENDERS MUST DEFUSE` : snapshot.phase === 'combat' ? (player?.team === 'attackers' ? 'ARM THE ROYAL SIGNAL CORE' : 'PREVENT THE SIGNAL') : 'LOCAL OBJECTIVE SANDBOX';

  function hold(event: PointerEvent<HTMLButtonElement>, held: boolean) {
    if (held && (pointer.current !== null || !canInteract)) return;
    if (!held && pointer.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    pointer.current = held ? event.pointerId : null;
    if (held) event.currentTarget.setPointerCapture(event.pointerId);
    else if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onInteract(held);
  }

  return <div className={`objective-hud ${touch ? 'objective-touch' : ''}`}>
    <div className={`objective-round-clock phase-${snapshot.phase}`} aria-label={`${phaseLabel}, ${clock(snapshot.remaining)} remaining`}>
      <span className="objective-team-score attackers"><small>ATK</small><b>{snapshot.scores.attackers}</b></span>
      <div><small>{phaseLabel}</small><strong>{clock(snapshot.remaining)}</strong><span>{phaseNote}</span></div>
      <span className="objective-team-score defenders"><small>DEF</small><b>{snapshot.scores.defenders}</b></span>
    </div>

    <div className="objective-minimap" aria-label={`Fortress minimap. Royal Signal Core ${snapshot.coreState}${snapshot.plantedSite ? ` at ${snapshot.plantedSite}` : ''}`}>
      <div><Radio size={10} /><span>AEYAR / SIGNAL GRID</span></div>
      <svg viewBox="0 0 180 180" role="img" aria-label="Sites, core and controlled player">
        <path className="objective-map-floor" d="M12 12H168V168H12Z" />
        <path className="objective-map-wall" d="M12 12H168V168H12ZM12 32H70M110 32H168M12 81H44M72 81H84M106 101H124M154 101H168M12 111H26M57 111H62" />
        <path className="objective-map-lane" d="M90 162V45M39 114V84M145 126V86" />
        {OBJECTIVE_SITES.map(({ id: site, position: sitePosition }) => {
          const point = mapPoint(sitePosition);
          const active = snapshot.config.activeSite === 'both' || snapshot.config.activeSite === site;
          return <g key={site} className={`objective-map-site ${active ? 'active' : ''}`}><circle cx={point.x} cy={point.y} r="17" /><text x={point.x} y={point.y + 4}>{site}</text></g>;
        })}
        {snapshot.players.filter(item => item.id !== controlledId && item.connected && item.alive).map(item => {
          const point = mapPoint(item.position);
          return <circle key={item.id} className={`objective-map-actor ${item.team}`} cx={point.x} cy={point.y} r="3" />;
        })}
        {coreMap && <g className={`objective-map-core ${snapshot.coreState}`} transform={`translate(${coreMap.x} ${coreMap.y})`}><circle r="8" /><path d="M0-4 4 0 0 4-4 0Z" /></g>}
        <g className="objective-map-player" transform={`translate(${actorMap.x} ${actorMap.y})`}><circle r="5" /><path d="M0-10 4-5H-4Z" /></g>
      </svg>
      <small><i /> YOU <b>◇</b> CORE <span>{snapshot.config.activeSite === 'both' ? 'A + B ACTIVE' : `${snapshot.config.activeSite} ONLY`}</span></small>
    </div>

    <div className="objective-role-tag"><Flag size={12} /><span>{player ? teamName(player.team) : 'SPECTATOR'}</span><small>{player?.name ?? 'LOCAL'}</small></div>
    <button className="objective-scoreboard-button" aria-label="Toggle scoreboard" aria-pressed={scoreboard} onClick={event => { event.stopPropagation(); onScoreboard(!scoreboard); }}><Users size={15} /><span>SCOREBOARD</span>{!touch && <kbd>TAB</kbd>}</button>

    {carried && <button className={`objective-equip ${objectiveEquipped ? 'equipped' : ''}`} aria-label="Equip Royal Signal Core" aria-pressed={objectiveEquipped} disabled={!player?.alive || snapshot.phase === 'result' || snapshot.phase === 'transition'} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onEquip(); }}><Radio size={18} /><span>{objectiveEquipped ? 'CORE EQUIPPED' : 'EQUIP CORE'}<small>ROYAL SIGNAL CORE</small></span><kbd>4</kbd></button>}

    {live && player?.alive && (canInteract || interaction || interactHeld || objectiveEquipped || snapshot.phase === 'planted') && <div className={`objective-interaction ${interaction ? 'working' : ''}`}>
      <svg className="objective-progress" viewBox="0 0 64 64" aria-hidden="true"><circle className="track" cx="32" cy="32" r="28" /><circle className="fill" cx="32" cy="32" r="28" strokeDasharray={Math.PI * 56} strokeDashoffset={Math.PI * 56 * (1 - progress)} /><path d="M32 21V43M21 32H43" /></svg>
      <button className={`objective-interact-button ${interactHeld ? 'held' : ''}`} disabled={!canInteract && !interactHeld} aria-label={interactLabel || 'Hold to interact with core'} aria-pressed={interactHeld} onPointerDown={event => hold(event, true)} onPointerUp={event => hold(event, false)} onPointerCancel={event => hold(event, false)} onLostPointerCapture={event => hold(event, false)} onContextMenu={event => event.preventDefault()} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat && canInteract) { event.preventDefault(); event.stopPropagation(); onInteract(true); } }} onKeyUp={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onInteract(false); } }} onBlur={() => onInteract(false)}>
        <span>{interaction ? `${interaction.kind === 'plant' ? 'ARMING' : 'DEFUSING'} · ${Math.round(progress * 100)}%` : interactLabel || 'APPROACH THE CORE'}</span><small>{canInteract ? `HOLD ${touch ? 'TO INTERACT' : 'F TO INTERACT'} · RELEASE TO CANCEL` : snapshot.phase === 'planted' ? player.team === 'attackers' ? 'PROTECT THE SIGNAL UNTIL THE COUNTDOWN EXPIRES' : 'MOVE WITHIN RANGE TO DEFUSE' : player.team === 'attackers' ? 'CARRY THE CORE INTO AN ACTIVE SITE' : 'APPROACH THE PLANTED CORE'}</small>
      </button>
    </div>}

    {!player?.alive && snapshot.phase !== 'result' && <div className="objective-eliminated"><Shield size={17} /><strong>YOU ARE ELIMINATED</strong><span>Esc → Sandbox controls to observe another role.</span></div>}
    {snapshot.message && !interaction && snapshot.phase !== 'result' && <div className="objective-message" role="status">{snapshot.message}</div>}

    {scoreboard && <div className="objective-scoreboard" role="dialog" aria-label="Local objective scoreboard"><header><div><span>LOCAL OBJECTIVE SANDBOX</span><h2>ROYAL SIGNAL CORE</h2></div><button aria-label="Close scoreboard" onClick={() => onScoreboard(false)}><X size={19} /></button></header><div className="objective-score-summary"><span>ROUND {snapshot.round}</span><strong>{snapshot.scores.attackers} <small>ATTACKERS / DEFENDERS</small> {snapshot.scores.defenders}</strong><span>{snapshot.config.format}</span></div>{(['attackers', 'defenders'] as const).map(team => <section key={team} className={`objective-score-team ${team}`}><h3>{teamName(team)}</h3>{snapshot.players.filter(item => item.team === team).map(item => <div className={`objective-score-row ${item.id === controlledId ? 'you' : ''}`} key={item.id}><span><b>{item.name}</b>{item.id === controlledId && <small>YOU</small>}{item.id === snapshot.carrierId && <Radio size={13} />}</span><span>{!item.connected ? 'DISCONNECTED' : item.alive ? 'ACTIVE' : 'ELIMINATED'}</span><strong>{item.health} <Heart size={10} /></strong></div>)}</section>)}<footer>Offline drill · all roles are simulated locally. Esc opens role and rule test controls.</footer></div>}

    {(snapshot.phase === 'result' || snapshot.phase === 'transition') && <div className="objective-result" role="status"><section><Radio size={26} /><span className="objective-result-eyebrow">ROYAL SIGNAL CORE / ROUND {snapshot.round}</span><h2>{snapshot.result ? `${teamName(snapshot.result.winner)} WIN` : 'NEXT ROUND'}</h2><p>{snapshot.result?.reason.replace(/[-_]/g, ' ') ?? 'Preparing the fortress for the next deployment.'}</p><div className="objective-result-score"><span>ATTACKERS <b>{snapshot.scores.attackers}</b></span><i /> <span>DEFENDERS <b>{snapshot.scores.defenders}</b></span></div>{snapshot.phase === 'result' && <div className="objective-result-actions"><button onClick={onNextRound}>NEXT ROUND <ArrowRight size={16} /></button><button onClick={onRematch}><RotateCcw size={14} /> REMATCH</button></div>}<small>LOCAL SANDBOX · NEXT ROUND OR REMATCH TO CONTINUE</small></section></div>}
  </div>;
}

interface SandboxPanelProps {
  snapshot: ObjectiveSnapshot;
  controlledId: string;
  onControl: (id: string) => void;
  onDisconnect: (id: string) => void;
  onDamage: () => void;
  onTravel: (site: 'A' | 'B') => void;
  onConfigure: (config: ObjectiveConfig) => void;
  onRematch: () => void;
}

/** Explicit offline test tools; these never present local role control as multiplayer. */
export function ObjectiveSandboxPanel({ snapshot, controlledId, onControl, onDisconnect, onDamage, onTravel, onConfigure, onRematch }: SandboxPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [config, setConfig] = useState<ObjectiveConfig>(snapshot.config);
  useEffect(() => { setConfig(snapshot.config); }, [snapshot.config.format, snapshot.config.activeSite]);
  const player = snapshot.players.find(item => item.id === controlledId);
  return <section className="objective-sandbox-panel">
    <button className="objective-sandbox-heading" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><span><Radio size={15} /> LOCAL OBJECTIVE SANDBOX</span><ChevronDown size={16} className={expanded ? 'expanded' : ''} /></button>
    {expanded && <div className="objective-sandbox-content"><p>Control each role to test plant, defuse and round rules. Timers pause with this menu. No online players or server.</p><label>CONTROLLED ROLE</label><div className="objective-role-options">{snapshot.players.map(item => <button key={item.id} disabled={!item.connected} className={controlledId === item.id ? 'selected' : ''} aria-pressed={controlledId === item.id} onClick={() => onControl(item.id)}><span>{item.name}</span><small>{teamName(item.team)} · {item.alive ? `${item.health} HP` : 'ELIMINATED'}</small></button>)}</div>
      <div className="objective-test-actions"><button disabled={!player?.alive} onClick={() => onTravel('A')}><MapPin size={13} /> TRAVEL A</button><button disabled={!player?.alive} onClick={() => onTravel('B')}><MapPin size={13} /> TRAVEL B</button><button disabled={!player?.alive} onClick={onDamage}><Heart size={13} /> TAKE 20 DAMAGE</button><button disabled={!player?.connected} onClick={() => onDisconnect(controlledId)}><X size={13} /> DISCONNECT ROLE</button></div>
      <div className="objective-config"><label>LOCAL HOST FORMAT<select aria-label="Local sandbox match format" value={config.format} onChange={event => setConfig(value => ({ ...value, format: event.target.value as ObjectiveConfig['format'] }))}><option value="1v1">1 attacker / 1 defender</option><option value="2v1">2 attackers / 1 defender</option></select></label><label>ACTIVE SITE<select aria-label="Active objective site" value={config.activeSite} onChange={event => setConfig(value => ({ ...value, activeSite: event.target.value as ObjectiveConfig['activeSite'] }))}><option value="both">Both A and B</option><option value="A">A only</option><option value="B">B only</option></select></label></div>
      <div className="objective-config-actions"><button onClick={() => onConfigure(config)}>APPLY & RESET MATCH <ArrowRight size={13} /></button><button onClick={onRematch}><RotateCcw size={13} /> REMATCH</button></div><small className="objective-sandbox-note">Buy 20s · combat 100s · plant 4s · countdown 35s · defuse 6s. Resume after switching roles or travelling.</small>
    </div>}
  </section>;
}
