import {getStore} from '@netlify/blobs';
import QRCode from 'qrcode';
import {makeGame,verifyGame} from '../../lib/game.mjs';
import {randomBytes,timingSafeEqual} from 'node:crypto';

const store=()=>getStore({name:'ihwh-rooms-v1',consistency:'strong'});
const random=(len=14)=>randomBytes(len).toString('hex');
const compare=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const fail=(s,status=400)=>reply({error:s},status);
const roomKey=code=>'room/'+code;
const memberKey=(code,id)=>`member/${code}/${id}`;
const getRoom=async code=>store().get(roomKey(code),{type:'json',consistency:'strong'});
const getMember=async(code,id)=>store().get(memberKey(code,id),{type:'json',consistency:'strong'});
const members=async code=>{
 const all=await store().list({prefix:`member/${code}/`});
 const m=await Promise.all(all.blobs.map(b=>store().get(b.key,{type:'json',consistency:'strong'})));
 return m.filter(Boolean).sort((a,b)=>a.createdAt-b.createdAt).map(x=>({id:x.id,name:x.name}));
};
const elapsedMs=(room,now=Date.now())=>!room.startedAt?0:Math.max(0,(room.finishedAt||now)-room.startedAt-(room.pausedMs||0)-(room.pausedAt?((room.finishedAt||now)-room.pausedAt):0));
function publicState(room,viewer,player){
 const active=['playing','paused','finished','stopped'].includes(room.phase);
 const own=active&&player?room.game?.cards.find(c=>c.playerId===player.id):null;
 const nextCard=active?room.game?.cards.find(c=>c.playerId===room.currentId):null;
 const host=viewer==='host';
 return {code:room.code,phase:room.phase,settings:room.settings,players:room.players||[],turn:room.turn||0,total:room.players?.length||0,startedAt:room.startedAt||null,finishedAt:room.finishedAt||null,errors:room.errors||0,missed:room.missed||0,manualSkips:room.manualSkips||0,round:room.round||0,
 card:own?{answer:own.answer,question:own.question}:null,
 isStart:!!(own&&room.turn===0&&own.playerId===room.game.startId),
 completed:!!(player&&(room.confirmedIds||[]).includes(player.id)),
 expected:host&&nextCard?room.players.find(p=>p.id===room.currentId)?.name:null,
 chain:host&&['finished','stopped'].includes(room.phase)?room.game.cards.map(c=>({name:room.players.find(p=>p.id===c.playerId)?.name,answer:c.answer,question:c.question})):undefined,
 seconds:Math.round(elapsedMs(room)/1000)};
}
// Conditional writes prevent a stale incorrect tap from replacing a later correct turn.
// For heavy concurrent use, a transactional database is still preferable to Blob storage.
async function changeRoom(code,mutate){
 for(let attempt=0;attempt<8;attempt++){
  const entry=await store().getWithMetadata(roomKey(code),{type:'json',consistency:'strong'});
  if(!entry?.data)return {error:'Room not found.',status:404};
  const room=entry.data;
  if(Date.now()>room.expiresAt)return {error:'This session has expired.',status:410};
  const outcome=await mutate(room);
  if(outcome?.error)return outcome;
  if(outcome?.noWrite)return outcome;
  const saved=await store().setJSON(roomKey(code),room,{onlyIfMatch:entry.etag});
  if(saved.modified&&saved.etag)return {...outcome,room};
 }
 return {error:'The room was busy. Please try once more.',status:409};
}
const nextCard=(room,id)=>room.game.cards.find(c=>c.playerId===id);
function advance(room,count=1){
 for(let i=0;i<count&&room.phase==='playing';i++){
  const card=nextCard(room,room.currentId);
  room.turn++;
  if(room.turn>=room.players.length){room.phase='finished';room.finishedAt=Date.now();room.currentId=null;}
  else room.currentId=card.nextId;
 }
}
function requireHost(room,data){return compare(data.hostToken,room.hostToken)}
export default async request=>{
 try{
  if(request.method!=='POST')return fail('POST required',405);
  let data;try{data=await request.json()}catch{return fail('Invalid JSON')}
  const action=String(data.action||'');
  if(action==='create'){
   const operation=String(data.operation||'addition'),limit=Number(data.limit||20);
   if(!['addition','subtraction','mixed','multiplication'].includes(operation)||![10,20,50,100,144].includes(limit))return fail('Invalid math settings');
   let code;for(let i=0;i<15;i++){const candidate=''+(100000+Math.floor(Math.random()*900000));if(!await getRoom(candidate)){code=candidate;break}}
   if(!code)return fail('Unable to create room',503);
   const hostToken=random();
   const room={code,hostToken,phase:'lobby',settings:{operation,limit,autoRecover:data.autoRecover!==false},players:[],createdAt:Date.now(),expiresAt:Date.now()+8*3600000,round:0,turn:0,errors:0,missed:0,manualSkips:0};
   const saved=await store().setJSON(roomKey(code),room,{onlyIfNew:true});if(!saved.modified)return fail('Room collision. Try creating again.',409);
   const joinUrl=new URL(request.url);joinUrl.pathname='/';joinUrl.search=`?join=${code}`;
   const qr=await QRCode.toDataURL(joinUrl.toString(),{margin:1,width:360,color:{dark:'#192c37',light:'#ffffff'}});
   return reply({code,hostToken,joinUrl:joinUrl.toString(),qr});
  }
  const code=String(data.code||'').replace(/\D/g,'');if(!/^\d{6}$/.test(code))return fail('Enter a six-digit room code.');
  const room=await getRoom(code);if(!room)return fail('Room not found (or it has expired).',404);
  if(Date.now()>room.expiresAt)return fail('This session has expired. Create a new room.',410);
  const host=requireHost(room,data);
  const member=data.playerId?await getMember(code,String(data.playerId)):null;
  const player=member&&compare(data.playerToken,member.token)?member:null;
  if(action==='join'){
   if(room.phase!=='lobby')return fail('This round has already started. Ask the teacher to reopen the lobby.');
   const name=String(data.name||'').trim().replace(/\s+/g,' ').slice(0,35);
   if(!name)return fail('Enter your name.');
   const id=random(10),token=random(),m={id,token,name,createdAt:Date.now()};
   await store().setJSON(memberKey(code,id),m,{onlyIfNew:true});
   return reply({playerId:id,playerToken:token,name,code});
  }
  if(action==='state'){
   if(!host&&!player)return fail('This device is not joined to this room.',403);
   const all=room.phase==='lobby'?await members(code):room.players;
   return reply({...publicState({...room,players:all},host?'host':'student',player),players:all});
  }
  const result=await changeRoom(code,async current=>{
   const teacher=requireHost(current,data);
   if(['start','replay','reset','skip','catchup','pause','resume','stop'].includes(action)&&!teacher)return {error:'Teacher access required.',status:403};
   if(action==='start'||action==='replay'){
    if(action==='start'&&current.phase!=='lobby')return {error:'Game already started.'};
    if(action==='replay'&&!['finished','stopped'].includes(current.phase))return {error:'End the round before replaying.'};
    const roster=current.phase==='lobby'?await members(code):current.players;
    if(roster.length<2)return {error:'At least two players must join.'};
    if(roster.length>40)return {error:'Maximum of 40 students.'};
    let game;try{game=makeGame(roster,current.settings.operation,current.settings.limit)}catch(e){return {error:e.message}}
    if(!verifyGame(game))return {error:'Failed to verify answer chain.',status:500};
    Object.assign(current,{phase:'playing',players:roster,game,currentId:game.startId,turn:0,errors:0,missed:0,manualSkips:0,confirmedIds:[],round:current.round+1,startedAt:Date.now(),finishedAt:null,pausedAt:null,pausedMs:0});
    return {ok:true};
   }
   if(action==='tap'){
    if(!player)return {error:'Student access required.',status:403};
    if(current.phase==='paused')return {noWrite:true,response:{correct:false,message:'Game paused. Wait for your teacher.'}};
    if(current.phase!=='playing')return {noWrite:true,response:{correct:false,message:'The round is not running.'}};
    if(!current.players.some(p=>p.id===player.id))return {error:'You are not part of this round.',status:403};
    if((current.confirmedIds||[]).includes(player.id))return {noWrite:true,response:{correct:true,message:'Your card was already confirmed.'}};
    const expected=current.currentId;
    if(expected===player.id){current.confirmedIds=[...(current.confirmedIds||[]),player.id];advance(current);return {response:{correct:true,message:'Correct! Chain continued.'}};}
    const successor=nextCard(current,expected)?.nextId;
    if(current.settings.autoRecover&&successor===player.id){
     current.missed=(current.missed||0)+1;
     advance(current);
     current.confirmedIds=[...(current.confirmedIds||[]),player.id];
     advance(current);
     return {response:{correct:true,message:'Correct! The game caught up after a missed tap.'}};
    }
    current.errors=(current.errors||0)+1;
    return {response:{correct:false,message:'Not your turn yet. Listen for your answer.'}};
   }
   if(action==='pause'){
    if(current.phase!=='playing')return {error:'Only a running game can be paused.'};
    current.pausedAt=Date.now();current.phase='paused';return {ok:true};
   }
   if(action==='resume'){
    if(current.phase!=='paused')return {error:'Game is not paused.'};
    current.pausedMs=(current.pausedMs||0)+Date.now()-current.pausedAt;current.pausedAt=null;current.phase='playing';return {ok:true};
   }
   if(action==='stop'){
    if(!['playing','paused'].includes(current.phase))return {error:'No active game to stop.'};
    if(current.phase==='paused'){current.pausedMs=(current.pausedMs||0)+Date.now()-current.pausedAt;current.pausedAt=null;}
    current.finishedAt=Date.now();current.phase='stopped';return {ok:true};
   }
   if(action==='skip'||action==='catchup'){
    if(current.phase!=='playing')return {error:'Resume the game before advancing.'};
    current.manualSkips=(current.manualSkips||0)+1;advance(current);return {ok:true};
   }
   if(action==='reset'){
    current.phase='lobby';current.game=null;current.turn=0;current.startedAt=null;current.finishedAt=null;current.pausedAt=null;current.pausedMs=0;current.errors=0;current.missed=0;current.manualSkips=0;current.confirmedIds=[];
    return {ok:true};
   }
   return {error:'Unknown action',status:404};
  });
  if(result.error)return fail(result.error,result.status||400);
  if(result.noWrite)return reply(result.response);
  return reply(result.response||{ok:true});
 }catch(err){console.error(err);return fail('Server error. Check Netlify function logs.',500)}
};
