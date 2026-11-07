"""Real desktop + landscape-touch multiplayer interactions against local servers.

Requires Python Playwright and Chromium. All movement, shots, purchases and
objective interactions use browser UI/input. Scene reads are observations only;
this script never writes positions, damage, money, inventory or round time.
"""
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import time
from playwright.sync_api import sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeout


SCENE = """async()=>{
 const {Engine}=await import('/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js');
 const scene=Engine.LastCreatedScene;
 return {position:scene.getMeshByName('player-collider').position.asArray(),
   yaw:scene.activeCamera.rotation.y,pitch:scene.activeCamera.rotation.x,fov:scene.activeCamera.fov,
   remote:scene.transformNodes.filter(n=>n.metadata?.remotePlayerId).map(n=>({id:n.metadata.remotePlayerId,position:n.position.asArray()}))};
}"""


def observe(page):
    return page.evaluate(SCENE)


def number(page, selector):
    text = page.locator(selector).first.inner_text().replace('/', '').strip()
    return int(text)


def center(page, selector):
    box = page.locator(selector).first.bounding_box()
    assert box, selector
    return {'x': box['x'] + box['width'] / 2, 'y': box['y'] + box['height'] / 2}


def resume(page, mobile=False):
    page.bring_to_front()
    page.wait_for_function('!document.hidden', polling=100, timeout=10000)
    page.wait_for_timeout(120)
    if page.locator('.pause-dialog').count():
        page.locator('.pause-dialog .solid-button').first.click()
    page.wait_for_function('document.querySelector(".app").classList.contains("mode-playing")', polling=100, timeout=5000)
    if not mobile:
        if page.evaluate('document.pointerLockElement===document.querySelector("canvas")'):
            return
        if page.locator('.capture-prompt').count():
            try:
                page.locator('.capture-prompt').click(timeout=2000)
            except PlaywrightTimeout:
                # A successful asynchronous capture can remove the old HUD
                # prompt between observation and Playwright's stable click.
                if not page.evaluate('document.pointerLockElement===document.querySelector("canvas")'):
                    raise
        page.wait_for_function('document.pointerLockElement===document.querySelector("canvas")', timeout=5000)


def tap(page, selector):
    page.locator(selector).first.scroll_into_view_if_needed()
    point = center(page, selector)
    page.touchscreen.tap(point['x'], point['y'])


def buy(page, name, credits_after):
    page.locator(f'.shop-card[aria-label="Select {name}"]').click()
    page.wait_for_function('!document.querySelector(".shop-buy-button").disabled')
    page.locator('.shop-buy-button').click()
    page.wait_for_function('(credits)=>Number(document.querySelector(".shop-wallet strong").childNodes[0].textContent.replace(/,/g,""))===credits', arg=credits_after)


class Touches:
    def __init__(self, context, page):
        self.page = page
        self.session = context.new_cdp_session(page)
        self.points = {}

    def send(self, kind):
        self.session.send('Input.dispatchTouchEvent', {
            'type': kind,
            'touchPoints': [{'id': key, 'x': point['x'], 'y': point['y'], 'radiusX': 4, 'radiusY': 4, 'force': 1} for key, point in self.points.items()],
        })

    def start(self, pointer, point):
        self.points[pointer] = point
        self.send('touchStart')

    def move(self, pointer, point):
        self.points[pointer] = point
        self.send('touchMove')

    def release(self):
        self.points.clear()
        self.send('touchEnd')


def move_to(page, target, mobile=False, touches=None, timeout=18000):
    """Navigate a safe map waypoint using only held WASD or a real joystick touch."""
    resume(page, mobile)
    began = time.monotonic()
    held = set()
    last = None
    stuck = 0
    history = []
    try:
        while time.monotonic() - began < timeout / 1000:
            state = observe(page)
            x, _, z = state['position']
            dx, dz = target[0] - x, target[1] - z
            distance = math.hypot(dx, dz)
            history.append({'position': [x, z], 'distance': distance})
            history = history[-12:]
            if distance < .4:
                break
            yaw = state['yaw']
            right = math.cos(yaw) * dx - math.sin(yaw) * dz
            forward = math.sin(yaw) * dx + math.cos(yaw) * dz
            if mobile:
                point = center(page, '.joystick')
                radius = min(page.locator('.joystick').bounding_box()[key] for key in ['width', 'height']) * .32
                strength = min(1, distance / 2.5)
                desired = {'x': point['x'] + right / distance * radius * strength, 'y': point['y'] - forward / distance * radius * strength}
                if not touches.points:
                    touches.start(1, desired)
                else:
                    touches.move(1, desired)
            else:
                wanted = set()
                if abs(forward) > distance * .35:
                    wanted.add('w' if forward > 0 else 's')
                if abs(right) > distance * .35:
                    wanted.add('d' if right > 0 else 'a')
                for key in held - wanted:
                    page.keyboard.up(key)
                for key in wanted - held:
                    page.keyboard.down(key)
                held = wanted
            page.wait_for_timeout(min(800, max(80, distance / 5.5 * 850)))
            if last and math.hypot(last[0] - x, last[1] - z) < .025:
                stuck += 1
                assert stuck < 8, {'blockedWaypoint': target, 'position': state['position']}
            else:
                stuck = 0
            last = (x, z)
        else:
            raise AssertionError({'waypointTimeout': target, 'position': observe(page)['position'], 'history': history})
    finally:
        for key in held:
            page.keyboard.up(key)
        if mobile:
            touches.release()
    page.wait_for_timeout(350)


