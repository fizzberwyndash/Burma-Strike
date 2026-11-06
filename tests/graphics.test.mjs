import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/game/graphics.ts', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const {GraphicsController,resolveGraphicsQuality}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const settings={graphics:'auto',targetFps:60,adaptiveResolution:true};
test('auto selects scalable mobile medium and desktop high without overriding manual choices',()=>{
 assert.equal(resolveGraphicsQuality('auto',true),'medium');assert.equal(resolveGraphicsQuality('auto',false),'high');
 assert.equal(resolveGraphicsQuality('low',false),'low');
});
test('30 FPS renders half the engine ticks while every simulation tick remains available',()=>{
 const g=new GraphicsController({setHardwareScalingLevel(){}},false);g.configure({...settings,targetFps:30});
 let rendered=0;for(let i=0;i<600;i++)if(g.shouldRender(1/60))rendered++;
 assert.ok(rendered>=299&&rendered<=302,rendered);assert.ok(Math.abs(g.fps-30)<=1);
});
test('slow rendering degrades only resolution inside bounds and can be disabled',()=>{
 const applied=[];const g=new GraphicsController({setHardwareScalingLevel:v=>applied.push(v)},true);
 g.configure({...settings,graphics:'low'});const initial=g.renderScale;
 for(let i=0;i<200;i++)g.shouldRender(.1);
 assert.ok(g.renderScale>initial);assert.ok(g.renderScale<=2.5);assert.ok(applied.every(Number.isFinite));
 g.configure({...settings,graphics:'low',adaptiveResolution:false});const fixed=g.renderScale;
 for(let i=0;i<200;i++)g.shouldRender(.1);assert.equal(g.renderScale,fixed);
});
test('unrelated preferences do not reset measured resolution or graphics resources',()=>{
 const g=new GraphicsController({setHardwareScalingLevel(){}},false);assert.equal(g.configure(settings),true);
 for(let i=0;i<100;i++)g.shouldRender(.1);const scale=g.renderScale;
 assert.equal(g.configure({...settings}),false);assert.equal(g.renderScale,scale);
 assert.equal(g.shouldRender(NaN),false);
});
