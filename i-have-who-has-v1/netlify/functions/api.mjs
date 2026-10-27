import {getStore} from '@netlify/blobs';
import QRCode from 'qrcode';
import {makeGame,verifyGame} from '../../lib/game.mjs';
import {randomBytes,timingSafeEqual} from 'node:crypto';

const store=()=>getStore({name:'ihwh-rooms-v1',consistency:'strong'});
const random=(len=14)=>randomBytes(len).toString('hex');
const compare=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}});
const fail=(s,status=400)=>reply({error:s},status);
const roomKey=code=>'room/'+code;
const memberKey=(code,id)=>`member/${code}/${id}`;
const getRoom=async(code)=>store().get(roomKey(code),{type:'json',consistency:'strong'});
const getMember=async(code,id)=>store().get(memberKey(code,id),{type:'json',consistency:'strong'});
const members=async(code)=>{
  const all=await store().list({prefix:`member/${code}/`});
  const m=await Promise.all(all.blobs.map(b=>store().get(b.key,{type:'json',consistency:'strong'})));
  return m.filter(Boolean).sort((a,b)=>a.createdAt-b.createdAt).map(x=>({id:x.id,name:x.name}));
};
function publicState(room,viewer,player){
 const started=room.phase==='playing'||room.phase==='finished';
 const own=started&&player?room.game?.cards.find(c=>c.playerId===player.id):null;
 const nextCard=started?room.game?.cards.find(c=>c.playerId===room.currentId):null;
 const host=viewer==='host';
 return {code:room.code,phase:room.phase,settings:room.settings,players:room.players||[],turn:room.turn||0,total:room.players?.length||0,startedAt:room.startedAt||null,finishedAt:room.finishedAt||null,errors:room.errors||0,round:room.round||0,
   card:own?{answer:own.answer,question:own.question}:null,
   isStart:!!(own&&room.turn===0&&own.playerId===room.game.startId),
   expected:host&&nextCard?room.players.find(p=>p.id===room.currentId)?.name:null,
   chain:host&&room.phase==='finished'?room.game.cards.map(c=>({name:room.players.find(p=>p.id===c.playerId)?.name,answer:c.answer,question:c.question})):undefined,
   seconds:room.startedAt?Math.round(((room.finishedAt||Date.now())-room.startedAt)/1000):null};
}
export default async (request)=>{
 try{
 if(request.method!=='POST')return fail('POST required',405);
 let data;try{data=await request.json()}catch{return fail('Invalid JSON')}
 const action=String(data.action||'');
 if(action==='create'){
  const operation=String(data.operation||'addition');const limit=Number(data.limit||20);
  if(!['addition','subtraction','mixed','multiplication'].includes(operation)||![10,20,50,100,144].includes(limit))return fail('Invalid math settings');
  let code;for(let i=0;i<15;i++){const next=''+(100000+Math.floor(Math.random()*900000));if(!await getRoom(next)){code=next;break}}
  if(!code)return fail('Unable to create room',503);
  const hostToken=random();const room={code,hostToken,phase:'lobby',settings:{operation,limit},players:[],createdAt:Date.now(),expiresAt:Date.now()+1000*60*60*8,round:0,turn:0,errors:0};
  await store().setJSON(roomKey(code),room);
  const joinUrl=new URL(request.url);joinUrl.pathname='/';joinUrl.search=`?join=${code}`;
  const qr=await QRCode.toDataURL(joinUrl.toString(),{margin:1,width:360,color:{dark:'#192c37',light:'#ffffff'}});
  return reply({code,hostToken,joinUrl:joinUrl.toString(),qr});
 }
 const code=String(data.code||'').replace(/\D/g,'');if(!/^\d{6}$/.test(code))return fail('Enter a six-digit room code.');
 const room=await getRoom(code);if(!room)return fail('Room not found (or it has expired).',404);
 if(Date.now()>room.expiresAt)return fail('This session has expired. Create a new room.',410);
 const host=compare(data.hostToken,room.hostToken);
 const member=data.playerId?await getMember(code,String(data.playerId)):null;
 const player=member&&compare(data.playerToken,member.token)?member:null;
 if(action==='join'){
  if(room.phase!=='lobby')return fail('This round has already started. Ask the teacher to open a new room.');
  const name=String(data.name||'').trim().replace(/\s+/g,' ').slice(0,35);
  if(name.length<1)return fail('Enter your name.');
  const id=random(10),token=random();const m={id,token,name,createdAt:Date.now()};await store().setJSON(memberKey(code,id),m);
  return reply({playerId:id,playerToken:token,name,code});
 }
 if(action==='state'){
  if(!host&&!player)return fail('This device is not joined to this room.',403);
  const all=room.phase==='lobby'?await members(code):room.players;
  return reply({...publicState({...room,players:all},host?'host':'student',player),players:all});
 }
 if(action==='start'||action==='replay'){
  if(!host)return fail('Teacher access required.',403);
  if(action==='start'&&room.phase!=='lobby')return fail('Game has already started.');
  if(action==='replay'&&room.phase!=='finished')return fail('Finish the current round first.');
  const roster=room.phase==='lobby'?await members(code):room.players;
  if(roster.length<2)return fail('At least two players must join.');
  if(roster.length>40)return fail('Maximum of 40 students.');
  let game;try{game=makeGame(roster,room.settings.operation,room.settings.limit)}catch(e){return fail(e.message)}
  if(!verifyGame(game))return fail('Failed to verify answer chain.',500);
  Object.assign(room,{phase:'playing',players:roster,game,currentId:game.startId,turn:0,errors:0,round:room.round+1,startedAt:Date.now(),finishedAt:null});
  await store().setJSON(roomKey(code),room);
  return reply({...publicState(room,'host',null)});
 }
 if(action==='tap'){
  if(!player)return fail('Student access required.',403);
  if(room.phase!=='playing')return fail('The game is not running.');
  if(!room.players.some(p=>p.id===player.id))return fail('You are not part of this round.');
  if(room.currentId!==player.id){room.errors=(room.errors||0)+1;await store().setJSON(roomKey(code),room);return reply({correct:false,message:'Not your turn yet. Listen for your answer.'});}
  room.turn++;
  if(room.turn>=room.players.length){room.phase='finished';room.finishedAt=Date.now();}
  else{const card=room.game.cards.find(c=>c.playerId===player.id);room.currentId=card.nextId;}
  await store().setJSON(roomKey(code),room);
  return reply({correct:true,message:room.phase==='finished'?'You completed the loop!':'Correct! Chain continued.'});
 }
 if(action==='reset'){
  if(!host)return fail('Teacher access required.',403);
  room.phase='lobby';room.game=null;room.turn=0;room.startedAt=null;room.finishedAt=null;room.errors=0;
  // Existing roster retained for another round, while new students may join.
  await store().setJSON(roomKey(code),room);return reply({ok:true});
 }
 if(action==='skip'){
  if(!host)return fail('Teacher access required.',403);
  if(room.phase!=='playing')return fail('Game is not in progress.');
  const card=room.game.cards.find(c=>c.playerId===room.currentId);
  room.turn++;if(room.turn>=room.players.length){room.phase='finished';room.finishedAt=Date.now()}else room.currentId=card.nextId;
  await store().setJSON(roomKey(code),room);return reply({ok:true});
 }
 return fail('Unknown action',404);
 }catch(err){console.error(err);return fail('Server error. Check Netlify function logs.',500)}
};
