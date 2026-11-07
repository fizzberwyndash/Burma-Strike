"""Tactical online browser regressions against running Vite/Colyseus servers.

Uses independent browser contexts and real UI/keyboard/mouse actions. Read-only
scene and replicated-state observations verify outcomes; no authority setters,
clock advancement, money changes, damage injection or teleportation are used.
Requires Python Playwright and Chromium. See docs/MULTIPLAYER.md.
"""
import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import time
from playwright.sync_api import sync_playwright

_spec = importlib.util.spec_from_file_location('burma_interaction_helpers', Path(__file__).with_name('test-multiplayer-interactions.py'))
_helpers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_helpers)

SETTINGS = "localStorage.setItem('burma-strike-settings',JSON.stringify({language:'en',graphics:'low',targetFps:30,adaptiveResolution:false,sound:false,showFps:false,sensitivity:.35,touchSensitivity:1,adsSensitivity:1,scopedSensitivity:1}))"
PROBE = """async()=>{
 const loaded=performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/src/network/client.ts')).at(-1);
 const {OnlineClient}=await import(loaded?.name??'/src/network/client.ts');
 if(!window.__tacticalProbeInstalled){
  window.__tacticalProbeInstalled=true;
  const original=OnlineClient.prototype.getSnapshot;
  OnlineClient.prototype.getSnapshot=function(){
   const snapshot=original.call(this);
   window.__tacticalObservation={snapshot,sessionId:this.sessionId,status:this.getState().status};
   return snapshot;
  };
 }
}"""
OBSERVE_STATE = 'window.__tacticalObservation??null'


def activate(page):
    page.bring_to_front()
    page.wait_for_function('!document.hidden', polling=100, timeout=10000)
    page.wait_for_timeout(150)


def replicated(page):
    value = page.evaluate(OBSERVE_STATE)
    assert value and value['snapshot'], 'No replicated match snapshot has been observed'
    return value


def self_player(page):
    value = replicated(page)
    return next(player for player in value['snapshot']['players'] if player['id'] == value['sessionId'])


def wait_replication(page, expression, arg=None, timeout=10000):
    page.wait_for_function('(arg)=>{const observed=window.__tacticalObservation;return !!observed?.snapshot&&(' + expression + ')}', arg=arg, polling=100, timeout=timeout)


def prepare(context, base_url, errors):
    context.add_init_script(SETTINGS)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base_url, wait_until='domcontentloaded', timeout=90000)
    page.wait_for_function('!document.querySelector(".play-button").disabled', timeout=90000)
    page.evaluate(PROBE)
    # CI drawing budget only: normal game input, simulation and WebSockets run.
    page.evaluate("""async()=>{
      const {Engine}=await import('/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js');
      const scene=Engine.LastCreatedScene;scene.getEngine().setHardwareScalingLevel(2.5);
      const render=scene.render.bind(scene);let last=0;
      scene.render=(...args)=>{const now=performance.now();if(now-last>=200){last=now;render(...args)}};
    }""")
    return page


