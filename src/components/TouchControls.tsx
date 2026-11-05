import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowUp, Crosshair, RotateCw } from 'lucide-react';
import type { GameInput } from '../game/input';

interface TouchControlsProps {
  input: GameInput;
  onShoot: () => void;
  onReload: () => void;
  onJump: () => void;
}

/** Each control owns its pointer, allowing movement, aiming and firing together. */
export default function TouchControls({ input, onShoot, onReload, onJump }: TouchControlsProps) {
  const movePointer = useRef<number | null>(null);
  const aimPointer = useRef<number | null>(null);
  const aimPosition = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  useEffect(() => () => {
    movePointer.current = null;
    aimPointer.current = null;
    input.touchMove(0, 0);
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
      <button className="touch-button shoot" type="button" aria-label="Shoot" style={{ touchAction: 'none' }} onPointerDown={event => action(event, onShoot)}>
        <Crosshair aria-hidden="true" size={28} />
        <span>FIRE</span>
      </button>
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
