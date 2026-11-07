import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfiguration } from '../src/config';
import { TokenBucket, validateAction, validateConfiguration, validateInput, validateUsername } from '../src/validation';

const input = { seq: 1, moveX: 1, moveY: 1, yaw: Math.PI * 4 + .2, pitch: .1, sprint: false, ads: false, fire: false, jump: false };

test('guest names normalize Unicode and whitespace, while rejecting markup and oversized names', () => {
  assert.equal(validateUsername('  Aye   Chan  '), 'Aye Chan');
  assert.equal(validateUsername('မြန်မာ ၂'), 'မြန်မာ ၂');
  assert.equal(validateUsername('Jose\u0301'), 'José');
  assert.equal(validateUsername('one\nsecond'), 'one second');
  for (const value of [null, {}, 1, '', 'a', '   ', 'a'.repeat(21), '<script>', 'guest/../../admin', 'guest🙂']) {
    assert.throws(() => validateUsername(value));
  }
});

test('network input contains only bounded controls and normalizes diagonal movement', () => {
  const valid = validateInput(input)!;
  assert.ok(Math.abs(Math.hypot(valid.moveX, valid.moveY) - 1) < 1e-10);
  assert.ok(Math.abs(valid.yaw - .2) < 1e-10);
  for (const value of [null, [], 'input', {}, { ...input, seq: -1 }, { ...input, seq: 1.5 },
    { ...input, moveX: 100 }, { ...input, moveY: NaN }, { ...input, yaw: Infinity },
    { ...input, pitch: 1.46 }, { ...input, fire: 1 }, { ...input, jump: 'true' },
    { ...input, position: { x: 1000, y: 0, z: 1000 } }, { ...input, damage: 100 }, { ...input, credits: 9000 }]) {
    assert.equal(validateInput(value), null);
  }
});

test('actions require exact keys and reject client authority declarations', () => {
  for (const action of [
    { type: 'ready', ready: true }, { type: 'team', playerId: 'player-1', team: 'attackers' },
    { type: 'configure', config: { mapId: 'bagan-old-city', rounds: 13, activeSite: 'B' } },
    { type: 'start' }, { type: 'return-lobby' }, { type: 'reload' }, { type: 'inspect' },
    { type: 'equip', slot: 4 }, { type: 'select-primary', weaponId: 'sniper' },
    { type: 'buy', itemId: 'light-armor' }, { type: 'sell', itemId: 'pistol' },
    { type: 'interact', held: true, round: 1, epoch: 1 },
  ]) assert.deepEqual(validateAction(action), action);
  for (const action of [null, [], 'reload', {}, { type: 'ready', ready: 'true' },
    { type: 'team', playerId: 'x', team: 'spectators' }, { type: 'equip', slot: 5 },
    { type: 'select-primary', weaponId: 'knife' }, { type: 'buy', itemId: 'x'.repeat(33) },
    { type: 'reload', ammo: 12 }, { type: 'interact', held: true, round: 0, epoch: 1 },
    { type: 'interact', held: true, round: 1, epoch: Infinity }, { type: 'plant-complete' },
    { type: 'defuse-complete' }, { type: 'damage', amount: 100 }, { type: 'credits', amount: 9000 },
    { type: 'buy', itemId: 'rifle', price: 0 }, { type: 'start', host: true }]) {
    assert.equal(validateAction(action), null);
  }
});

test('host configuration permits the shipped map and finite round/site options only', () => {
  for (const rounds of [1, 13, 30]) for (const activeSite of ['both', 'A', 'B']) {
    assert.ok(validateConfiguration({ mapId: 'bagan-old-city', rounds, activeSite }));
  }
  for (const value of [null, {}, { mapId: 'other-map', rounds: 13, activeSite: 'A' },
    { mapId: 'bagan-old-city', rounds: 0, activeSite: 'A' },
    { mapId: 'bagan-old-city', rounds: 31, activeSite: 'A' },
    { mapId: 'bagan-old-city', rounds: 2.5, activeSite: 'A' },
    { mapId: 'bagan-old-city', rounds: 13, activeSite: 'C' }]) assert.equal(validateConfiguration(value), null);
});

test('input/action buckets bound bursts and refill according to elapsed server time', () => {
  const bucket = new TokenBucket(10, 3, 1000);
  assert.equal(bucket.take(1000), true);
  assert.equal(bucket.take(1000), true);
  assert.equal(bucket.take(1000), true);
  assert.equal(bucket.take(1000), false);
  assert.equal(bucket.take(1099), false);
  assert.equal(bucket.take(1100), true);
  assert.equal(bucket.take(1100), false);
  for (let i = 0; i < 3; i++) assert.equal(bucket.take(10000), true);
  assert.equal(bucket.take(10000), false);
});

test('environment configuration rejects wildcard origins and invalid deployment values', () => {
  const config = readConfiguration({ PORT: '4567', HOST: '127.0.0.1', ALLOWED_ORIGINS: 'https://play.example.test', RECONNECT_SECONDS: '5', MAX_ROOMS: '25' });
  assert.equal(config.port, 4567); assert.equal(config.host, '127.0.0.1');
  assert.deepEqual(config.allowedOrigins, ['https://play.example.test']);
  assert.equal(config.reconnectSeconds, 5); assert.equal(config.maxRooms, 25);
  for (const env of [{ PORT: '0' }, { PORT: '65536' }, { RECONNECT_SECONDS: '0' }, { MAX_ROOMS: '-1' },
    { ALLOWED_ORIGINS: '*' }, { ALLOWED_ORIGINS: 'https://example.test/path' }, { ALLOWED_ORIGINS: 'javascript:alert(1)' }]) {
    assert.throws(() => readConfiguration(env));
  }
});