def make_group(browser, base_url, count, errors):
    contexts, pages = [], []
    for _ in range(count):
        context = browser.new_context(viewport={'width': 1000, 'height': 700})
        contexts.append(context)
        pages.append(prepare(context, base_url, errors))
    names = ['Battle Host', 'Battle Defender', 'Battle Ally'][:count]
    host = pages[0]
    activate(host)
    host.locator('.create-custom-room').click()
    host.locator('.guest-name-input').fill(names[0])
    host.locator('.custom-connect-submit').click()
    host.locator('.room-code-bar input').wait_for(timeout=20000)
    code = host.locator('.room-code-bar input').input_value()
    for index, page in enumerate(pages[1:], 1):
        activate(page)
        page.locator('.join-custom-room').click()
        page.locator('.guest-name-input').fill(names[index])
        page.locator('.room-code-input').fill(code)
        page.locator('.custom-connect-submit').click()
        page.locator('.room-code-bar input').wait_for(timeout=20000)
        assert page.locator('.room-code-bar input').input_value() == code
    for page in pages:
        activate(page)
        page.wait_for_function('(count)=>document.querySelectorAll(".lobby-player").length===count', arg=count)
    activate(host)
    host.locator('.lobby-config input[type=number]').fill('1')
    host.locator('.lobby-config select[aria-label="Active sites"]').select_option('A')
    checkbox = host.locator('input.friendly-fire-toggle')
    assert checkbox.count() == 1 and not checkbox.is_checked()
    host.locator('.apply-room-config').click()
    for page in pages:
        activate(page)
        page.wait_for_function('document.querySelector(".lobby-config input[type=number]").value==="1"')
        page.locator('.ready-toggle').click()
    activate(host)
    host.wait_for_function('!document.querySelector(".start-online-match").disabled')
    host.locator('.start-online-match').click()
    for page in pages:
        activate(page)
        page.locator('.buy-menu').wait_for(timeout=20000)
        page.wait_for_timeout(400)
        _helpers.buy(page, 'SHWE-9', 450)
        wait_replication(page, 'observed.snapshot.players.find(p=>p.id===observed.sessionId)?.economy.credits===450')
    for page in pages:
        activate(page)
        page.wait_for_function('!document.querySelector(".buy-menu")', polling=100, timeout=35000)
        wait_replication(page, 'observed.snapshot.objective?.phase==="combat"')
    return contexts, pages, names, code


def headshot(shooter, victim):
    activate(victim)
    position = self_player(victim)['position']
    _helpers.aim_body(shooter, (position['x'], position['y'] + .65, position['z']))
    shooter.wait_for_function('!document.querySelector(".reload-notice")', polling=100, timeout=5000)
    shooter.mouse.down()
    shooter.wait_for_timeout(90)
    shooter.mouse.up()


def show_scoreboard(page):
    activate(page)
    if page.locator('.rooms-dialog').count():
        page.locator('.rooms-dialog .close-button').click()
    if page.locator('.pause-dialog').count():
        page.locator('.pause-dialog .solid-button').first.click()
    page.locator('.objective-scoreboard-button').click()
    page.locator('.objective-scoreboard').wait_for()
    # A result disables combat every frame. The scoreboard must remain open
    # through those updates rather than appearing for only one React render.
    page.wait_for_timeout(650)
    assert page.locator('.objective-scoreboard').is_visible()


def show_finished_room(page):
    activate(page)
    if page.locator('.objective-scoreboard').count():
        page.locator('.objective-scoreboard button[aria-label="Close scoreboard"]').click()
    if not page.locator('.rooms-dialog').count():
        page.locator('.pause-button').click()
        page.locator('.online-room-menu').click()
    page.locator('.lobby-match-complete').wait_for()


