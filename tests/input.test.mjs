import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function createInput() {
  const source=readFileSync(new URL('../src/game/input.ts',import.meta.url),'utf8');
  const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
  const owner=()=>({listeners:new Map(),addEventListener(n,f){this.listeners.set(n,f)},removeEventListener(n,f){if(this.listeners.get(n)===f)this.listeners.delete(n)}});
  const win=owner(),doc=owner(),canvas=owner();
  win.matchMedia=()=>({matches:false});doc.pointerLockElement=canvas;doc.exitPointerLock=()=>{doc.pointerLockElement=null};
  const sandbox={exports:{},window:win,document:doc};vm.runInNewContext(outputText,sandbox);
  const calls=[];
  const input=new sandbox.exports.GameInput(canvas,{onPause:()=>calls.push('pause'),onShoot:()=>calls.push('fire'),onReload:()=>calls.push('reload'),onJump:()=>calls.push('jump'),onSlot:n=>calls.push('slot'+n),onPrimaryCycle:()=>calls.push('cycle'),onInspect:()=>calls.push('inspect'),onAds:on=>calls.push('ads'+on),onShop:()=>calls.push('shop'),onInteract:held=>calls.push('interact'+held),onScoreboard:held=>calls.push('scoreboard'+held),onSpectatorCycle:direction=>calls.push('spectator'+direction)});
  const emit=(o,n,e={})=>{
    const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true},pointerType:'mouse',...e};
    o.listeners.get(n)?.(event);
    return event;
  };
  return {input,calls,emit,win,doc,canvas};
}

test('a result scoreboard stays open while the frame loop keeps gameplay disabled', () => {
  const {input,emit,win}=createInput();
  input.active=true;
  input.touchTrigger(true);input.touchAds(true);input.touchMove(1,0);input.touchInteract(true);
  input.active=false;
  assert.equal(input.fireHeld,false);
  assert.equal(input.adsHeld,false);
  assert.equal(input.interactHeld,false);
  assert.equal(input.moveX,0);
  // The read-only result UI opens the scoreboard even though combat is disabled.
  input.scoreboardHeld=true;
  for(let frame=0;frame<60;frame++) input.active=false;
  assert.equal(input.scoreboardHeld,true);
  input.touchTrigger(true);input.touchMove(1,1);input.touchInteract(true);
  assert.equal(input.fireHeld,false);
  assert.equal(input.interactHeld,false);
  assert.equal(input.moveX,0);
  emit(win,'blur');
  assert.equal(input.scoreboardHeld,false,'focus loss still releases the UI hold');
  input.scoreboardHeld=true;input.active=true;input.active=false;
  assert.equal(input.scoreboardHeld,false,'a genuine gameplay transition clears all input');
  input.scoreboardHeld=true;input.dispose();
  assert.equal(input.scoreboardHeld,false,'disposal still clears all input');
});

test('mouse, touch, ADS and keyboard paths share predictable input and fully release listeners', () => {
  const {input,calls,emit,win,doc,canvas}=createInput();
  input.active=true;
  emit(doc,'mousemove',{movementX:100,movementY:50});let look=input.consumeLook();
  assert.ok(Math.abs(look.x-.07)<1e-8&&Math.abs(look.y-.035)<1e-8);
  input.sensitivity=2;input.aimMultiplier=.5;input.invertY=true;
  emit(doc,'mousemove',{movementX:10,movementY:10});look=input.consumeLook();
  assert.ok(Math.abs(look.x-.02)<1e-8&&Math.abs(look.y+.02)<1e-8);
  input.touchSensitivity=1.5;input.touchLook(10,10);look=input.consumeLook();
  assert.ok(Math.abs(look.x-.03)<1e-8&&Math.abs(look.y+.03)<1e-8);
  input.touchLook(NaN,10);assert.equal(input.consumeLook().x,0);
  emit(canvas,'pointerdown',{button:0});assert.equal(input.fireHeld,true);
  emit(win,'pointerup',{button:0});assert.equal(input.fireHeld,false);
  input.touchTrigger(true);input.touchTrigger(true);
  assert.equal(calls.filter(x=>x==='fire').length,2);input.touchTrigger(false);
  emit(canvas,'pointerdown',{button:2});assert.equal(input.adsHeld,true);
  emit(win,'pointerup',{button:2});assert.equal(input.adsHeld,false);
  for(const code of ['Digit1','Digit4','KeyN','KeyV','KeyR','Space'])emit(win,'keydown',{code});
  for(const action of ['slot1','slot4','cycle','inspect','reload','jump'])assert.ok(calls.includes(action));
  for(const code of ['KeyW','KeyD','ShiftLeft'])emit(win,'keydown',{code});input.update();
  assert.ok(Math.abs(Math.hypot(input.moveX,input.moveY)-1)<1e-8);assert.equal(input.sprinting,true);
  input.touchTrigger(true);input.touchAds(true);emit(win,'blur');
  assert.equal(input.fireHeld,false);assert.equal(input.adsHeld,false);assert.equal(input.sprinting,false);
  assert.equal(input.moveX,0);assert.equal(input.moveY,0);assert.ok(calls.includes('pause'));
  // The overlay deliberately disables movement, but B/Escape must still close it.
  input.active=false;input.shopEnabled=true;input.shopOpen=true;
  emit(win,'keydown',{code:'KeyB'});emit(win,'keydown',{code:'KeyB',repeat:true});
  emit(win,'keydown',{code:'Escape'});emit(win,'keydown',{code:'KeyN'});
  assert.equal(calls.filter(x=>x==='shop').length,2);
  assert.equal(calls.filter(x=>x==='cycle').length,1);
  input.shopEnabled=false;input.shopOpen=false;
  emit(win,'keydown',{code:'KeyB'});emit(win,'keydown',{code:'Escape'});
  assert.equal(calls.filter(x=>x==='shop').length,2);
  input.active=true;input.touchTrigger(true);input.touchAds(true);input.touchMove(1,1);input.touchSprint(true);input.touchInteract(true);input.touchScoreboard(true);
  const pauseCount=calls.filter(x=>x==='pause').length;
  emit(doc,'pointerlockchange');
  input.active=false;input.releasePointerLock();
  // Controlled shop unlock may be delivered after the shop has already closed.
  input.active=true;emit(doc,'pointerlockchange');
  assert.equal(calls.filter(x=>x==='pause').length,pauseCount);
  assert.equal(input.fireHeld,false);assert.equal(input.adsHeld,false);assert.equal(input.sprinting,false);
  assert.equal(input.interactHeld,false);assert.equal(input.scoreboardHeld,false);
  assert.equal(input.moveX,0);assert.equal(input.moveY,0);
  input.dispose();assert.equal(win.listeners.size+doc.listeners.size+canvas.listeners.size,0);
});

