import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Resolve the pure TS module graph in memory; no browser, server or third-party runner required.
const compiled = new Map();
async function sourceUrl(url) {
  if (compiled.has(url.href)) return compiled.get(url.href);
  let { outputText } = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  for (const match of [...outputText.matchAll(/from\s+(['"])(\.[^'"]+)\1/g)]) {
    const dependency = new URL(`${match[2].replace(/\.ts$/, '')}.ts`, url);
    const replacement = await sourceUrl(dependency);
    outputText = outputText.replace(match[0], `from ${JSON.stringify(replacement)}`);
  }
  const dataUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
  compiled.set(url.href, dataUrl);
  return dataUrl;
}
const { ObjectiveSession } = await import(await sourceUrl(new URL('../src/game/objectiveSession.ts', import.meta.url)));
const intent = (s, type, id, actor='attacker-1', host=false) => s.authority.dispatch({id, type, round:s.snapshot.round, epoch:s.snapshot.epoch},actor,host);

test('objective adapter closes buying at20 and keeps armor/HP consistent without early loss payouts', () => {
  const s=new ObjectiveSession();const e=s.economyFor('attacker-1');
  e.execute({type:'buy',itemId:'light-armor'});
  s.advance(19.99);assert.equal(e.snapshot.phase,'buy');
  s.advance(.01);assert.equal(e.snapshot.phase,'live');
  assert.equal(s.damage('attacker-1',40,'hit1'),true);
  assert.equal(s.snapshot.players[0].health,84);assert.equal(e.snapshot.armor,1);
  assert.equal(s.damage('attacker-1',40,'hit1'),false);
  assert.equal(s.snapshot.players[0].health,84);
  assert.equal(e.snapshot.credits,350);
});

test('postplant dead attackers can still win, and payouts happen exactly once for the actual result', () => {
 const s=new ObjectiveSession();s.advance(20);
 s.authority.updatePosition('attacker-1',{x:-19,y:.86,z:4.5});s.authority.equipCore('attacker-1',true);
 assert.equal(intent(s,'interact-start','plant').ok,true);s.advance(4);
 assert.equal(s.snapshot.phase,'planted');
 s.damage('attacker-1',100,'kill');
 assert.equal(s.snapshot.phase,'planted');assert.equal(s.economyFor('attacker-1').snapshot.phase,'live');
 s.advance(35);assert.equal(s.snapshot.result.winner,'attackers');
 assert.equal(s.economyFor('attacker-1').snapshot.credits,3800);
 assert.equal(s.economyFor('defender-1').snapshot.credits,2700);
 s.sync();s.sync();assert.equal(s.economyFor('attacker-1').snapshot.credits,3800);
});

test('next rounds retain purchases and credits; rematches reset the isolated economy and roster', () => {
 const s=new ObjectiveSession();const e=s.economyFor('attacker-1');e.execute({type:'buy',itemId:'pistol'});
 s.advance(120);assert.equal(s.snapshot.result.winner,'defenders');assert.equal(e.snapshot.credits,2350);
 intent(s,'next-round','next','attacker-1',true);s.advance(1);
 assert.equal(s.snapshot.phase,'buy');assert.equal(s.snapshot.round,2);
 assert.equal(s.economyFor('attacker-1').snapshot.credits,2350);
 assert.equal(s.inventoryFor('attacker-1').owns('pistol'),true);
 assert.equal(s.inventoryFor('attacker-1').activeId,'pistol');
 intent(s,'rematch','again','attacker-1',true);s.advance(1);
 assert.equal(s.snapshot.round,1);assert.equal(s.economyFor('attacker-1').snapshot.credits,800);
 assert.equal(s.inventoryFor('attacker-1').owns('pistol'),false);
});

test('trusted actor damage awards a kill and round outcome without duplicate money or friendly rewards', () => {
 const s=new ObjectiveSession({format:'2v1'});s.advance(20);
 const a=s.economyFor('attacker-1');
 s.damage('defender-1',100,'kill-def','attacker-1');
 assert.equal(s.snapshot.result.winner,'attackers');assert.equal(a.snapshot.credits,4000);
 s.damage('defender-1',100,'kill-def','attacker-1');s.sync();assert.equal(a.snapshot.credits,4000);
});
