const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const picker = html.slice(html.indexOf('  function pick('),html.indexOf('  let selection ='));
function setup(count=61) {
  const ids=Array.from({length:count},(_,i)=>['video'+i]);
  const context=vm.createContext({VIDEOS:{morning:ids,evening:[]},mode:'morning',blocked:new Set(),liked:new Set(),lastShown:{},Math:Object.assign(Object.create(Math),{random:()=>0})});
  context.pool = m => context.VIDEOS[m];
  vm.runInContext(picker,context);
  return context;
}
test('guest rotation also requires 60 distinct intervening videos',()=>{
  const c=setup(), seen=[];
  for(let i=0;i<250;i++){
    const v=c.pick(seen.at(-1));assert.ok(v);
    const prior=seen.lastIndexOf(v[0]);
    if(prior>=0)assert.ok(new Set(seen.slice(prior+1)).size>=60);
    seen.push(v[0]);c.lastShown[v[0]]=i+1;
  }
});
test('an undersized exhausted pool does not silently repeat; likes remain eligible',()=>{
  const c=setup(3);c.lastShown={video0:1,video1:2,video2:3};
  assert.equal(c.pick(),null);c.liked.add('video0');assert.equal(c.pick()[0],'video0');
  c.blocked.add('video0');assert.equal(c.pick(),null);
});
test('both libraries support the rotation and every video ID is unique',()=>{
  const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(path.join(root,'videos.js'),'utf8'),c);
  const all=Object.values(c.window.VIDEOS).flat();
  for(const videos of Object.values(c.window.VIDEOS))assert.ok(videos.length>=65);
  assert.equal(new Set(all.map(v=>v[0])).size,all.length);
  for(const [id,title,channel,length]of all){assert.match(id,/^[\w-]{11}$/);assert.ok(title&&channel);assert.match(length,/^\d{1,2}:\d{2}$/);}
});
