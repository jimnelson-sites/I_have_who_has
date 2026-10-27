const $=id=>document.getElementById(id);
const views=['home','setup','join','host','student'];
const show=id=>{for(const v of views)$(v).classList.toggle('hidden',v!==id);window.scrollTo({top:0,behavior:'instant'})};
let role=null,code=null,hostToken=null,playerId=null,playerToken=null,playerName='',snapshot=null,qrData='',ticker=null,requesting=false,lastRound=0;
const api=async data=>{const r=await fetch('/.netlify/functions/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),cache:'no-store'});let j;try{j=await r.json()}catch{throw Error('Server unavailable. Check Netlify Functions deployment.')}if(!r.ok)throw Error(j.error||'Server request failed');return j};
function note(message){$('notice').textContent=message;$('notice').classList.remove('hidden');setTimeout(()=>$('notice').classList.add('hidden'),6500)}
function credentials(){return {code,...(role==='teacher'?{hostToken}:{playerId,playerToken})}}
function save(){sessionStorage.setItem('ihwh-session',JSON.stringify({role,code,hostToken,playerId,playerToken,playerName,qrData}))}
function startPolling(){clearInterval(ticker);refresh();ticker=setInterval(refresh,2000)}
const setText=(id,value)=>{$(id).textContent=value};
const timeText=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
async function refresh(){if(requesting||!role||!code)return;requesting=true;try{const state=await api({action:'state',...credentials()});snapshot=state;render(state)}catch(err){if(!navigator.onLine)return;note(err.message);if(err.message.includes('expired')||err.message.includes('not found'))clearInterval(ticker)}finally{requesting=false}}
function showQuiet(view){if($(view).classList.contains('hidden'))show(view)}
function render(s){
 if(role==='teacher'){
  showQuiet('host');setText('hostTitle',s.phase==='lobby'?'Classroom lobby':s.phase==='playing'?'Game in progress':s.phase==='paused'?'Game paused':s.phase==='stopped'?'Round stopped':'Round complete');setText('hostDesc',s.phase==='lobby'?'Students can scan the code to join.':`Round ${s.round} · ${s.players.length} students`);setText('hostCode',s.code);
  $('hostLobby').classList.toggle('hidden',s.phase!=='lobby');$('hostPlay').classList.toggle('hidden',!['playing','paused'].includes(s.phase));$('hostFinish').classList.toggle('hidden',!['finished','stopped'].includes(s.phase));
  if(s.phase==='lobby'){
   $('qr').src=qrData;setText('joinAddress',location.origin+'/?join='+code);setText('playerCount',s.players.length+' joined');
   $('roster').replaceChildren();if(!s.players.length){const el=document.createElement('span');el.className='dim';el.textContent='Waiting for students...';$('roster').append(el)}
   s.players.forEach(p=>{const el=document.createElement('span');el.textContent=p.name;$('roster').append(el)});$('startBtn').disabled=s.players.length<2;
  }
  if(['playing','paused'].includes(s.phase)){
   setText('progressText',`${s.turn} / ${s.total}`);setText('errors',s.errors);$('progressBar').style.width=`${100*s.turn/s.total}%`;
   setText('timer',timeText(s.seconds));setText('recoveryStats',`${s.missed} recovered missed taps · ${s.manualSkips} teacher advances`);
   setText('currentMessage',s.phase==='paused'?'The game is paused':s.turn===0?'The starting student may begin':'Listen for the next answer');
   setText('pauseBtn',s.phase==='paused'?'Resume game':'Pause game');$('skipBtn').disabled=s.phase==='paused';
  }
  if(['finished','stopped'].includes(s.phase)){
   setText('finishTitle',s.phase==='stopped'?'Round stopped':'Loop complete!');
   setText('finishSummary',`${s.turn} of ${s.total} cards · ${timeText(s.seconds)} · ${s.errors} incorrect taps · ${s.missed} recovered missed confirmations · ${s.manualSkips} teacher advances`);
  }
 }else{
  showQuiet('student');setText('studentGreeting',`Hi, ${playerName}!`);setText('studentCode',`Room ${s.code}`);
  $('studentWaiting').classList.toggle('hidden',s.phase!=='lobby');$('studentCardWrap').classList.toggle('hidden',!['playing','paused'].includes(s.phase));$('studentPause').classList.toggle('hidden',s.phase!=='paused');$('studentFinish').classList.toggle('hidden',!['finished','stopped'].includes(s.phase));
  if(s.phase==='lobby')setText('studentWaitingCount',`${s.players.length} student${s.players.length===1?'':'s'} joined so far`);
  if(['playing','paused'].includes(s.phase)&&s.card){
   setText('haveAnswer',s.card.answer);setText('whoQuestion',s.card.question+'?');$('startMessage').classList.toggle('hidden',!(s.isStart&&s.turn===0));
   $('tapBtn').disabled=!!s.completed||s.phase==='paused';setText('tapBtn',s.completed?'Card confirmed ✓':'I Read My Card ✓');
   if(lastRound!==s.round){lastRound=s.round;setText('tapMessage','')}
  }
  if(['finished','stopped'].includes(s.phase)){
   setText('studentFinishTitle',s.phase==='stopped'?'Round stopped':'We did it!');
   setText('studentFinishDesc',s.phase==='stopped'?'Your teacher ended this round. Keep your phone open for another round.':'The complete chain is finished. Keep your phone open in case your class plays again.');
  }
 }
}
$('teacherEntry').addEventListener('click',()=>show('setup'));
$('studentEntry').addEventListener('click',()=>show('join'));
document.querySelectorAll('[data-back]').forEach(x=>x.addEventListener('click',()=>show('home')));
$('setupForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{const r=await api({action:'create',operation:$('operation').value,limit:Number($('limit').value),autoRecover:$('autoRecover').checked});role='teacher';code=r.code;hostToken=r.hostToken;qrData=r.qr;save();show('host');startPolling()}catch(err){note(err.message)}finally{btn.disabled=false}});
$('joinForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{const r=await api({action:'join',code:$('joinCode').value.trim(),name:$('studentName').value.trim()});role='student';code=r.code;playerId=r.playerId;playerToken=r.playerToken;playerName=r.name;save();show('student');startPolling()}catch(err){note(err.message)}finally{btn.disabled=false}});
async function act(action){try{const r=await api({action,...credentials()});await refresh();return r}catch(err){note(err.message);return null}}
$('startBtn').addEventListener('click',()=>act('start'));
$('replayBtn').addEventListener('click',()=>act('replay'));
$('resetBtn').addEventListener('click',()=>{if(confirm('Reopen the lobby and allow new students to join?'))act('reset')});
$('skipBtn').addEventListener('click',()=>{if(confirm('Mark the next expected card as missed and advance one turn?'))act('catchup')});
$('pauseBtn').addEventListener('click',()=>act(snapshot?.phase==='paused'?'resume':'pause'));
$('stopBtn').addEventListener('click',()=>{if(confirm('Stop this round for everyone? Students remain connected for Play Again.'))act('stop')});
$('hintBtn').addEventListener('click',()=>{if(snapshot){setText('hostHint',`Next expected reader: ${snapshot.expected||'Unknown'}. Keep private from class.`);$('hostHint').classList.remove('hidden')}});
$('tapBtn').addEventListener('click',async()=>{const btn=$('tapBtn');btn.disabled=true;try{const r=await api({action:'tap',...credentials()});setText('tapMessage',r.message);$('tapMessage').style.color=r.correct?'#137f78':'#b34336';await refresh()}catch(err){note(err.message)}finally{btn.disabled=!!snapshot?.completed||snapshot?.phase!=='playing'}});
$('copyJoin').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.origin+'/?join='+code);note('Student link copied.')}catch{note('Share this link: '+location.origin+'/?join='+code)}});
const url=new URL(location.href),joinParam=url.searchParams.get('join');
try{const old=JSON.parse(sessionStorage.getItem('ihwh-session')||'null');if(old&&(!joinParam||old.code===joinParam)){({role,code,hostToken,playerId,playerToken,playerName,qrData}=old);show(role==='teacher'?'host':'student');startPolling()}else if(joinParam){$('joinCode').value=joinParam;show('join')}}catch{if(joinParam){$('joinCode').value=joinParam;show('join')}}
