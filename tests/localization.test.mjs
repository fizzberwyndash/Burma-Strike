import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Compile the presentation helper and pure rules without mounting React or a scene.
const compiled = new Map();
async function sourceUrl(url) {
  if (compiled.has(url.href)) return compiled.get(url.href);
  let { outputText } = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  for (const match of [...outputText.matchAll(/from\s+(['"])(\.[^'"]+)\1/g)]) {
    const dependency = new URL(`${match[2].replace(/\.ts$/, '')}.ts`, url);
    outputText = outputText.replace(match[0], `from ${JSON.stringify(await sourceUrl(dependency))}`);
  }
  const result = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
  compiled.set(url.href, result);
  return result;
}
const moduleAt = async path => import(await sourceUrl(new URL(path, import.meta.url)));
const { translate } = await moduleAt('../src/i18nCore.ts');
const { commonTranslations } = await moduleAt('../src/locales/common.ts');
const { gameplayTranslations } = await moduleAt('../src/locales/gameplay.ts');
const { multiplayerTranslations } = await moduleAt('../src/locales/multiplayer.ts');
const { SHOP_ITEMS } = await moduleAt('../src/game/catalog.ts');
const { PracticeEconomy } = await moduleAt('../src/game/economy.ts');
const { LocalObjectiveAuthority, OBJECTIVE_SITES } = await moduleAt('../src/game/objective.ts');
const dictionary = { ...commonTranslations, ...gameplayTranslations, ...multiplayerTranslations };
const my = (source, variables) => translate(source, 'my', variables);
const slots = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const assertMyanmar = text => {
  assert.match(text, /[\u1000-\u109f]/u, text);
  const withoutNames = text.replace(/BURMA STRIKE|LOTUS EDGE|SHWE-9|BAGAN-21|MUDON AR|NAGA SCOPE|WebGL|FPS|ESC|Esc|SHIFT|TAB/g, '');
  assert.doesNotMatch(withoutNames, /[A-Za-z]{2,}/, `Untranslated English: ${text}`);
  assert.doesNotMatch(text, /\{\w+\}/, `Unresolved interpolation: ${text}`);
};

test('all Myanmar phrases preserve interpolation and contain no accidental English copy', () => {
  for (const [source, phrase] of Object.entries(dictionary)) {
    assert.deepEqual(slots(phrase), slots(source), source);
    const values = Object.fromEntries(slots(source).map(key => [key, '၁၂']));
    assertMyanmar(my(source, values));
  }
});

test('English, missing phrases, zero values and inherited property names are safe', () => {
  assert.equal(translate('Armor {points} points', 'en', { points: 0 }), 'Armor 0 points');
  assert.equal(translate('An unknown phrase {value}', 'my', { value: '<b>literal</b>' }), 'An unknown phrase <b>literal</b>');
  assert.equal(my('constructor'), 'constructor');
  assert.equal(my('__proto__'), '__proto__');
  assert.equal(my('{constructor} {missing}'), '{constructor} {missing}');
  assert.equal(my('{health} HP', { health: 0 }), 'အသက် 0');
});

test('nested phase, objective progress and equipment templates translate immediately', () => {
  assert.equal(my('Practice round win: +3000 credits.'), 'လေ့ကျင့်ရေးပွဲစဉ် အနိုင်။ ခရက်ဒစ် +3000 ရရှိသည်။');
  assert.equal(my('Practice round loss: +1900 credits.'), 'လေ့ကျင့်ရေးပွဲစဉ် အရှုံး။ ခရက်ဒစ် +1900 ရရှိသည်။');
  assert.equal(my('Light Armor purchased for 450 credits.'), 'အပေါ့စား သံချပ်ကာ ကို ခရက်ဒစ် 450 ဖြင့် ဝယ်ပြီးပြီ။');
  assert.equal(my('SHWE-9 equipped.'), 'SHWE-9 ကို တပ်ဆင်ပြီးပြီ။');
  assert.equal(my('{phase} · {seconds}s', { phase: my('COMBAT'), seconds: 93 }), 'တိုက်ပွဲ · 93 စက္ကန့်');
  assert.equal(my('{action} · {percent}%', { action: my('DEFUSING'), percent: 65 }), 'ပိတ်နေသည် · 65%');
  assert.equal(my('PLANT AT B SITE'), 'B နေရာတွင် တပ်ဆင်ပါ');
});

test('actual purchase, insufficient funds, refund, armor damage and reward statuses translate', () => {
  const economy = new PracticeEconomy();
  const messages = [economy.snapshot.lastMessage];
  const act = command => {
    messages.push(economy.execute(command).message);
    assertMyanmar(my(economy.snapshot.phase.toUpperCase()));
  };
  act({ type: 'buy', itemId: 'rifle' });
  act({ type: 'buy', itemId: 'pistol' });
  act({ type: 'buy', itemId: 'light-armor' });
  act({ type: 'sell', itemId: 'light-armor' });
  act({ type: 'buy', itemId: 'light-armor' });
  act({ type: 'start-round' });
  act({ type: 'damage', amount: 40 });
  act({ type: 'elimination', eventId: 'localized-elimination' });
  act({ type: 'finish-round', outcome: 'win' });
  act({ type: 'new-round' });
  messages.forEach(message => { assert.notEqual(my(message), message); assertMyanmar(my(message)); });
  assert.equal(my('Practice damage: 16 HP, 24 armor consumed.'), 'စမ်းသပ်ထိခိုက်မှု၊ အသက် 16 နှင့် သံချပ်ကာ 24 လျော့သွားသည်။');
});

test('actual objective plant, cancellation, planted, defuse and victory statuses translate', () => {
  const game = new LocalObjectiveAuthority();
  let id = 0;
  const messages = [game.snapshot.message];
  const intent = (type, actor = 'attacker-1') => {
    const { round, epoch } = game.snapshot;
    const result = game.dispatch({ id: `localization-${++id}`, round, epoch, type }, actor);
    messages.push(result.message);
    return result;
  };
  game.advance(20); messages.push(game.snapshot.message);
  game.updatePosition('attacker-1', { ...OBJECTIVE_SITES[0].position, y: .85 });
  game.equipCore('attacker-1', true);
  assert.equal(intent('interact-start').ok, true);
  game.advance(1);
  intent('interact-stop');
  assert.equal(intent('interact-start').ok, true);
  game.advance(4); messages.push(game.snapshot.message);
  game.updatePosition('defender-1', { ...game.snapshot.corePosition, y: .85 });
  assert.equal(intent('interact-start', 'defender-1').ok, true);
  game.advance(6); messages.push(game.snapshot.message, game.snapshot.result.reason);
  messages.forEach(message => { assert.notEqual(my(message), message); assertMyanmar(my(message)); });
  assert.equal(my('Arming Royal Signal Core at site A'), 'A နေရာတွင် တော်ဝင်အချက်ပြစက်ကို တပ်ဆင်နေသည်');
  assert.equal(my('DEFENDERS WIN'), 'ကာကွယ်သူများ အနိုင်ရပြီ');
});

test('shop categories, descriptions and non-brand equipment names all translate', () => {
  for (const item of SHOP_ITEMS) {
    assertMyanmar(my(item.category));
    assertMyanmar(my(item.description));
    if (item.weaponId) assert.equal(my(item.name), item.name);
    else assertMyanmar(my(item.name));
  }
  for (const key of ['LOW', 'MEDIUM', 'HIGH', 'BUY', 'LIVE', 'ENDED', 'COMBAT', 'PLANTED', 'RESULT', 'TRANSITION', 'MELEE', 'RELOADING', 'INSPECTING', 'SWITCHING WEAPON', 'carried', 'dropped', 'planted', 'defused', 'detonated', 'ATTACKER SPAWN', 'DEFENDER SPAWN', 'A · MARKET COURT', 'B · TIMBER YARD', 'MARKET WALK', 'TIMBER PASSAGE', 'CENTRAL COURTYARD']) assertMyanmar(my(key));
});

const sourceFiles = ['App.tsx', 'components/SettingsPanel.tsx', 'components/BuyMenu.tsx', 'components/ObjectiveHud.tsx', 'components/TouchControls.tsx', 'components/RoomPanel.tsx'];
const parse = name => ts.createSourceFile(name, readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, name.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const visit = (node, callback) => { callback(node); ts.forEachChild(node, child => visit(child, callback)); };
// Only read possible output branches; condition literals are internal IDs, not displayed copy.
function outputLiterals(expression) {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isConditionalExpression(expression)) return [...outputLiterals(expression.whenTrue), ...outputLiterals(expression.whenFalse)];
  if (ts.isParenthesizedExpression(expression)) return outputLiterals(expression.expression);
  if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind)) return [...outputLiterals(expression.left), ...outputLiterals(expression.right)];
  return [];
}
test('literal UI translations and all authority status phrases have dictionary coverage', () => {
  for (const name of sourceFiles) visit(parse(name), node => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
    const phrases = node.expression.text === 't' && node.arguments[0] ? outputLiterals(node.arguments[0])
      : ['slider', 'toggle'].includes(node.expression.text) ? node.arguments.slice(1, 3).flatMap(outputLiterals) : [];
    for (const phrase of phrases.filter(Boolean)) assert.ok(Object.hasOwn(dictionary, phrase), `${name}: ${phrase}`);
  });
  for (const name of ['game/economy.ts', 'game/objective.ts']) visit(parse(name), node => {
    if (ts.isStringLiteralLike(node) && /[A-Za-z]{2,}.*\s+[A-Za-z]{2,}/.test(node.text)) assert.ok(Object.hasOwn(dictionary, node.text), `${name}: ${node.text}`);
  });
});

test('visible JSX and accessibility labels do not introduce untranslated prose', () => {
  const allowed = new Set(['BURMA', 'STRIKE', 'VOL. 01', '20° 56′ N &nbsp; 94° 53′ E', '© 2026 BURMA STRIKE', 'ESC', 'TAB', 'FPS', 'English', '30 FPS', '60 FPS']);
  for (const name of sourceFiles) visit(parse(name), node => {
    if (ts.isJsxText(node) && /[A-Za-z]{2}/.test(node.text)) assert.ok(allowed.has(node.text.trim()), `${name}: ${node.text.trim()}`);
    // The six-character example is a protocol room code, not English copy.
    if (ts.isJsxAttribute(node) && ['aria-label', 'title', 'placeholder'].includes(node.name.getText()) && node.initializer && ts.isStringLiteral(node.initializer) && node.initializer.text !== 'ABC234') assert.doesNotMatch(node.initializer.text, /[A-Za-z]{2}/, `${name}: translate ${node.getText()}`);
  });
});
