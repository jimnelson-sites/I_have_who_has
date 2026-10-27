import test from 'node:test';import assert from 'node:assert/strict';import {makeGame,verifyGame} from '../lib/game.mjs';
for(const op of ['addition','subtraction','mixed','multiplication'])test(op+' complete single chain',()=>{
 const players=Array.from({length:20},(_,i)=>({id:'p'+i}));for(let k=0;k<100;k++){
 const g=makeGame(players,op,op==='multiplication'?144:20);
 assert.ok(verifyGame(g));assert.equal(new Set(g.cards.map(c=>c.answer)).size,20);
 for(const c of g.cards){const target=g.cards.find(x=>x.playerId===c.nextId);const vals=c.question.match(/\d+/g).map(Number);let v;
 if(c.question.includes('+'))v=vals[0]+vals[1]; else if(c.question.includes('−'))v=vals[0]-vals[1];else v=vals[0]*vals[1];assert.equal(v,target.answer)}
 }
});
test('reject impossible answer range',()=>assert.throws(()=>makeGame(Array.from({length:20},(_,i)=>({id:''+i})),'addition',10)));