test('objective and scoreboard holds release on keyup, overlays, focus loss and disposal', () => {
  const {input,calls,emit,win,doc,canvas}=createInput();
  const count=action=>calls.filter(value=>value===action).length;
  const holdBoth=()=>{input.touchInteract(true);input.touchScoreboard(true)};
  const released=()=>{assert.equal(input.interactHeld,false);assert.equal(input.scoreboardHeld,false)};
  input.active=true;
  emit(win,'keydown',{code:'KeyF'});
  assert.equal(input.interactHeld,true);
  emit(win,'keydown',{code:'KeyF',repeat:true});
  assert.equal(count('interacttrue'),1);
  assert.equal(count('inspect'),0);
  emit(win,'keydown',{code:'KeyV'});
  assert.equal(count('inspect'),1);
  emit(win,'keyup',{code:'KeyF'});
  assert.equal(input.interactHeld,false);
  assert.equal(count('interactfalse'),1);

  assert.equal(emit(win,'keydown',{code:'Tab'}).defaultPrevented,true);
  assert.equal(input.scoreboardHeld,true);
  assert.equal(emit(win,'keydown',{code:'Tab',repeat:true}).defaultPrevented,true);
  assert.equal(count('scoreboardtrue'),1);
  emit(win,'keyup',{code:'Tab'});
  assert.equal(input.scoreboardHeld,false);
  assert.equal(count('scoreboardfalse'),1);

  // Mobile holds notify only on edges and can be used at the same time.
  holdBoth();holdBoth();
  assert.equal(count('interacttrue'),2);
  assert.equal(count('scoreboardtrue'),2);
  input.touchInteract(false);input.touchScoreboard(false);
  input.touchInteract(false);input.touchScoreboard(false);
  assert.equal(count('interactfalse'),2);
  assert.equal(count('scoreboardfalse'),2);

  holdBoth();input.active=false;released();
  const callsAfterDisable=calls.length;
  input.touchInteract(true);input.touchScoreboard(true);
  emit(win,'keydown',{code:'KeyF'});
  assert.equal(emit(win,'keydown',{code:'Tab'}).defaultPrevented,false);
  // A late key release while inactive must remain safe and idempotent.
  emit(win,'keyup',{code:'KeyF'});emit(win,'keyup',{code:'Tab'});
  released();assert.equal(calls.length,callsAfterDisable);

  input.active=true;holdBoth();input.shopOpen=true;released();
  const callsAfterShop=calls.length;
  input.touchInteract(true);input.touchScoreboard(true);
  emit(win,'keydown',{code:'KeyF'});
  assert.equal(emit(win,'keydown',{code:'Tab'}).defaultPrevented,false);
  assert.equal(calls.length,callsAfterShop);
  input.shopOpen=false;

  holdBoth();emit(win,'blur');released();
  assert.equal(count('pause'),1);
  input.active=false;input.active=true;
  holdBoth();doc.hidden=true;emit(doc,'visibilitychange');released();
  assert.equal(count('pause'),2);
  doc.hidden=false;input.active=false;input.active=true;
  holdBoth();emit(win,'keydown',{code:'Escape'});released();
  assert.equal(count('pause'),3);

  input.active=false;input.active=true;holdBoth();
  input.dispose();released();
  assert.equal(win.listeners.size+doc.listeners.size+canvas.listeners.size,0);
  const callsAfterDispose=calls.length;
  input.touchInteract(true);input.touchScoreboard(true);
  assert.equal(calls.length,callsAfterDispose);
});


test('spectator Q/E cycle controls are independent of movement and ignore repeats while preserving cleanup', () => {
  const {input,calls,emit,win}=createInput();
  input.active=true;
  emit(win,'keydown',{code:'KeyQ'});emit(win,'keydown',{code:'KeyQ',repeat:true});
  emit(win,'keyup',{code:'KeyQ'});emit(win,'keydown',{code:'KeyE'});
  assert.deepEqual(calls.filter(value=>value.startsWith('spectator')),['spectator-1','spectator1']);
  input.update();assert.equal(input.moveX,0);assert.equal(input.moveY,0);
  input.active=false;emit(win,'keydown',{code:'KeyE'});
  assert.equal(calls.filter(value=>value==='spectator1').length,1);
  input.dispose();
});
