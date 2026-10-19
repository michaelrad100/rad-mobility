const test=require('node:test'), assert=require('node:assert/strict'), Library=require('../library.js');
test('YouTube URLs canonicalize safely and reject unrelated hosts, credentials and playlists',()=>{
  for(const u of ['https://youtu.be/cacwri2wio4?si=abc','https://m.youtube.com/watch?v=cacwri2wio4&t=20','https://www.youtube.com/shorts/cacwri2wio4'])assert.equal(Library.parseURL(u).id,'cacwri2wio4');
  assert.equal(Library.parseURL('https://youtube.com/@BodyweightWarrior/videos').type,'creator');
  for(const u of ['https://youtube.com.evil.test/watch?v=cacwri2wio4','https://evil.test','https://secret@youtube.com/watch?v=cacwri2wio4','https://youtube.com/playlist?list=abc','https://youtube.com:4433/@foo','http://youtube.com/@foo'])assert.throws(()=>Library.parseURL(u));
});
test('personal pools deduplicate shared entries and removals survive stale sync',()=>{
  const v={id:'cacwri2wio4',mode:'morning',title:'Routine',channel:'Creator',length:'6:51',updatedAt:1000};
  const a=Library.clean({'morning:cacwri2wio4':v});
  assert.equal(Library.pool({morning:[['cacwri2wio4','Standard','Creator','6:51']]},a,'morning').length,1);
  const removed=Library.clean({'morning:cacwri2wio4':{...v,removed:true,updatedAt:2000}});
  assert.equal(Library.merge(removed,a)['morning:cacwri2wio4'].removed,true);
  assert.equal(Library.pool({morning:[]},removed,'morning').length,0);
  assert.deepEqual(Library.clean({'__proto__':v,'evening:cacwri2wio4':v}),{});
});
