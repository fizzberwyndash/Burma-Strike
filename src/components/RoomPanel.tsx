import { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, Crown, Flag, LogOut, Radio, RefreshCw, Users } from 'lucide-react';
import type { OnlineClient, ConnectionState } from '../network/client';
import { normalizeGuestName } from '../network/client';
import type { MatchConfiguration } from '../network/protocol';
import { useI18n } from '../i18n';

interface Props {
  client: OnlineClient | null;
  connection: ConnectionState;
  initialView: 'create' | 'join';
  onLeave: () => void;
  onResume: () => void;
}

const validUsername = (value: string) => { try { normalizeGuestName(value); return true; } catch { return false; } };
const defaultConfig: MatchConfiguration = { mapId: 'bagan-old-city', rounds: 5, activeSite: 'both' };

/** The lobby displays server snapshots and sends intents; it never assigns teams,
 * changes credits or declares a match started on the client. */
export default function RoomPanel({ client, connection, initialView, onLeave, onResume }: Props) {
  const { t } = useI18n();
  const [view, setView] = useState(initialView);
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem('burma-strike-guest') ?? ''; } catch { return ''; }
  });
  const [code, setCode] = useState('');
  const [feedback, setFeedback] = useState('');
  const snapshot = connection.snapshot;
  const [config, setConfig] = useState<MatchConfiguration>(snapshot?.config ?? defaultConfig);
  useEffect(() => { setView(initialView); }, [initialView]);
  useEffect(() => {
    if (snapshot) setConfig(snapshot.config);
  }, [snapshot?.config.mapId, snapshot?.config.rounds, snapshot?.config.activeSite]);
  const busy = connection.status === 'connecting' || connection.status === 'reconnecting';
  const connected = snapshot?.players.filter(player => player.connected) ?? [];
  const self = snapshot?.players.find(player => player.id === connection.sessionId);
  const host = snapshot?.players.find(player => player.id === snapshot.hostId);
  const isHost = snapshot?.hostId === connection.sessionId;
  const attackers = connected.filter(player => player.team === 'attackers').length;
  const defenders = connected.filter(player => player.team === 'defenders').length;
  const everyoneReady = connected.length >= 2 && connected.every(player => player.ready);
  const canStart = !!isHost && connection.status === 'connected' && snapshot?.stage === 'lobby' && everyoneReady && attackers > 0 && defenders > 0;
  const configValid = Number.isInteger(config.rounds) && config.rounds >= 1 && config.rounds <= 30;
  const configurationChanged = snapshot && (snapshot.config.rounds !== config.rounds || snapshot.config.activeSite !== config.activeSite);

  async function connect() {
    if (!client || busy || !validUsername(username) || (view === 'join' && !/^[A-Z0-9]{6}$/.test(code))) return;
    setFeedback('');
    try { localStorage.setItem('burma-strike-guest', username.trim()); } catch { /* Session remains usable without storage. */ }
    if (view === 'create') await client.create(username.trim());
    else await client.join(code, username.trim());
  }
  async function copyCode() {
    if (!snapshot) return;
    try { await navigator.clipboard.writeText(snapshot.code); setFeedback('ROOM CODE COPIED'); }
    catch { setFeedback('Select the room code and copy it manually.'); }
  }

  if (!snapshot) return <div className="custom-room-connect">
    <div className="custom-room-tabs" role="group" aria-label={t('Custom room action')}>
      <button className={view === 'create' ? 'selected' : ''} aria-pressed={view === 'create'} onClick={() => setView('create')}>{t('CREATE CUSTOM ROOM')}</button>
      <button className={view === 'join' ? 'selected' : ''} aria-pressed={view === 'join'} onClick={() => setView('join')}>{t('JOIN CUSTOM ROOM')}</button>
    </div>
    <p>{t('A private Royal Signal Core match for 2–10 guests. Share your room code with friends; rooms never appear in public matchmaking.')}</p>
    <form onSubmit={event => { event.preventDefault(); void connect(); }}>
      <label>{t('DISPLAY NAME')}<input className="guest-name-input" value={username} autoComplete="nickname" maxLength={20} aria-label={t('Display name')} placeholder={t('Your guest name')} onChange={event => setUsername(event.target.value)} disabled={busy} /></label>
      <small>{t('Use 2–20 letters, numbers, spaces, underscores or hyphens.')}</small>
      {view === 'join' && <label>{t('SIX-CHARACTER ROOM CODE')}<input className="room-code-input" value={code} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={6} aria-label={t('Room code')} placeholder="ABC234" onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} disabled={busy} /></label>}
      <button className="solid-button custom-connect-submit" type="submit" disabled={!client || busy || !validUsername(username) || (view === 'join' && !/^[A-Z0-9]{6}$/.test(code))}><Radio size={17} />{t(busy ? 'CONNECTING TO SERVER' : view === 'create' ? 'CREATE PRIVATE LOBBY' : 'JOIN PRIVATE LOBBY')}<ArrowRight size={17} /></button>
    </form>
    {connection.error && <div className="room-error" role="alert">{t(connection.error)}</div>}
    {connection.reconnectAvailable && <button className="outline-button reconnect-room" onClick={() => void client?.reconnect()} disabled={busy}><RefreshCw size={15} />{t('REJOIN PREVIOUS ROOM')}</button>}
    <div className="custom-room-footnote"><Users size={15} /><span>{t('Guest sessions only. A running BURMA STRIKE server is required; local Practice works independently.')}</span></div>
  </div>;

  return <div className={`custom-room-lobby stage-${snapshot.stage}`}>
    <div className="room-code-bar"><div><span>{t('PRIVATE ROOM CODE')}</span><div><input aria-label={t('Private room code')} readOnly value={snapshot.code} onFocus={event => event.currentTarget.select()} /><button className="copy-room-code" aria-label={t('Copy room code')} onClick={() => void copyCode()}><Copy size={17} /></button></div></div><div className="lobby-host"><Crown size={17} /><span>{t('HOST')}<strong>{host?.name ?? t('SELECTING HOST')}</strong></span></div><div className="lobby-population"><Users size={19} /><strong>{connected.length}<small>/ 10</small></strong><span>{t('CONNECTED')}</span></div></div>
    {(feedback || connection.error || busy) && <div className={connection.error ? 'room-error' : 'room-feedback'} role="status">{t(connection.error || (busy ? 'CONNECTION INTERRUPTED · RECONNECTING' : feedback))}</div>}
    <div className="lobby-teams">{(['attackers', 'defenders'] as const).map(team => {
      const players = snapshot.players.filter(player => player.team === team);
      return <section className={`lobby-team ${team}`} key={team}><header><Flag size={16} /><h3>{t(team === 'attackers' ? 'ATTACKERS' : 'DEFENDERS')}</h3><span>{players.length} / 5</span></header><div className="lobby-player-list">{players.map(player => <div className={`lobby-player ${player.id === connection.sessionId ? 'self' : ''} ${!player.connected ? 'reserved' : ''}`} key={player.id}>
        <span className="lobby-player-emblem">{player.name.slice(0, 1).toLocaleUpperCase()}</span><div className="lobby-player-name"><strong>{player.name}{player.id === snapshot.hostId && <Crown size={12} />}</strong><small>{t(!player.connected ? 'RECONNECTING · SEAT RESERVED' : player.id === connection.sessionId ? 'YOU' : 'GUEST PLAYER')}</small></div>
        <span className={`lobby-ready ${player.ready ? 'ready' : ''}`}>{player.ready && <Check size={12} />}{t(player.ready ? 'READY' : 'NOT READY')}</span>
        {isHost && snapshot.stage === 'lobby' && <select aria-label={t('Team for {name}', { name: player.name })} value={player.team} disabled={busy} onChange={event => client?.sendAction({ type: 'team', playerId: player.id, team: event.target.value as 'attackers' | 'defenders' })}><option value="attackers">{t('ATTACKERS')}</option><option value="defenders">{t('DEFENDERS')}</option></select>}
      </div>)}{players.length === 0 && <div className="lobby-empty-team">{t('WAITING FOR A PLAYER')}</div>}</div></section>;
    })}</div>
    {snapshot.stage === 'lobby' && <>
      <div className="lobby-config"><label>{t('GAME MAP')}<select aria-label={t('Game map')} value={config.mapId} disabled><option value="bagan-old-city">{t('BAGAN OLD CITY')}</option></select></label><label>{t('NUMBER OF ROUNDS')}<input aria-label={t('Number of rounds')} type="number" min={1} max={30} value={config.rounds} disabled={!isHost || busy} onChange={event => setConfig(value => ({ ...value, rounds: Number(event.target.value) }))} /></label><label>{t('ACTIVE SITES')}<select aria-label={t('Active sites')} value={config.activeSite} disabled={!isHost || busy} onChange={event => setConfig(value => ({ ...value, activeSite: event.target.value as MatchConfiguration['activeSite'] }))}><option value="both">{t('Both A and B')}</option><option value="A">{t('A only')}</option><option value="B">{t('B only')}</option></select></label>{isHost && <button className="outline-button apply-room-config" disabled={!configValid || !configurationChanged || busy} onClick={() => client?.sendAction({ type: 'configure', config })}>{t('APPLY ROOM SETTINGS')}</button>}</div>
      <div className="lobby-start-requirements"><span>{t('At least two connected players, one on each team, must all be ready. Team changes and room settings clear ready status.')}</span>{attackers > 0 && defenders > 0 && attackers !== defenders && <strong className="unbalanced-warning">{t('UNBALANCED TEAMS · HOST MAY STILL START')}</strong>}</div>
    </>}
    {snapshot.stage === 'finished' && <div className="lobby-match-complete"><h3>{t('MATCH COMPLETE')}</h3><strong>{snapshot.objective?.scores.attackers ?? 0} : {snapshot.objective?.scores.defenders ?? 0}</strong><p>{t('The server has completed the configured rounds. Return to the lobby to ready up for another match.')}</p></div>}
    {snapshot.stage === 'match' && <p className="lobby-live-note">{t('Your match is running. The server clock continues while this menu is open.')}</p>}
    <footer className="lobby-actions"><button className="outline-button leave-room" onClick={onLeave}><LogOut size={15} />{t('LEAVE ROOM')}</button>{snapshot.stage === 'lobby' ? <><button className={`outline-button ready-toggle ${self?.ready ? 'is-ready' : ''}`} aria-pressed={!!self?.ready} disabled={!self?.connected || busy} onClick={() => client?.sendAction({ type: 'ready', ready: !self?.ready })}><Check size={17} />{t(self?.ready ? 'CANCEL READY' : 'I AM READY')}</button>{isHost && <button className="solid-button start-online-match" disabled={!canStart || !!configurationChanged} onClick={() => client?.sendAction({ type: 'start' })}>{t('START MATCH')}<ArrowRight size={17} /></button>}</> : snapshot.stage === 'match' ? <button className="solid-button" onClick={onResume}>{t('RETURN TO MATCH')}<ArrowRight size={17} /></button> : isHost ? <button className="solid-button return-online-lobby" onClick={() => client?.sendAction({ type: 'return-lobby' })}>{t('RETURN TO LOBBY')}<ArrowRight size={17} /></button> : <span className="lobby-wait-host">{t('WAITING FOR HOST TO RETURN TO LOBBY')}</span>}</footer>
  </div>;
}