def one_v_one(browser, base_url, output):
    began = time.monotonic()
    errors, checks, contexts, pages = [], [], [], []
    def record(message):
        checks.append(message)
        print('PASS 1v1: ' + message, flush=True)
    try:
        contexts, pages, names, code = make_group(browser, base_url, 2, errors)
        host, defender = pages
        initial = replicated(host)
        match_id = initial['snapshot']['matchId']
        assert match_id
        record('two browser clients buy server-owned pistols during the shared buy phase')
        headshot(host, defender)
        for page in pages:
            activate(page)
            wait_replication(page, 'observed.snapshot.stage==="finished"&&observed.snapshot.roundHistory.length===1')
        host_state = replicated(host)['snapshot']
        assert host_state['objective']['result']['winner'] == 'attackers'
        assert host_state['objective']['scores'] == {'attackers': 1, 'defenders': 0}
        assert self_player(host)['kills'] == 1 and self_player(host)['economy']['credits'] == 3650
        assert not self_player(defender)['alive'] and self_player(defender)['deaths'] == 1
        assert self_player(defender)['economy']['credits'] == 2350
        assert host_state['roundHistory'][0]['winner'] == 'attackers'
        record('real hitscan elimination awards one kill, a win/loss, credits and one round-history record')
        for page, expected in [(host, 'VICTORY'), (defender, 'DEFEAT')]:
            page.locator('.rooms-dialog').wait_for()
            assert expected in page.locator('.match-outcome').inner_text()
            assert page.locator('.rooms-dialog .round-history-entry').count() == 1
        assert defender.locator('.rematch-online-match').count() == 0
        show_scoreboard(host)
        rows = host.locator('.objective-score-table .objective-score-row')
        assert rows.count() == 2
        own = rows.filter(has_text=names[0])
        enemy = rows.filter(has_text=names[1])
        assert own.locator('td').nth(1).inner_text().strip() == '1'
        assert enemy.locator('td').nth(2).inner_text().strip() == '1'
        assert host.locator('.objective-scoreboard .round-history-entry').count() == 1
        host.screenshot(path=str(output / 'tactical-1v1-scoreboard.png'))
        record('the scoreboard displays server kills, deaths, credits and round history')
        show_finished_room(host)
        host.locator('.rematch-online-match').click()
        for page in pages:
            activate(page)
            page.wait_for_function('!document.querySelector(".rooms-dialog")', polling=100, timeout=10000)
            page.locator('.buy-menu').wait_for(timeout=10000)
            wait_replication(page, 'observed.snapshot.stage==="match"&&observed.snapshot.matchId!==arg&&observed.snapshot.objective.phase==="buy"', match_id)
            snapshot = replicated(page)['snapshot']
            player = self_player(page)
            assert snapshot['code'] == code
            assert snapshot['roundHistory'] == []
            assert snapshot['objective']['scores'] == {'attackers': 0, 'defenders': 0}
            assert player['alive'] and player['health'] == 100 and player['armor'] == 0
            assert player['economy']['credits'] == 800 and player['economy']['ownedWeapons'] == ['knife']
        record('host rematch preserves the private room and resets the match once with fresh lives and 800 credits')
        assert not errors, errors
        result = {'case': '1v1', 'checks': checks, 'pageErrors': errors, 'seconds': round(time.monotonic() - began, 1)}
        (output / 'tactical-1v1.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)
    except Exception as error:
        (output / 'tactical-1v1-failure.json').write_text(json.dumps({'checks': checks, 'pageErrors': errors, 'error': str(error)}, indent=2))
        for index, page in enumerate(pages):
            if not page.is_closed():
                page.screenshot(path=str(output / f'tactical-1v1-failure-{index}.png'))
        raise
    finally:
        for context in contexts:
            context.close()


def two_v_one(browser, base_url, output):
    began = time.monotonic()
    errors, checks, contexts, pages = [], [], [], []
    def record(message):
        checks.append(message)
        print('PASS 2v1: ' + message, flush=True)
    try:
        contexts, pages, names, code = make_group(browser, base_url, 3, errors)
        host, defender, ally = pages
        original_id = replicated(host)['sessionId']
        defender_id = replicated(defender)['sessionId']
        ally_id = replicated(ally)['sessionId']
        # Bring the ally forward using normal controls, so the friendly target
        # needs only a small, accurately measurable mouse turn.
        _helpers.resume(ally)
        start_z = self_player(ally)['position']['z']
        ally.keyboard.down('w')
        wait_replication(ally, 'observed.snapshot.players.find(p=>p.id===observed.sessionId).position.z>arg+6', start_z, 10000)
        ally.keyboard.up('w')
        ally.wait_for_timeout(450)
        headshot(host, ally)
        activate(ally)
        wait_replication(ally, 'observed.snapshot.players.find(p=>p.id===arg).inventory.magazine===11', original_id)
        assert self_player(ally)['health'] == 100 and self_player(ally)['alive']
        record('friendly targets block bullets but take no damage with host friendly fire disabled')
        headshot(defender, host)
        activate(host)
        wait_replication(host, 'observed.snapshot.players.find(p=>p.id===observed.sessionId).alive===false')
        assert replicated(host)['snapshot']['objective']['phase'] == 'combat'
        if host.locator('.pause-dialog').count():
            host.locator('.pause-dialog .solid-button').first.click()
        host.locator('.spectator-panel').wait_for(timeout=10000)
        assert names[2] in host.locator('.spectator-name').inner_text()
        own_before = self_player(host)
        collider_before = _helpers.observe(host)['position']
        host.keyboard.down('w')
        host.keyboard.press('4')
        host.keyboard.down('f')
        host.mouse.down()
        host.wait_for_timeout(500)
        host.mouse.up()
        host.keyboard.up('f')
        host.keyboard.up('w')
        host.wait_for_timeout(350)
        own_after = self_player(host)
        assert not own_after['alive'] and not own_after['deviceEquipped']
        assert own_after['inventory']['magazine'] == own_before['inventory']['magazine']
        assert math.dist(_helpers.observe(host)['position'], collider_before) < .15
        assert replicated(host)['snapshot']['objective']['interaction'] is None
        record('dead host follows a living teammate while movement, shooting and objective actions stay blocked')
        _helpers.resume(ally)
        ally_start = self_player(ally)['position']['z']
        ally.keyboard.down('w')
        wait_replication(ally, 'observed.snapshot.players.find(p=>p.id===observed.sessionId).position.z>arg+3', ally_start, 10000)
        ally.keyboard.up('w')
        ally.wait_for_timeout(400)
        activate(host)
        if host.locator('.pause-dialog').count():
            host.locator('.pause-dialog .solid-button').first.click()
        host.wait_for_timeout(500)
        camera = host.evaluate("async()=>{const {Engine}=await import('/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js');return Engine.LastCreatedScene.activeCamera.position.asArray()}")
        ally_pose = self_player(ally)['position']
        assert math.hypot(camera[0] - ally_pose['x'], camera[2] - ally_pose['z']) < 1.2, (camera, ally_pose)
        host.screenshot(path=str(output / 'tactical-2v1-spectator.png'))
        record('the spectator camera follows interpolated teammate movement rather than the dead collider')
        host.reload(wait_until='domcontentloaded')
        host.wait_for_function('!document.querySelector(".play-button").disabled', timeout=90000)
        host.evaluate(PROBE)
        host.locator('.join-custom-room').click()
        host.locator('.reconnect-room').wait_for(timeout=10000)
        host.locator('.reconnect-room').click()
        wait_replication(host, 'observed.sessionId===arg&&observed.snapshot.players.find(p=>p.id===arg).connected', original_id, 15000)
        assert not self_player(host)['alive'] and self_player(host)['health'] == 0
        assert replicated(host)['snapshot']['hostId'] == defender_id
        assert len(replicated(host)['snapshot']['players']) == 3
        host.locator('.spectator-panel').wait_for(timeout=10000)
        assert names[2] in host.locator('.spectator-name').inner_text()
        record('a dead player reconnects to the same reserved identity without reviving and host authority migrates')
        headshot(defender, ally)
        for page in pages:
            activate(page)
            wait_replication(page, 'observed.snapshot.stage==="finished"&&observed.snapshot.roundHistory.length===1')
        assert replicated(defender)['snapshot']['objective']['result']['winner'] == 'defenders'
        assert replicated(defender)['snapshot']['objective']['scores'] == {'attackers': 0, 'defenders': 1}
        for page, expected in [(host, 'DEFEAT'), (defender, 'VICTORY')]:
            assert expected in page.locator('.match-outcome').inner_text()
        record('eliminating the last attacker resolves one Defender win and one synchronized round-history record')
        assert not errors, errors
        result = {'case': '2v1', 'checks': checks, 'pageErrors': errors, 'seconds': round(time.monotonic() - began, 1)}
        (output / 'tactical-2v1.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)
    except Exception as error:
        (output / 'tactical-2v1-failure.json').write_text(json.dumps({'checks': checks, 'pageErrors': errors, 'error': str(error)}, indent=2))
        for index, page in enumerate(pages):
            if not page.is_closed():
                page.screenshot(path=str(output / f'tactical-2v1-failure-{index}.png'))
        raise
    finally:
        for context in contexts:
            context.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:5173/')
    parser.add_argument('--case', choices=['1v1', '2v1', 'all'], default='all')
    parser.add_argument('--output', default='/tmp/burma-tactical-browser')
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        executable = os.environ.get('BURMA_CHROMIUM_PATH') or shutil.which('chromium')
        options = {'headless': True, 'args': ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']}
        if executable:
            options['executable_path'] = executable
        browser = playwright.chromium.launch(**options)
        try:
            if args.case in ['1v1', 'all']:
                one_v_one(browser, args.base_url, output)
            if args.case in ['2v1', 'all']:
                two_v_one(browser, args.base_url, output)
        finally:
            browser.close()