def aim_body(page, target):
    resume(page)
    state = observe(page)
    x, y, z = state['position']
    dx, dz = target[0] - x, target[2] - z
    yaw = math.atan2(dx, dz)
    pitch = -math.atan2(target[1] - (y + .75), math.hypot(dx, dz))
    yaw_delta = math.atan2(math.sin(yaw - state['yaw']), math.cos(yaw - state['yaw']))
    # Fixed default hip-fire sensitivity: .35 * .002 radians per mouse pixel.
    page.mouse.move(500, 350)
    page.wait_for_timeout(100)
    baseline = observe(page)
    yaw_delta = math.atan2(math.sin(yaw - baseline['yaw']), math.cos(yaw - baseline['yaw']))
    page.mouse.move(500 + yaw_delta / .0007, 350 + (pitch - baseline['pitch']) / .0007)
    page.wait_for_timeout(200)


def run(browser, base_url, output, section):
    contexts, pages, errors, checks = [], [], [], []
    began = time.monotonic()
    def record(message):
        checks.append(message)
        print("PASS: " + message, flush=True)
        (output / f'multiplayer-interactions-{section}-progress.json').write_text(json.dumps({'section':section,'checks':checks,'pageErrors':errors},indent=2))
    try:
        for mobile in [False, True]:
            context = browser.new_context(viewport={'width': 844 if mobile else 1000, 'height': 390 if mobile else 700}, is_mobile=mobile, has_touch=mobile)
            contexts.append(context)
            context.add_init_script("localStorage.setItem('burma-strike-settings',JSON.stringify({language:'en',graphics:'low',targetFps:30,adaptiveResolution:false,sound:false,showFps:false,sensitivity:.35,touchSensitivity:1,adsSensitivity:1,scopedSensitivity:1}))")
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base_url, wait_until='networkidle')
            page.wait_for_function('!document.querySelector(".play-button").disabled', timeout=90000)
            # Software CI drawing budget only. The normal input, simulation,
            # WebSockets and authoritative server clock continue independently.
            page.evaluate("async()=>{const {Engine}=await import('/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js');const scene=Engine.LastCreatedScene;scene.getEngine().setHardwareScalingLevel(2.5);const render=scene.render.bind(scene);let last=0;scene.render=(...args)=>{const now=performance.now();if(now-last>=200){last=now;render(...args)}}}")
            pages.append(page)
        host, defender = pages
        host.locator('.create-custom-room').click()
        host.locator('.guest-name-input').fill('Desktop Host')
        host.locator('.custom-connect-submit').click()
        host.locator('.room-code-bar input').wait_for(timeout=20000)
        code = host.locator('.room-code-bar input').input_value()
        defender.locator('.join-custom-room').click()
        defender.locator('.guest-name-input').fill('Touch Defender')
        defender.locator('.room-code-input').fill(code)
        tap(defender, '.custom-connect-submit')
        defender.locator('.room-code-bar input').wait_for(timeout=20000)
        assert defender.locator('.room-code-bar input').input_value() == code
        record('independent desktop and landscape-touch clients join the same private room')
        assert defender.evaluate('document.documentElement.scrollWidth<=innerWidth')
        defender.screenshot(path=str(output / 'multiplayer-interactions-mobile-lobby.png'))
        host.locator('.lobby-config input[type=number]').fill('1')
        host.locator('.lobby-config select[aria-label="Active sites"]').select_option('A')
        host.locator('.apply-room-config').click()
        for page in pages:
            page.wait_for_function('document.querySelector(".lobby-config input[type=number]").value==="1"&&document.querySelectorAll(".lobby-config select")[1].value==="A"')
        host.locator('.ready-toggle').click()
        tap(defender, '.ready-toggle')
        host.wait_for_function('!document.querySelector(".start-online-match").disabled')
        host.locator('.start-online-match').click()
        if section != 'objective':
            for page in pages:
                page.locator('.buy-menu').wait_for(timeout=20000)
                page.wait_for_timeout(400)
                buy(page, 'Light Armor', 350)
                buy(page, 'SHWE-9', 0)
            record('both players buy light armor and SHWE-9 using exactly800 server credits')
        else:
            for page in pages:
                page.wait_for_function('document.querySelector(".hud-top")&&document.querySelector(".hud-top").textContent.includes("PRIVATE ONLINE MATCH")', timeout=20000)
        for page in pages:
            page.bring_to_front()
            page.wait_for_function('!document.querySelector(".buy-menu")', timeout=35000)
        touches = Touches(contexts[1], defender)
        if section != 'objective':
            resume(host)
            move_to(host, (-3.6, 1))
            target = observe(defender)['position']
            aim_body(host, (target[0], 1.0, target[2]))
            host.mouse.down()
            host.wait_for_timeout(80)
            host.mouse.up()
            host.wait_for_function('document.querySelector(".weapon-readout .ammo>strong").textContent.trim()==="11"')
            defender.wait_for_function('Number(document.querySelector(".health>strong").textContent)===87&&Number(document.querySelector(".armor-hud>strong").textContent)===5', timeout=5000)
            record('a real mouse shot consumes one bullet and armor absorbs server-authoritative body damage')
            hip = observe(host)['fov']
            host.mouse.down(button='right')
            host.wait_for_timeout(400)
            assert observe(host)['fov'] < hip - .05
            host.mouse.up(button='right')
            record('desktop ADS narrows the camera field of view')
            host.keyboard.press('r')
            host.locator('.reload-notice.action-reloading').wait_for(timeout=3000)
            host.mouse.down()
            host.wait_for_timeout(80)
            host.mouse.up()
            assert number(host, '.weapon-readout .ammo>strong') == 11
            host.wait_for_function('document.querySelector(".weapon-readout .ammo>strong").textContent.trim()==="12"&&document.querySelector(".weapon-readout .ammo>span").textContent.includes("47")', timeout=5000)
            host.keyboard.press('3')
            host.wait_for_function('document.querySelector(".weapon-readout").textContent.includes("LOTUS EDGE")')
            host.wait_for_function('!document.querySelector(".reload-notice")', timeout=5000)
            host.keyboard.press('2')
            host.wait_for_function('document.querySelector(".weapon-readout").textContent.includes("SHWE-9")')
            host.wait_for_function('!document.querySelector(".reload-notice")', timeout=5000)
            record('desktop reload conserves ammunition and weapon slots switch through server draw states')

            resume(defender, True)
            before = observe(defender)
            joystick = center(defender, '.joystick')
            aim = {'x': 500, 'y': 155}
            touches.start(1, {'x': joystick['x'], 'y': joystick['y'] - 24})
            touches.start(2, aim)
            touches.move(2, {'x': aim['x'] + 45, 'y': aim['y'] + 12})
            defender.wait_for_timeout(220)
            touches.start(3, center(defender, '.touch-button.shoot'))
            defender.wait_for_timeout(450)
            touches.release()
            defender.wait_for_timeout(450)
            after = observe(defender)
            assert math.hypot(after['position'][0] - before['position'][0], after['position'][2] - before['position'][2]) > .3
            assert abs(after['yaw'] - before['yaw']) > .05
            assert number(defender, '.weapon-readout .ammo>strong') == 11
            record('three simultaneous real touch pointers move, aim and shoot over the network')
            tap(defender, '.touch-button.reload')
            defender.wait_for_function('document.querySelector(".weapon-readout .ammo>strong").textContent.trim()==="12"', timeout=5000)
            tap(defender, '.touch-weapon-slots button[aria-label="Equip slot 3"]')
            defender.wait_for_function('document.querySelectorAll(".touch-weapon-slots button")[2].getAttribute("aria-pressed")==="true"')
            defender.wait_for_function('!document.querySelector(".reload-notice")', timeout=5000)
            tap(defender, '.touch-weapon-slots button[aria-label="Equip slot 2"]')
            defender.wait_for_function('document.querySelectorAll(".touch-weapon-slots button")[1].getAttribute("aria-pressed")==="true"')
            defender.wait_for_function('!document.querySelector(".reload-notice")', timeout=5000)
            touches.start(4, center(defender, '.touch-button.ads'))
            defender.wait_for_function('document.querySelector(".touch-button.ads").getAttribute("aria-pressed")==="true"')
            touches.release()
            record('landscape touch reload, weapon switching and held ADS remain functional online')
            ground = observe(defender)['position'][1]
            tap(defender, '.touch-button.jump')
            defender.wait_for_timeout(240)
            assert observe(defender)['position'][1] > ground + .3
            defender.wait_for_timeout(900)
            assert abs(observe(defender)['position'][1] - ground) < .1
            record('the mobile jump is simulated by the server and returns to the collision floor')

        if section == 'combat':
            assert not errors, errors
            result = {'section':section,'independentClients':2,'desktopAndMobile':True,'checks':checks,'pageErrors':errors,'seconds':round(time.monotonic()-began,1)}
            (output / 'multiplayer-interactions-combat.json').write_text(json.dumps(result,indent=2))
            print(json.dumps(result),flush=True)
            return
        if section == 'all':
            (output / 'multiplayer-interactions-combat.json').write_text(json.dumps({'section':'combat','checks':checks[:],'pageErrors':errors[:]},indent=2))
        # Walk the documented market routes; no teleport or trusted sandbox travel.
        attacker_route = ([(-3.6,-12)] if section == 'all' else []) + [(-8,-12),(-18,-12),(-20,-6),(-20,1),(-19,4.5)]
        for waypoint in attacker_route:
            move_to(host, waypoint)
            print(f'ATTACKER WAYPOINT: {waypoint} -> {observe(host)["position"]}', flush=True)
        defender_route = ([(-3.6,20)] if section == 'all' else []) + [(-7,20),(-14,20),(-22,20),(-23,13),(-20,11),(-20,8),(-19,3.5)]
        for waypoint in defender_route:
            move_to(defender, waypoint, True, touches)
            print(f'DEFENDER WAYPOINT: {waypoint} -> {observe(defender)["position"]}', flush=True)
        record('both players reach siteA through real collision-resolved tactical routes')
        resume(host)
        host.keyboard.press('4')
        host.wait_for_function('document.querySelector(".objective-equip").getAttribute("aria-pressed")==="true"')
        host.keyboard.down('f')
        host.locator('.objective-interaction.working').wait_for(timeout=5000)
        host.wait_for_timeout(1000)
        host.keyboard.up('f')
        host.wait_for_function('!document.querySelector(".objective-interaction.working")')
        assert host.locator('.objective-round-clock.phase-combat').count() == 1
        host.keyboard.down('f')
        host.locator('.objective-round-clock.phase-planted').wait_for(timeout=7000)
        host.keyboard.up('f')
        record('keyboard release cancels planting and a fresh four-second hold plants on the server')
        resume(defender, True)
        defender.wait_for_function('document.querySelector(".objective-interact-button")&&!document.querySelector(".objective-interact-button").disabled')
        touches.start(9, center(defender, '.objective-interact-button'))
        defender.locator('.objective-interaction.working').wait_for(timeout=5000)
        defender.wait_for_timeout(1000)
        touches.release()
        defender.wait_for_function('!document.querySelector(".objective-interaction.working")')
        assert defender.locator('.objective-round-clock.phase-planted').count() == 1
        touches.start(9, center(defender, '.objective-interact-button'))
        defender.locator('.objective-result').wait_for(timeout=9000)
        touches.release()
        assert 'DEFENDERS WIN' in defender.locator('.objective-result').inner_text()
        record('touch release cancels defusing and a fresh six-second hold wins for Defenders')
        defender.screenshot(path=str(output / 'multiplayer-interactions-mobile-result.png'))
        host.screenshot(path=str(output / 'multiplayer-interactions-desktop-result.png'))
        host.locator('.leave-room').click()
        host.locator('.play-button').wait_for()
        host.locator('.play-button').click()
        host.wait_for_function('document.querySelector(".weapon-readout .ammo>strong").textContent.trim()==="12"')
        restored = host.evaluate("async()=>{const {Engine}=await import('/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js');const s=Engine.LastCreatedScene;return {remotes:s.transformNodes.filter(n=>n.metadata?.remotePlayerId).length,dummies:s.transformNodes.filter(n=>n.name.startsWith('practice dummy ')&&n.isEnabled()).length}}")
        assert restored == {'remotes':0,'dummies':3}, restored
        record('leaving the online room restores local Practice, pistol ammunition and all three dummies')
        assert not errors, errors
        result = {'section':section,'independentClients': 2, 'desktopAndMobile': True, 'checks': checks, 'pageErrors': errors, 'seconds': round(time.monotonic() - began, 1)}
        (output / f'multiplayer-interactions-{section}.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)
    except Exception as error:
        (output / f'multiplayer-interactions-{section}-failure.json').write_text(json.dumps({'section':section,'checks':checks,'pageErrors':errors,'error':str(error)},indent=2))
        for index, page in enumerate(pages):
            if not page.is_closed():
                page.screenshot(path=str(output / f'multiplayer-interactions-failure-{index}.png'))
        print(json.dumps({'completedChecks': checks, 'pageErrors': errors}), flush=True)
        raise
    finally:
        for context in contexts:
            context.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:5173/')
    parser.add_argument('--section', choices=['combat','objective','all'], default='all')
    parser.add_argument('--output', default='/tmp/burma-multiplayer-interactions')
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
            run(browser, args.base_url, output, args.section)
        finally:
            browser.close()
