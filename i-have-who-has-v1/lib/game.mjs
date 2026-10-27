export function randomInt(max){return Math.floor(Math.random()*max)}
export function shuffled(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=randomInt(i+1);[b[i],b[j]]=[b[j],b[i]]}return b}
export function expressionFor(n, operation, limit){
  const choices=[];
  if(operation==='addition'||operation==='mixed')for(let a=0;a<=n;a++)choices.push(`${a} + ${n-a}`);
  if(operation==='subtraction'||operation==='mixed')for(let b=0;b<=limit;b++)choices.push(`${n+b} − ${b}`);
  if(operation==='multiplication')for(let a=1;a<=12;a++)if(n%a===0 && n/a<=12) choices.push(`${a} × ${n/a}`);
  if(!choices.length)throw Error('Cannot create expression for '+n);
  return choices[randomInt(choices.length)];
}
export function makeGame(players,operation='addition',limit=20){
 const n=players.length;
 if(n<2||n>40)throw Error('Use 2 to 40 players.');
 let answers;
 if(operation==='multiplication'){
  const products=[...new Set(Array.from({length:12},(_,i)=>i+1).flatMap(a=>Array.from({length:12},(_,j)=>a*(j+1))))].filter(x=>x<=limit);
  if(products.length<n)throw Error(`Not enough distinct multiplication answers. Increase the answer limit (available: ${products.length}, needed: ${n}).`);
  answers=shuffled(products).slice(0,n);
 }else{
  if(limit+1<n)throw Error(`Answer range 0–${limit} supports at most ${limit+1} students. Increase the answer range.`);
  answers=shuffled(Array.from({length:limit+1},(_,i)=>i)).slice(0,n);
 }
 const order=shuffled(players.map((_,i)=>i));
 const cards=players.map((p,i)=>({playerId:p.id, answer:answers[i], question:null, nextId:null}));
 for(let k=0;k<n;k++){
  const from=order[k],to=order[(k+1)%n];
  cards[from].question=expressionFor(answers[to],operation,limit);
  cards[from].nextId=players[to].id;
 }
 return {cards,startId:players[order[0]].id};
}
export function verifyGame(game){
 const seen=new Set(), byId=new Map(game.cards.map(c=>[c.playerId,c]));
 let cursor=game.startId;
 for(let i=0;i<game.cards.length;i++){
  if(seen.has(cursor))return false;
  seen.add(cursor); const card=byId.get(cursor);if(!card||!byId.has(card.nextId))return false;
  cursor=card.nextId;
 }
 return cursor===game.startId && seen.size===game.cards.length;
}
