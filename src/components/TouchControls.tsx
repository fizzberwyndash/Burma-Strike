import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowUp, Crosshair, RotateCw, ScanLine, Footprints, Search } from 'lucide-react';
import type { GameInput } from '../game/input';

interface TouchControlsProps {
  input: GameInput;
  onShoot: () => void;
  onReload: () => void;
  onJump: () => void;
  onSlot?: (slot: number) => void;
  onInspect?: () => void;
  onPrimaryCycle?: () => void;
  slot?: number;
  primaryName?: string;
  ownedSlots?: readonly number[];
}

/** Each control owns its pointer, allowing movement, aiming and firing together. */
export default function TouchControls({ input, onReload, onJump, onSlot, onInspect, onPrimaryCycle, slot = 2, primaryName = 'RIFLE', ownedSlots }: TouchControlsProps) {
  const movePointer = useRef<number | null>(null);
  const aimPointer = useRef<number | null>(null);
  const firePointer = useRef<number | null>(null);
  const adsPointer = useRef<number | null>(null);
  const sprintPointer = useRef<number | null>(null);
  const [ads, setAds] = useState(false);
  const [sprinting, setSprinting] = useState(false);
  const aimPosition = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  useEffect(() => () => {
    movePointer.current = null;
    aimPointer.current = null;
    input.touchMove(0, 0);
    input.touchTrigger(false);
    input.touchAds(false);
    input.touchSprint(false);
  }, [input]);

  function moveJoystick(event: PointerEvent<HTMLDivElement>) {
    if (movePointer.current !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.32);
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    const scale = Math.max(1, Math.hypot(dx, dy) / radius);
    const x = dx / scale;
    const y = dy / scale;
    setKnob({ x, y });
    input.touchMove(x / radius, -y / radius);
  }

  function startJoystick(event: PointerEvent<HTMLDivElement>) {
    if (movePointer.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    movePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveJoystick(event);
  }

  function stopJoystick(event: PointerEvent<HTMLDivElement>) {
    if (movePointer.current !== event.pointerId) return;
    movePointer.current = null;
    setKnob({ x: 0, y: 0 });
    input.touchMove(0, 0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function startAim(event: PointerEvent<HTMLDivElement>) {
    if (aimPointer.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    aimPointer.current = event.pointerId;
    aimPosition.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveAim(event: PointerEvent<HTMLDivElement>) {
    if (aimPointer.current !== event.pointerId) return;
    const previous = aimPosition.current;
    input.touchLook(event.clientX - previous.x, event.clientY - previous.y);
    aimPosition.current = { x: event.clientX, y: event.clientY };
  }

  function stopAim(event: PointerEvent<HTMLDivElement>) {
    if (aimPointer.current !== event.pointerId) return;
    aimPointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function action(event: PointerEvent<HTMLButtonElement>, callback: () => void) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    callback();
  }

  type HeldAction = 'fire' | 'ads' | 'sprint';
  function heldAction(event: PointerEvent<HTMLButtonElement>, kind: HeldAction, held: boolean) {
    const pointer = kind === 'fire' ? firePointer : kind === 'ads' ? adsPointer : sprintPointer;
    if (held && pointer.current !== null) return;
    if (!held && pointer.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    pointer.current = held ? event.pointerId : null;
    if (held) event.currentTarget.setPointerCapture(event.pointerId);
    else if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (kind === 'fire') input.touchTrigger(held);
    if (kind === 'ads') { input.touchAds(held); setAds(held); }
    if (kind === 'sprint') { input.touchSprint(held); setSprinting(held); }
  }

  const holdHandlers = (kind: HeldAction) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => heldAction(event, kind, true),
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => heldAction(event, kind, false),
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => heldAction(event, kind, false),
    onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => heldAction(event, kind, false),
  });

  return (
    <div className="touch-controls" style={{ touchAction: 'none' }} onContextMenu={event => event.preventDefault()}>
      <div
        className="touch-aim-zone"
        aria-label="Drag to aim"
        style={{ touchAction: 'none' }}
        onPointerDown={startAim}
        onPointerMove={moveAim}
        onPointerUp={stopAim}
        onPointerCancel={stopAim}
        onLostPointerCapture={stopAim}
      />
      <div
        className="joystick"
        role="group"
        aria-label="Movement joystick"
        style={{ touchAction: 'none' }}
        onPointerDown={startJoystick}
        onPointerMove={moveJoystick}
        onPointerUp={stopJoystick}
        onPointerCancel={stopJoystick}
        onLostPointerCapture={stopJoystick}
      >
        <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <button className="touch-button shoot" type="button" aria-label="Shoot" style={{ touchAction: 'none' }} {...holdHandlers('fire')}>
        <Crosshair aria-hidden="true" size={28} />
        <span>FIRE</span>
      </button>
      <button className={`touch-button ads ${ads ? 'held' : ''}`} type="button" aria-label="Aim down sights" aria-pressed={ads} {...holdHandlers('ads')}>
        <ScanLine aria-hidden="true" size={22} /><span>ADS</span>
      </button>
      <button className={`touch-button sprint ${sprinting ? 'held' : ''}`} type="button" aria-label="Sprint" aria-pressed={sprinting} {...holdHandlers('sprint')}>
        <Footprints aria-hidden="true" size={21} /><span>SPRINT</span>
      </button>
      <div className="touch-weapon-slots" aria-label="Weapon inventory">
        {[1, 2, 3].map(value => <button type="button" key={value} className={slot === value ? 'active' : ''} aria-label={`Equip slot ${value}`} aria-pressed={slot === value} disabled={ownedSlots !== undefined && !ownedSlots.includes(value)} onPointerDown={event => action(event, () => onSlot?.(value))}>
          <b>{value}</b><span>{value === 1 ? primaryName : value === 2 ? 'PISTOL' : 'KNIFE'}</span>
        </button>)}
        <button type="button" className="touch-primary-cycle" aria-label="Change primary weapon" onPointerDown={event => action(event, () => onPrimaryCycle?.())}><RotateCw size={13} /><span>LOADOUT</span></button>
        <button type="button" className="touch-inspect" aria-label="Inspect weapon" onPointerDown={event => action(event, () => onInspect?.())}><Search size={14} /><span>INSPECT</span></button>
      </div>
      <button className="touch-button reload" type="button" aria-label="Reload" style={{ touchAction: 'none' }} onPointerDown={event => action(event, onReload)}>
        <RotateCw aria-hidden="true" size={21} />
        <span>RELOAD</span>
      </button>
      <button className="touch-button jump" type="button" aria-label="Jump" style={{ touchAction: 'none' }} onPointerDown={event => action(event, onJump)}>
        <ArrowUp aria-hidden="true" size={23} />
        <span>JUMP</span>
      </button>
    </div>
  );
}
