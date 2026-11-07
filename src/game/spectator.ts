import type { OnlineSnapshot, Point3 } from '../network/protocol';

type Team = 'attackers' | 'defenders';
interface Candidate { id: string; name: string }
export interface SpectatorPose { position: Point3; yaw: number; pitch: number }

/** Presentation-only target selection. Authority still owns life, position and
 * input eligibility; this controller never equips a player or changes a collider. */
export class SpectatorController {
  private enabled = false;
  private selectedId: string | null = null;
  private candidates: Candidate[] = [];
  private team: Team | null = null;
  private roundKey = '';

  get active(): boolean { return this.enabled; }
  get targetId(): string | null { return this.selectedId; }
  get targetName(): string { return this.candidates.find(candidate => candidate.id === this.selectedId)?.name ?? ''; }
  get canCycle(): boolean { return this.enabled && this.candidates.length > 1; }
  get fallbackTeam(): Team | null { return this.team; }

  receive(snapshot: OnlineSnapshot, controlledId: string): void {
    const self = snapshot.players.find(player => player.id === controlledId);
    if (!self || !self.connected || self.alive || !['match', 'finished'].includes(snapshot.stage)) {
      this.reset();
      return;
    }
    const roundKey = `${snapshot.matchId ?? ''}:${snapshot.objective?.epoch}:${snapshot.objective?.round}`;
    if (roundKey !== this.roundKey) this.selectedId = null;
    this.roundKey = roundKey;
    this.enabled = true;
    this.team = self.team;
    this.candidates = snapshot.players
      .filter(player => player.id !== controlledId && player.team === self.team && player.connected && player.alive)
      .map(player => ({ id: player.id, name: player.name }))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!this.candidates.some(candidate => candidate.id === this.selectedId)) {
      this.selectedId = this.candidates[0]?.id ?? null;
    }
  }

  cycle(direction: number): void {
    if (!this.canCycle || !Number.isFinite(direction) || direction === 0) return;
    const index = this.candidates.findIndex(candidate => candidate.id === this.selectedId);
    const next = (index + (direction < 0 ? -1 : 1) + this.candidates.length) % this.candidates.length;
    this.selectedId = this.candidates[next].id;
  }

  reset(): void {
    this.enabled = false;
    this.selectedId = null;
    this.candidates = [];
    this.team = null;
    this.roundKey = '';
  }
}

/** No living ally means a fixed team-side view, never an opponent's camera. */
export function fallbackSpectatorPose(team: Team | null): SpectatorPose {
  return {
    position: { x: 0, y: 3, z: team === 'defenders' ? 22 : -14 },
    yaw: team === 'defenders' ? Math.PI : 0,
    pitch: .08,
  };
}
