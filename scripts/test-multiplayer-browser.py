"""Real UI/WebSocket proof against running Vite and Colyseus servers.
Requires Python Playwright and Chromium; see docs/MULTIPLAYER.md.
No test command can set player positions, damage, money, or round time.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import time
from playwright.sync_api import sync_playwright

INSPECT = """async()=>{
 const {Engine}=await import('/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js');
 const scene=Engine.LastCreatedScene;
 return {locked:!!document.pointerLockElement,focus:document.hasFocus(),mode:document.querySelector('.app').className,phase:document.querySelector('.objective-round-clock')?.textContent,local:scene.getMeshByName('player-collider').position.asArray(),
  remote:scene.transformNodes.filter(node=>node.metadata?.remotePlayerId).map(node=>({
   id:node.metadata.remotePlayerId,position:node.position.asArray(),enabled:node.isEnabled(),
   visibleMeshes:node.getChildMeshes().filter(mesh=>mesh.isEnabled()&&mesh.isVisible).length}))};
}"""

def pause_and_resume(page):
    page.bring_to_front()
    if page.locator('.pause-dialog').count():
        page.locator('.pause-dialog .solid-button').first.click()


def activate(page):
    # Many headless tabs may suspend RAF while hidden. Activate each observer
    # before reading its rendered scene, as on independent foreground devices.
    page.bring_to_front()
    page.wait_for_function('!document.hidden', polling=100, timeout=10000)
    page.wait_for_timeout(180)


def capture(page):
    activate(page)
    pause_and_resume(page)
    if not page.evaluate('!!document.pointerLockElement'):
        if page.locator('.capture-prompt').count():
            page.locator('.capture-prompt').click()
        else:
            page.mouse.click(700, 450)
        page.wait_for_function('document.pointerLockElement===document.querySelector("canvas")', polling=100, timeout=15000)


def exercise(browser, base_url, count, output):
    contexts, pages, errors = [], [], []
    began = time.monotonic()
    try:
        for index in range(count):
            context = browser.new_context(viewport={'width': 1000, 'height': 700})
            contexts.append(context)
            context.add_init_script("localStorage.setItem('burma-strike-settings',JSON.stringify({language:'en',graphics:'low',targetFps:30,adaptiveResolution:false,sound:false,showFps:false}))")
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base_url, wait_until='domcontentloaded', timeout=90000)
            page.wait_for_function("!document.querySelector('.play-button').disabled", timeout=90000)
            # Stay within the Low/adaptive resolution budget on software-rendered CI.
            # Limit expensive GPU draws to 1 Hz for many software-rendered contexts.
            # Input/simulation/network/UI callbacks still run normally; this is not an FPS benchmark.
            page.evaluate("""async()=>{
              const {Engine}=await import('/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js');
              const scene=Engine.LastCreatedScene;scene.getEngine().setHardwareScalingLevel(2.5);
              const render=scene.render.bind(scene);let last=0;
              scene.render=(...args)=>{const now=performance.now();if(now-last>=1000){last=now;render(...args)}};
            }""")
            pages.append(page)
            print(f'{count} players: browser {index + 1} ready', flush=True)
        host = pages[0]
        activate(host)
        host.locator('.create-custom-room').click()
        host.locator('.guest-name-input').fill(f'Host {count}')
        host.locator('.custom-connect-submit').click()
        host.locator('.room-code-bar input').wait_for(timeout=20000)
        code = host.locator('.room-code-bar input').input_value()
        print(f'{count} players: private lobby created', flush=True)
        for index, page in enumerate(pages[1:], 1):
            activate(page)
            page.locator('.join-custom-room').click()
            page.locator('.guest-name-input').fill(f'Guest {index}')
            page.locator('.room-code-input').fill(code)
            page.locator('.custom-connect-submit').click()
            page.locator('.room-code-bar input').wait_for(timeout=20000)
            assert page.locator('.room-code-bar input').input_value() == code
            print(f'{count} players: guest {index} joined', flush=True)
        for page in pages:
            activate(page)
            page.wait_for_function('(count)=>document.querySelectorAll(".lobby-player").length===count', arg=count, timeout=20000)
        activate(host)
        host.locator('.lobby-config input[type=number]').fill('1')
        host.locator('.lobby-config select[aria-label="Active sites"]').select_option('A')
        host.locator('.apply-room-config').click()
        if count == 3:
            host.locator('.unbalanced-warning').wait_for()
        host.screenshot(path=str(output / f'multiplayer-{count}-lobby.png'))
        for page in pages:
            activate(page)
            page.locator('.ready-toggle').click()
        print(f'{count} players: ready commands sent', flush=True)
        activate(host)
        host.wait_for_function('!document.querySelector(".start-online-match").disabled', timeout=20000)
        host.locator('.start-online-match').click()
        print(f'{count} players: match started', flush=True)
        for page in pages:
            activate(page)
            page.wait_for_function('document.querySelector(".app").classList.contains("mode-playing")', timeout=30000)
            page.wait_for_function("document.querySelector('.hud-top').textContent.includes('PRIVATE ONLINE MATCH')", timeout=15000)
            page.wait_for_function("async(count)=>{const {Engine}=await import('/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js');return Engine.LastCreatedScene.transformNodes.filter(n=>n.metadata?.remotePlayerId&&n.isEnabled()).length===count-1}", arg=count, timeout=30000)
        before = []
        for page in pages:
            activate(page)
            before.append(page.evaluate(INSPECT))
        print(f'{count} players: all remote avatars created', flush=True)
        assert all(len(state['remote']) == count - 1 for state in before)
        assert all(actor['enabled'] and actor['visibleMeshes'] >= 12 for state in before for actor in state['remote'])
        assert all(len({actor['id'] for actor in state['remote']}) == count - 1 for state in before)
        # Natural buy phase: no client clock or server state manipulation.
        for page in pages:
            activate(page)
            page.wait_for_function('!document.querySelector(".buy-menu")', polling=100, timeout=35000)
        capture(host)
        host.evaluate("""async()=>{
          const loaded=performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/src/network/client.ts')).at(-1);
 const {OnlineClient}=await import(loaded?.name??'/src/network/client.ts');
          const original=OnlineClient.prototype.sendInput;
          window.__burmaInputProbe={sent:[],self:null};
          OnlineClient.prototype.sendInput=function(input){
            const snapshot=this.getSnapshot(),self=snapshot?.players.find(p=>p.id===this.sessionId);
            window.__burmaInputProbe.self=self?{position:self.position,lastInput:self.lastInput}:null;
            window.__burmaInputProbe.sent.push({at:performance.now(),seq:input.seq,moveY:input.moveY,status:this.getState().status});
            if(window.__burmaInputProbe.sent.length>180)window.__burmaInputProbe.sent.shift();
            return original.call(this,input);
          };
        }""")
        host.wait_for_timeout(150)
        host.keyboard.down('w')
        host.wait_for_function('(startZ)=>window.__burmaInputProbe?.self?.position.z>startZ+3', arg=before[0]['local'][2], polling=100, timeout=15000)
        host.keyboard.up('w')
        host.wait_for_timeout(1000)
        (output / f'multiplayer-{count}-input.json').write_text(json.dumps(host.evaluate('window.__burmaInputProbe'), indent=2))
        after = [host.evaluate(INSPECT)]
        for page in pages[1:]:
            activate(page)
            page.wait_for_timeout(250)
            after.append(page.evaluate(INSPECT))
        own = after[0]['local']
        assert own[2] > before[0]['local'][2] + 3, (before[0], after[0])
        for state in after[1:]:
            # First team spawn belongs to host: x=-3.6, starting z=-12.
            assert any(abs(actor['position'][0] - own[0]) < .7 and abs(actor['position'][2] - own[2]) < 1 for actor in state['remote']), (own, state)
        capture(host)
        host.keyboard.down('Tab')
        host.locator('.objective-scoreboard').wait_for()
        assert host.locator('.objective-score-row').count() == count
        host.screenshot(path=str(output / f'multiplayer-{count}-match.png'))
        host.keyboard.up('Tab')
        assert not errors, errors
        result = {'players': count, 'teams': f'{(count+1)//2}v{count//2}', 'samePrivateRoom': True,
                  'independentContexts': count, 'remoteAvatarsPerClient': count-1,
                  'realMovementReceivedByAllPeers': True, 'scoreboardPlayers': count, 'softwareDrawBudgetHz': 1,
                  'pageErrors': errors, 'seconds': round(time.monotonic()-began, 1)}
        (output / f'multiplayer-{count}.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)
    except Exception:
        if pages and not pages[0].is_closed():
            probe=pages[0].evaluate('window.__burmaInputProbe??null')
            (output / f'multiplayer-{count}-input-failure.json').write_text(json.dumps(probe,indent=2))
            print(json.dumps({'inputProbe':probe}),flush=True)
        for index, page in [(index,pages[index]) for index in sorted(set([0,len(pages)-1])) if pages]:
            if not page.is_closed():
                page.screenshot(path=str(output / f'multiplayer-{count}-failure-{index}.png'))
        print(json.dumps({'players': count, 'pageErrors': errors}), flush=True)
        raise
    finally:
        for context in contexts:
            context.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--players', default='2,3,10', help='Comma-separated counts in test order')
    parser.add_argument('--base-url', default='http://127.0.0.1:5173/')
    parser.add_argument('--output', default='/tmp/burma-multiplayer-browser')
    args = parser.parse_args()
    counts = [int(value) for value in args.players.split(',')]
    if any(count < 2 or count > 10 for count in counts):
        parser.error('Each count must be between 2 and 10')
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        executable = os.environ.get('BURMA_CHROMIUM_PATH') or shutil.which('chromium')
        options = {'headless': True, 'args': ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']}
        if executable:
            options['executable_path'] = executable
        browser = playwright.chromium.launch(**options)
        try:
            for count in counts:
                exercise(browser, args.base_url, count, output)
        finally:
            browser.close()
