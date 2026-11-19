import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getFirestore, doc, getDoc, getDocs, updateDoc, deleteDoc, collection, onSnapshot, serverTimestamp, query, orderBy, writeBatch, runTransaction } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';

import { newGame, playGame, gameView } from './niuniu.js?v=beta14';

const firebaseConfig = {
  apiKey: "AIzaSyBy1ViD4JUwfYCttJPB6iLvGNk3JOh5pwc",
  authDomain: "scorezero-2e170.firebaseapp.com",
  projectId: "scorezero-2e170",
  storageBucket: "scorezero-2e170.firebasestorage.app",
  messagingSenderId: "295828959553",
  appId: "1:295828959553:web:bf25bc2a20b010d93071c0",
  measurementId: "G-8KYX2HKL0J"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const VERSION = 'ScoreZero beta14';
const ROOM_VERSIONS = [VERSION, 'ScoreZero beta13', 'ScoreZero beta12'];
const DEVICE_KEY = 'scorezero_device_id_beta12';
const LAST_ROOM_KEY = 'scorezero_last_room_beta12';
const LAST_NICKNAME_KEY = 'scorezero_last_nickname';
const LAST_PLAYER_NAMES_KEY = 'scorezero_last_player_names';
const DEFAULT_PLAYER_COUNT = 3;
const ROOM_LIFETIME = 24 * 60 * 60 * 1000;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const deviceId = (() => { let id = localStorage.getItem(DEVICE_KEY); if(!id){ id = uid()+Date.now().toString(36); localStorage.setItem(DEVICE_KEY,id); } return id; })();

let installPromptEvent = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPromptEvent = event;
});

let unsub = [];
let state = {
  screen:'home', modal:null, room:null, toast:'', toastType:'', loading:'', bootReady:false,
  createCount:DEFAULT_PLAYER_COUNT, createRoomName:'', createNames:[], createStart:'0', createZero:true,
  joinCodeDirect:'', joinPreviewCode:'', lobbyRooms:[], lobbyLoading:false, lobbyError:false,
  selectedRoomCode:'', selectedPlayers:null, selectedPlayersError:false,
  joinName:localStorage.getItem(LAST_NICKNAME_KEY)||'',
  quickDraft:{}, quickTouched:{}, pendingRecord:null, recordEdit:null, scoreAnimation:null,
  light:false, awake:false, wakeLock:null, busy:false
};
const HUMOR_ROOM_NAMES = ['讓子彈飛一會','報告班長能贏','方丈為人小心眼','我是跟著鄉民進來看熱鬧的','我全都要俱樂部','威龍闖天關廳','五百萬才胡牌局','周星馳電影同好會','看好了世界我們只賭這把','一言不合就開賭','懂的都懂交易所','哭啊這樣也能贏','高手在民間廳','我就爛俱樂部','五樓你怎麼看廳','麥當勞歡樂送點','神功護體不怕輸','賭神高進VIP','看我把你阿嬤賣掉','你終究是要輸的','阿姨我不想努力了','看戲不嫌事大廳','教練我想打牌','真香定律體驗館','國家級邊緣人聚會','發大財研究所','歸剛欸吵架所','我就問你怎麼輸','可憐哪沒牌胡','大人的世界好複雜','男同俱樂部','德撲無限梭哈王','悠閒德州邊緣人','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘'];
const DEFAULT_QUICK_VALUES = [100,50,10,5,1];
function randomRoomName(){ return HUMOR_ROOM_NAMES[Math.floor(Math.random()*HUMOR_ROOM_NAMES.length)]; }
function fmt(n){ n = Number(n||0); return (n>0?'+':'') + n; }
function scoreClass(n){ return n>0?'pos':n<0?'neg':'zero'; }
function roomActivity(){ const now=Date.now(); return {lastActiveAtMs:now, expiresAtMs:now+ROOM_LIFETIME}; }

function roomRef(code){ return doc(db,'rooms',code); }
function playersRef(code){ return collection(db,'rooms',code,'players'); }
function recordsRef(code){ return collection(db,'rooms',code,'records'); }
function playerKey(code,name){ return `scorezero_player_${code}_${String(name||'').trim()}`; }
function isOwner(){ return state.room?.ownerDeviceId === deviceId; }
function autoBalanceOn(){ return state.room?.autoBalance !== false; }
function total(){ return (state.room?.players||[]).reduce((a,p)=>a+Number(p.score||0),0); }
let toastTimer;
function toast(t,type=''){
  clearTimeout(toastTimer);
  state.toast=t; state.toastType=type; render();
  toastTimer=setTimeout(()=>{state.toast=''; state.toastType=''; render();},type?1400:2200);
}
function clearSubs(){ unsub.forEach(u=>u&&u()); unsub=[]; }
function sortPlayers(players){ return [...players].sort((a,b)=>(a.order||0)-(b.order||0)); }
function calcScores(room){
  const byId = Object.fromEntries(room.rawPlayers.map(p=>{
    const startScore = (p.startGeneration||'') === (room.startGeneration||'') ? Number(p.startScore||0) : 0;
    return [p.id,{...p,startScore,score:startScore}];
  }));
  room.records = room.allRecords.filter(r=>(r.scoreGeneration||'')===(room.scoreGeneration||''));
  room.records.forEach(r => (r.items||[]).forEach(it => { if(byId[it.playerId]) byId[it.playerId].score += Number(it.points||0); }));
  room.players = sortPlayers(Object.values(byId));
}
async function setAwake(on){
  state.awake=on;
  try{
    if(on && 'wakeLock' in navigator){ state.wakeLock = await navigator.wakeLock.request('screen'); }
    else if(state.wakeLock){ await state.wakeLock.release(); state.wakeLock=null; }
  }catch(e){ toast('此瀏覽器不支援螢幕常亮'); }
}

document.addEventListener('visibilitychange', async () => {
  if(document.visibilityState === 'visible' && state.awake){
    try{ if('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen'); }catch(e){}
  }
});

function quickValues(){
  return (state.room?.quickValues || DEFAULT_QUICK_VALUES).filter(Number.isFinite).map(Math.abs).slice(0,5);
}
function quickSettingInputs(){
  const vals = quickValues();
  const filled = [...vals];
  while(filled.length<5) filled.push('');
  return filled.map((v,i)=>`<input class="quickSet" type="number" min="0" inputmode="numeric" aria-label="快捷 ${i+1}" placeholder="快捷 ${i+1}" value="${v}">`).join('');
}

async function saveNewRoom(room, players){
  for(let i=0;i<30;i++){
    const code=String(Math.floor(1000+Math.random()*9000));
    const ref=roomRef(code);
    const newRoom={...room,code};
    const created=await runTransaction(db,async transaction=>{
      if((await transaction.get(ref)).exists()) return false;
      transaction.set(ref,newRoom);
      players.forEach(({id,...data})=>transaction.set(doc(playersRef(code),id),data));
      return true;
    });
    if(created) return newRoom;
  }
  throw new Error('房號產生失敗，請再試一次');
}

async function subscribeRoom(code, initialData={}, initialPlayers=[]){
  clearSubs();
  const base = { ...initialData, code, players:[], rawPlayers:initialPlayers, records:[], allRecords:[] };
  calcScores(base);
  state.room=base;
  state.pendingRecord=null;
  state.scoreAnimation=null;
  unsub.push(onSnapshot(roomRef(code), {includeMetadataChanges:true}, snap => {
    if(state.room?.code!==code) return;
    const data=snap.data();
    const expired=data?.expiresAtMs && Date.now()>Number(data.expiresAtMs);
    // A new room can be missing from the cache until Firestore sends the server snapshot.
    if(snap.metadata.fromCache && (initialPlayers.length || !data || data.closed || expired)) return;
    if(!data){ leaveRoom(); toast('房間不存在'); return; }
    if(data.closed){ leaveRoom(); toast('房間已關閉'); return; }
    if(expired){ closeExpiredRoom(code); return; }
    const wasAuto=autoBalanceOn();
    const wasGeneration=state.room.scoreGeneration||'';
    Object.assign(state.room, data, {code,players:state.room.rawPlayers});
    calcScores(state.room);
    if(wasGeneration!==(data.scoreGeneration||'')){
      state.quickDraft={}; state.quickTouched={}; state.pendingRecord=null; state.recordEdit=null;
      if(['confirmScore','editRecord'].includes(state.modal)) state.modal=null;
    } else if(wasAuto!==autoBalanceOn()) autoFillQuick();
    render();
  }, error => {
    if(state.room?.code!==code) return;
    console.error(error);
    leaveRoom();
    toast('無法讀取房間，請再試一次');
  }));
  unsub.push(onSnapshot(query(playersRef(code), orderBy('order','asc')), {includeMetadataChanges:true}, snap => {
    if(state.room?.code!==code) return;
    if(snap.metadata.fromCache && initialPlayers.length && !snap.size) return;
    state.room.rawPlayers=snap.docs.map(d=>({id:d.id,...d.data()}));
    state.room.players=state.room.rawPlayers;
    calcScores(state.room); render();
  }));
  unsub.push(onSnapshot(query(recordsRef(code), orderBy('createdAtMs','asc')), snap => {
    if(state.room?.code!==code) return;
    const previousScores=new Map(state.room.players.map(p=>[p.id,p.score]));
    const previousSum=total();
    const previousRecords=new Set(state.room.records.map(r=>r.id));
    state.room.allRecords=snap.docs.map(d=>({id:d.id,...d.data()}));
    calcScores(state.room);
    if(state.room.recordsReady && state.room.records.some(r=>!previousRecords.has(r.id))){
      const from=new Map(state.room.players.filter(p=>previousScores.has(p.id) && previousScores.get(p.id)!==p.score)
        .map(p=>[p.id,{start:previousScores.get(p.id),end:p.score}]));
      if(previousSum!==total()) from.set('sum',{start:previousSum,end:total()});
      if(from.size) state.scoreAnimation={from,started:performance.now()};
    }
    state.room.recordsReady=true;
    render();
  }));
  localStorage.setItem(LAST_ROOM_KEY, code);
}

function leaveRoom(){
  clearSubs();
  crownCount=0; clearTimeout(crownTimer);
  Object.assign(state,{screen:'home',room:null,modal:null,pendingRecord:null,recordEdit:null,scoreAnimation:null});
}

function render(){
  if(!state.bootReady){ return; }
  const focusedInput=document.activeElement?.closest?.('#app input[id]');
  const selection=focusedInput && [focusedInput.id,focusedInput.selectionStart,focusedInput.selectionEnd];
  const sheetScroll=$('.modal')?.dataset.modal===state.modal ? $('.sheet')?.scrollTop : 0;
  const game=state.screen==='room' ? state.room?.niuniu : null;
  const oldOverlay=$('.niuOverlay');
  const keepOverlay=!!game && oldOverlay?.dataset.niuSession===game.session && oldOverlay?.dataset.niuStage===game.stage;
  const niuScroll=keepOverlay?oldOverlay.scrollTop:0;
  const wrap=game?' inert':'';
  document.body.classList.toggle('light',state.light);
  $('#app').innerHTML = `<div class="wrap"${wrap}>${views[state.screen]()}</div>${state.toast?`<div class="toast ${state.toastType||''}" role="status">${esc(state.toast)}</div>`:''}${!game&&state.modal?modals[state.modal]():''}${game?gameView(game,niuPlayerId(state.room),isOwner(),esc,fmt):''}${state.loading?loadingView(state.loading):''}`;
  const modal=$('.modal');
  if(modal) modal.dataset.modal=state.modal;
  bind();
  $$('[data-niu-action]').forEach(button=>button.onclick=()=>niuAction(button.dataset.niuAction));
  if(game) bindNiuniu(keepOverlay?oldOverlay:null,niuScroll);
  if(selection){
    const input=document.getElementById(selection[0]);
    input?.focus({preventScroll:true});
    if(selection[1]!==null) input?.setSelectionRange(selection[1],selection[2]);
  }
  if(sheetScroll && $('.sheet')) $('.sheet').scrollTop=sheetScroll;
  animateScores();
}
function loadingView(text){ return `<div class="loadingLayer"><div class="loadingBox"><div class="loaderText">LOADING...</div><div class="loaderBar"><span></span></div><div class="loadingSub">${esc(text)}</div></div></div>`; }
function setLoading(text){ state.loading=text||''; render(); }

let scoreFrame;
function animateScores(){
  cancelAnimationFrame(scoreFrame);
  const animation=state.scoreAnimation;
  if(!animation || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const duration=680;
  const targets=$$('[data-score-value]').filter(el=>animation.from.has(el.dataset.scoreValue));
  function draw(now){
    const elapsed=Math.max(0,now-animation.started);
    const progress=Math.min(1,elapsed/duration);
    const eased=1-(1-progress)**3;
    targets.forEach(el=>{
      const {start,end}=animation.from.get(el.dataset.scoreValue);
      const value=progress===1 ? end : Math.round(start+(end-start)*eased);
      el.textContent=fmt(value);
      el.style.transform=progress===1 ? '' : `scale(${1+0.18*Math.sin(Math.PI*progress)**2})`;
    });
    if(progress<1) scoreFrame=requestAnimationFrame(draw);
    else if(state.scoreAnimation===animation) state.scoreAnimation=null;
  }
  draw(performance.now());
}

const views = {
  home(){ const last=localStorage.getItem(LAST_ROOM_KEY)||''; return `<div class="hero"><div class="brand">ScoreZero 撲克記分板</div><div class="version">本次版本: ${VERSION}</div></div><div class="homeButtons"><button data-act="createSetup">建立房間</button><button class="secondary" data-act="joinSetup">加入房間</button>${last?`<button class="secondary wide" data-act="returnRoom">返回房間 ${esc(last)}</button>`:''}<button class="secondary wide" data-act="installApp">📲 加入手機主畫面</button></div><div class="intro classic"><figure class="tribute"><img src="tribute.webp?v=2" alt="PTT 看板字元風的光頭哥哥畫像" width="384" height="384"><figcaption>致敬光頭哥哥林俊傑</figcaption></figure></div>`; },
  room(){
    const r = state.room;
    if(!r) return `<div class="hero"><div class="brand">載入中...</div></div>`;
    const sum = total();
    const ownerBadge = isOwner()?'<button class="pill crownTrigger" data-niu-action="crown" aria-label="房主皇冠">👑 房主</button>':'<span class="pill">玩家</span>';
    return `<div class="topbar"><div><button class="roomTitleBtn" ${isOwner()?'data-act="editRoomName" title="點擊修改房名"':''}>${esc(r.name||'記分房')}${isOwner()?' <span>✏️</span>':''}</button><div class="sub">房號 ${r.code}　${ownerBadge}</div></div><button class="secondary small" data-act="home">返回大廳</button></div>
    <div class="card scoreCard"><div class="scoreHead"><div class="scoreTitleLine"><h3>目前分數</h3><div class="scoreSumMini ${sum===0?'sumGood':'sumBad'}">總和 <span data-score-value="sum">${fmt(sum)}</span></div></div><span class="pill">${r.players.length} 位玩家</span></div>${[...r.players].sort((a,b)=>b.score-a.score).map(p=>`<div class="player"><div class="pname">${esc(p.name)}<div class="sub">起始 ${p.startScore||0}</div></div><div class="pscore ${scoreClass(p.score)}" data-score-value="${esc(p.id)}">${fmt(p.score)}</div></div>`).join('')}</div>
    <div class="card"><div class="quickHead"><h3>快速計分</h3>${isOwner()?`<button class="secondary small" data-act="toggleAutoBalance" aria-pressed="${autoBalanceOn()}">自動計算：${autoBalanceOn()?'開啟':'關閉'}</button>`:''}</div><div class="quickRows">${r.players.map(p=>quickRow(p)).join('')}</div><button style="width:100%" data-act="submitQuick">提交</button><button style="width:100%;margin-top:8px" class="secondary" data-act="clearQuick">清空快速計分</button></div>
    <div class="card bottomActions"><button class="secondary" data-act="openPlayers">玩家</button><button class="secondary" data-act="openHistory">紀錄</button><button class="secondary" data-act="toggleAwake">${state.awake?'關閉常亮':'螢幕常亮'}</button><button class="secondary" data-act="toggleLight">${state.light?'關燈':'開燈'}</button>${isOwner()?'<button class="danger" data-act="clearRoomRecords">清除本局</button><button class="danger" data-act="closeRoom">關閉房間</button>':''}</div>`;
  }
};

function quickRow(p){
  const v=state.quickDraft[p.id] ?? '';
  const auto=autoBalanceOn() && !state.quickTouched[p.id] && v!=='';
  const vals = quickValues();
  const row=(sign, kind)=>`<div class="qButtonRow" style="--quick-columns:${vals.length}">${vals.map(n=>`<button class="qbtn ${kind}" data-qadd="${sign}${n}" data-pid="${esc(p.id)}">${sign}${n}</button>`).join('')}</div>`;
  return `<div class="quickRow"><div class="qName">${esc(p.name)} <span class="pill" data-qauto="${esc(p.id)}" ${auto?'':'hidden'}>自動</span></div><input id="quick-${esc(p.id)}" class="qInput" data-qplayer="${esc(p.id)}" aria-label="${esc(p.name)} 快速計分" type="text" inputmode="decimal" value="${esc(v)}" placeholder="分數">${vals.length?`<div class="qBtns">${row('+','plus')}${row('-','minus')}</div>`:''}</div>`;
}

const modals = {
  install(){ return `<div class="modal"><div class="sheet"><h2>加入手機主畫面</h2><div class="installSplash"><div class="splashIcon">♠</div><div><b>ScoreZero 撲克記分板</b><p>安裝後可像 App 一樣從手機桌面開啟。</p></div></div><div class="intro classic"><p>iPhone：請用 Safari 開啟，點下方分享按鈕，選「加入主畫面」。</p><p>Android：若瀏覽器跳出安裝提示，按「安裝」即可；也可從瀏覽器選單加入主畫面。</p><p class="muted">請將 icon.png 放在網站根目錄，路徑為 <code>scorezero/icon.png</code> 或部署後同層的 <code>icon.png</code>。</p></div><div class="grid"><button data-act="shareApp">分享</button><button class="secondary" data-act="closeModal">確定</button></div></div></div>`; },
  create(){ return `<div class="modal"><div class="sheet"><h2>建立房間</h2><div class="field"><label for="roomName">房間名稱</label><input id="roomName" value="${esc(state.createRoomName)}"></div><div class="field"><label>玩家數量</label><div class="counter"><button class="secondary" data-act="decCount" aria-label="減少玩家">－</button><strong>${state.createCount}</strong><button class="secondary" data-act="incCount" aria-label="增加玩家">＋</button></div></div><div class="nameInputs">${createNameInputs()}</div><div class="field"><label for="start">起始點數</label><input id="start" type="number" value="${esc(state.createStart)}" inputmode="numeric"></div><label class="check"><input id="zero" type="checkbox" ${state.createZero?'checked':''}> 開啟總和歸零檢查</label><div class="grid"><button data-act="createRoom">建立</button><button class="secondary" data-act="closeModal">取消</button></div></div></div>`; },
  join(){ return `<div class="modal"><div class="sheet joinSheet"><h2>加入房間</h2><div class="field"><label for="joinName">你的暱稱</label><input id="joinName" placeholder="先輸入暱稱" value="${esc(state.joinName)}"></div><div id="joinLobby">${joinLobbyHtml()}</div><div class="grid"><button data-act="loadRooms" ${state.lobbyLoading?'disabled':''}>查詢目前房間</button><button class="secondary" data-act="closeModal">取消</button></div></div></div>`; },
  add(){ const r=state.room; return `<div class="modal"><div class="sheet"><h2>新增紀錄</h2>${r.players.map(p=>`<div class="field"><label>${esc(p.name)}</label><input data-player="${p.id}" type="text" inputmode="decimal" value="0"></div>`).join('')}<div class="field"><label>備註</label><input id="note" placeholder="可不填"></div><div class="grid"><button data-act="submitRecord">送出</button><button class="secondary" data-act="closeModal">取消</button></div></div></div>`; },
  players(){ const r=state.room; return `<div class="modal"><div class="sheet"><h2>玩家管理</h2>${!isOwner()?'<p class="muted">只有房主可以修改玩家。</p>':'<p class="muted">房主可修改名稱、起始分數或移除玩家。</p>'}${r.players.map(p=>`<div class="playerEdit removeGrid"><input data-name="${p.id}" value="${esc(p.name)}" ${!isOwner()?'disabled':''}><input data-start="${p.id}" type="number" inputmode="numeric" value="${p.startScore||0}" ${!isOwner()?'disabled':''}>${isOwner()?`<button class="danger small" data-remplayer="${p.id}">移除</button>`:''}</div>`).join('')}<div class="divider"></div>${isOwner()?`<h3>快速鍵設定</h3><p class="muted">最多 5 個，可填 0；留白的欄位會略過。</p><div class="quickSettingGrid">${quickSettingInputs()}</div><div class="divider"></div><div class="playerEdit"><input id="newPlayer" placeholder="新增玩家暱稱"><input id="newStart" type="number" inputmode="numeric" value="0"></div><div class="grid"><button data-act="savePlayers">儲存</button><button class="secondary" data-act="closeModal">關閉</button></div>`:`<button class="secondary" style="width:100%" data-act="closeModal">關閉</button>`}</div></div>`; },
  history(){ const r=state.room; return `<div class="modal"><div class="sheet"><div class="sheetHead"><h2>歷史紀錄</h2><button class="secondary closeX" data-act="closeModal">×</button></div>${r.records.length?[...r.records].reverse().map((rec,i)=>`<div class="historyItem"><div class="histTop"><span>第 ${r.records.length-i} 筆｜${time(rec.createdAtMs)}</span><div>${isOwner()?`<button class="secondary small" data-editrec="${rec.id}">修改</button><button class="danger small" data-delrec="${rec.id}">刪除</button>`:''}</div></div><div class="changes">${(rec.items||[]).map(it=>`${esc(r.players.find(p=>p.id===it.playerId)?.name||'玩家')} ${fmt(it.points)}`).join('　')}</div>${rec.note?`<div class="sub">${esc(rec.note)}</div>`:''}</div>`).join(''):'<p class="muted">尚無紀錄</p>'}<button class="secondary" style="width:100%" data-act="closeModal">關閉</button></div></div>`; },
  editRecord(){
    const edit=state.recordEdit;
    if(!edit) return '';
    return `<div class="modal"><div class="sheet"><h2>修改紀錄</h2>${state.room.players.map(p=>`<div class="field"><label for="edit-${esc(p.id)}">${esc(p.name)}</label><div class="signedInput"><input id="edit-${esc(p.id)}" data-editplayer="${esc(p.id)}" type="text" inputmode="decimal" value="${esc(edit.points[p.id]??'0')}"><button class="secondary" data-edit-sign="${esc(p.id)}" aria-label="${esc(p.name)} 切換正負號">±</button></div></div>`).join('')}<div class="field"><label for="editNote">備註</label><input id="editNote" value="${esc(edit.note)}"></div><div class="grid"><button data-act="saveRecordEdit">儲存</button><button class="secondary" data-act="openHistory">取消</button></div></div></div>`;
  },
  confirmScore(){
    const pending=state.pendingRecord;
    if(!pending) return '';
    const changes=new Map(pending.items.map(item=>[item.playerId,item.points]));
    const rows=[...state.room.players].sort((a,b)=>b.score-a.score).map(p=>{
      const delta=changes.get(p.id)||0;
      return `<div class="confirmScoreRow"><strong>${esc(p.name)}</strong><span>${fmt(p.score)}</span><span class="${scoreClass(delta)}">${fmt(delta)}</span><b>${fmt(p.score+delta)}</b></div>`;
    }).join('');
    return `<div class="modal confirmScoreModal"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="confirmScoreTitle"><h2 id="confirmScoreTitle">確認本次計分</h2><div class="confirmScoreRow confirmScoreHead"><span>玩家</span><span>目前分數</span><span>增減</span><span>確認後</span></div>${rows}<div class="grid"><button data-act="confirmScore" ${state.busy?'disabled':''}>確認送出</button><button class="secondary" data-act="closeModal" ${state.busy?'disabled':''}>返回修改</button></div></div></div>`;
  }
};


function roomIsActive(room){
  const now=Date.now();
  return !room.closed && (!room.expiresAtMs || now<=Number(room.expiresAtMs)) &&
    (!room.lastActiveAtMs || now-Number(room.lastActiveAtMs)<=ROOM_LIFETIME);
}
function isOwnerName(room, players, name){
  return String(room.ownerName||'').trim()===name ||
    players.some(p=>p.id===room.ownerPlayerId && String(p.name||'').trim()===name);
}
function joinLobbyHtml(){
  const selected=state.lobbyRooms.find(r=>r.code===state.selectedRoomCode);
  const list=state.lobbyLoading ? '<div class="preview">查詢房間中…</div>' :
    state.lobbyError ? '<div class="preview muted">房間列表讀取失敗，請重新查詢。</div>' :
    state.lobbyRooms.length ? state.lobbyRooms.map(r=>`<button class="roomPreviewCard ${r===selected?'selected':''}" data-roompick="${esc(r.code)}" aria-pressed="${r===selected}"><b>${esc(r.name||'記分房')}</b><span>房主：${esc(r.ownerName||'未知')}${r.playerCount===null?'':`｜${r.playerCount} 人`}｜閒置 ${idleText(r.lastActiveAtMs)}</span></button>`).join('') :
    '<div class="preview muted">目前沒有可加入的房間。</div>';
  const direct=selected ? '' : `<div class="field"><label for="joinCodeDirect">輸入房號</label><input id="joinCodeDirect" inputmode="numeric" maxlength="4" placeholder="輸入房號" value="${esc(state.joinCodeDirect)}"></div><button class="secondary joinAction" data-act="joinRoom">透過房號加入</button>`;
  return `${direct}<div class="field"><label>目前房間</label>${list}</div><div id="selectedJoin">${selectedJoinHtml(selected)}</div>`;
}
function selectedJoinHtml(selected=state.lobbyRooms.find(r=>r.code===state.selectedRoomCode)){
  if(!selected) return '';
  const name=state.joinName.trim();
  let content;
  if(!name) content='<p class="muted">請先輸入暱稱。</p>';
  else if(isOwnerName(selected,state.selectedPlayers||[],name)) content='<p class="muted">暱稱不能和房主相同。若你是房主，請用原裝置返回房間。</p>';
  else if(!state.selectedPlayers && !state.selectedPlayersError) content='<p class="muted">確認玩家暱稱中…</p>';
  else {
    const matches=state.selectedPlayers?.some(p=>String(p.name||'').trim()===name);
    const password=matches?'':`<div class="field"><label for="joinCode">房號密碼</label><input id="joinCode" inputmode="numeric" maxlength="4" placeholder="輸入房號" value="${esc(state.joinPreviewCode)}"></div>`;
    content=`${password}<button class="secondary joinAction" data-act="joinRoom">加入選擇房間</button>`;
  }
  return `${content}<button class="secondary small" data-act="clearJoinSelect">取消選擇房間</button>`;
}
let lobbyRequest=0;
let selectedRoomRequest=0;
async function loadLobbyRooms(){
  const request=++lobbyRequest;
  state.lobbyLoading=true;
  state.lobbyError=false;
  render();
  try{
    const snap=await getDocs(collection(db,'rooms'));
    const rooms=snap.docs.map(d=>({...d.data(),code:d.id}))
      .filter(r=>ROOM_VERSIONS.includes(r.version) && roomIsActive(r))
      .sort((a,b)=>Number(b.lastActiveAtMs||0)-Number(a.lastActiveAtMs||0)).slice(0,20);
    const withCounts=await Promise.all(rooms.map(async room=>{
      try { return {...room,playerCount:(await getDocs(playersRef(room.code))).size}; }
      catch { return {...room,playerCount:null}; }
    }));
    if(request!==lobbyRequest || state.modal!=='join') return;
    state.lobbyRooms=withCounts;
    if(!withCounts.some(r=>r.code===state.selectedRoomCode)) clearJoinSelection();
  }catch(e){
    if(request!==lobbyRequest || state.modal!=='join') return;
    state.lobbyError=true;
  }finally{
    if(request===lobbyRequest && state.modal==='join'){ state.lobbyLoading=false; render(); }
  }
}
function clearJoinSelection(){
  selectedRoomRequest++;
  Object.assign(state,{selectedRoomCode:'',joinPreviewCode:'',selectedPlayers:null,selectedPlayersError:false});
}
async function selectLobbyRoom(code){
  clearJoinSelection();
  const request=selectedRoomRequest;
  state.selectedRoomCode=code;
  render();
  try{
    const players=await getDocs(playersRef(code));
    if(request===selectedRoomRequest) state.selectedPlayers=players.docs.map(d=>({...d.data(),id:d.id}));
  }catch{
    if(request===selectedRoomRequest) state.selectedPlayersError=true;
  }
  if(request===selectedRoomRequest && state.modal==='join') render();
}
function idleText(ms){
  if(!ms) return '未知';
  const mins=Math.max(0,Math.floor((Date.now()-Number(ms))/60000));
  if(mins<1) return '剛剛';
  if(mins<60) return mins+' 分鐘';
  return Math.floor(mins/60)+' 小時 '+(mins%60)+' 分鐘';
}
function esc(s=''){ return String(s).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function time(ms){ return ms ? new Date(ms).toLocaleTimeString() : '同步中'; }
function rememberedPlayerNames(){
  try{
    const names=JSON.parse(localStorage.getItem(LAST_PLAYER_NAMES_KEY)||'[]');
    if(Array.isArray(names)) return names;
  }catch {}
  return [];
}
function createNameInputs(){
  return Array.from({length:state.createCount},(_,i)=>{
    const name=state.createNames[i] ?? (i===0 ? localStorage.getItem(LAST_NICKNAME_KEY)||'房主' : '玩家'+(i+1));
    return `<div class="field"><label for="create-player-${i}">玩家 ${i+1}</label><input class="cname" id="create-player-${i}" data-create-name="${i}" value="${esc(name)}"></div>`;
  }).join('');
}
function bindJoinFields(){
  const jcd=$('#joinCodeDirect');
  if(jcd) jcd.oninput=()=>{ state.joinCodeDirect=jcd.value.replace(/\D/g,'').slice(0,4); jcd.value=state.joinCodeDirect; };
  const jc=$('#joinCode');
  if(jc) jc.oninput=()=>{ state.joinPreviewCode=jc.value.replace(/\D/g,'').slice(0,4); jc.value=state.joinPreviewCode; };
}
function bind(){
  $$('[data-act]').forEach(b=>b.onclick=()=>act(b.dataset.act));
  $$('[data-qplayer]').forEach(inp=>{ inp.oninput=()=>{ state.quickTouched[inp.dataset.qplayer]=true; state.quickDraft[inp.dataset.qplayer]=inp.value; autoFillQuick(); syncQuickInputs(); }; });
  $$('[data-qadd]').forEach(b=>{ b.onclick=()=>{
    const id=b.dataset.pid;
    state.quickTouched[id]=true;
    state.quickDraft[id]=String((Number(state.quickDraft[id])||0)+Number(b.dataset.qadd));
    autoFillQuick();
    syncQuickInputs(id);
  }; });
  $$('[data-delrec]').forEach(b=>b.onclick=()=>deleteRecord(b.dataset.delrec));
  $$('[data-editrec]').forEach(b=>b.onclick=()=>openRecordEdit(b.dataset.editrec));
  $$('[data-editplayer]').forEach(input=>input.oninput=()=>{ state.recordEdit.points[input.dataset.editplayer]=input.value; });
  $$('[data-edit-sign]').forEach(button=>button.onclick=()=>{
    const id=button.dataset.editSign;
    const input=document.getElementById('edit-'+id);
    const value=input.value.trim();
    input.value=value.startsWith('-') ? value.slice(1) : '-'+(value==='0'?'':value.replace(/^\+/,''));
    state.recordEdit.points[id]=input.value;
  });
  const editNote=$('#editNote'); if(editNote) editNote.oninput=()=>{ state.recordEdit.note=editNote.value; };
  $$('[data-remplayer]').forEach(b=>b.onclick=()=>removePlayer(b.dataset.remplayer));
  const jn=$('#joinName');
  if(jn) jn.oninput=()=>{
    state.joinName=jn.value;
    const selected=$('#selectedJoin');
    if(selected && state.selectedRoomCode){
      selected.innerHTML=selectedJoinHtml();
      selected.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>act(b.dataset.act));
      bindJoinFields();
    }
  };
  const rn=$('#roomName'); if(rn) rn.oninput=()=>{ state.createRoomName=rn.value; };
  $$('.cname').forEach(input=>input.oninput=()=>{ state.createNames[Number(input.dataset.createName)]=input.value; });
  const start=$('#start'); if(start) start.oninput=()=>{ state.createStart=start.value; };
  const zero=$('#zero'); if(zero) zero.onchange=()=>{ state.createZero=zero.checked; };
  bindJoinFields();
  $$('[data-roompick]').forEach(b=>b.onclick=()=>selectLobbyRoom(b.dataset.roompick));
}
let crownCount=0, crownTimer, niuPending=false;
const niuSeatKey=code=>`scorezero_niuniu_seat_${code}`;

function niuPlayerId(room){
  if(room.ownerDeviceId===deviceId) return room.ownerPlayerId;
  const nickname=localStorage.getItem(LAST_NICKNAME_KEY);
  const id=localStorage.getItem(niuSeatKey(room.code))||localStorage.getItem(playerKey(room.code,nickname));
  return id===room.ownerPlayerId ? null : id;
}

async function niuAction(type,params={}){
  if(type==='lobby'){ leaveRoom(); render(); return; }
  const active=state.room;
  if(!active||niuPending) return;
  if(type==='crown'){
    if(!isOwner()||active.niuniu) return;
    clearTimeout(crownTimer);
    crownCount++;
    if(crownCount<6){
      crownTimer=setTimeout(()=>{crownCount=0;},2500);
      return;
    }
    crownCount=0;
  }
  const {code,niuniu:expected}=active;
  const ref=roomRef(code);
  const actor=niuPlayerId(active);
  niuPending=true;
  try{
    await runTransaction(db,async transaction=>{
      const room=(await transaction.get(ref)).data();
      if(!room||!roomIsActive(room)) throw new Error('房間已關閉或逾期');
      const owner=room.ownerDeviceId===deviceId;
      const current=room.niuniu;
      if(type==='crown'){
        if(!owner||current) return;
        const players=(await getDocs(query(playersRef(code),orderBy('order','asc')))).docs
          .map(d=>({id:d.id,...d.data()}));
        const niuniu=newGame(players,room.ownerPlayerId,uid()+Date.now().toString(36));
        transaction.update(ref,{niuniu,...roomActivity()});
        return;
      }
      if(!current||!expected||current.session!==expected.session||
        current.round!==expected.round||current.stage!==expected.stage) return;
      let scores;
      if(type==='settle'){
        if(actor!==current.banker) throw new Error('只有莊家可以結算');
        const [players,records]=await Promise.all([
          Promise.all(current.players.map(p=>transaction.get(doc(playersRef(code),p.id)))),
          getDocs(query(recordsRef(code),orderBy('createdAtMs','asc')))
        ]);
        if(players.some(p=>!p.exists())) throw new Error('玩家名單已變更，請結束本局後重新開啟妞妞');
        const totals={...room,rawPlayers:players.map(p=>({id:p.id,...p.data()})),allRecords:records.docs.map(d=>d.data())};
        calcScores(totals);
        scores=Object.fromEntries(totals.players.map(p=>[p.id,p.score]));
      }
      const niuniu=playGame(current,{type,...params},{actor,owner,scores});
      if(type==='settle'){
        const record=doc(recordsRef(code),`niuniu-${current.session}-${current.round}`);
        transaction.set(record,{
          items:Object.entries(niuniu.settled.deltas).map(([playerId,points])=>({playerId,points})),
          note:`妞妞第 ${current.round} 局｜底注 ${current.settings.base} 點`,
          createdByDeviceId:deviceId,createdAt:serverTimestamp(),createdAtMs:Date.now(),
          scoreGeneration:room.scoreGeneration||''
        });
      }
      transaction.update(ref,{niuniu,...roomActivity()});
    });
  }catch(error){
    console.error(error);
    if(state.room?.code===code) toast(error.code?'妞妞同步失敗，請再試一次':(error.message||'妞妞同步失敗'));
  }finally{ niuPending=false; }
}

function bindNiuniu(previous,scroll){
  $('.niuOverlay').scrollTop=scroll;
  $$('[data-niu-card]').forEach(button=>button.onclick=()=>{
    const [playerId,index]=button.dataset.niuCard.split(':');
    niuAction('reveal',{playerId,index:Number(index)});
  });
  $$('[data-niu-reveal]').forEach(button=>button.onclick=()=>niuAction('reveal',{playerId:button.dataset.niuReveal}));
  const setup=$('#niuSettings');
  const next=$('#niuNext');
  const game=state.room.niuniu;
  if(setup){
    for(const key of ['bankerMode','fixedBanker','deckMode']) setup.elements[key].value=game.settings[key];
    setup.onsubmit=event=>{
      event.preventDefault();
      const f=new FormData(setup);
      const special=Object.keys(game.settings.special);
      niuAction('configure',{settings:{
        bankerMode:f.get('bankerMode'),fixedBanker:f.get('fixedBanker'),deckMode:f.get('deckMode'),
        base:Number(f.get('base')),lowMax:Number(f.get('highFrom'))-1,
        special:Object.fromEntries(special.map(k=>[k,f.has(k)])),
        multipliers:Object.fromEntries([...special,'high','niu'].map(k=>[k,Number(f.get('m_'+k))]))
      }});
    };
  }
  if(next) next.onsubmit=event=>{
    event.preventDefault();
    const f=new FormData(next);
    niuAction('nextRound',{banker:f.get('nextBanker'),base:Number(f.get('base'))});
  };
  const form=setup||next;
  const saved=form&&previous?.querySelector('form');
  if(saved) for(const input of form.elements){
    const old=input.name&&saved.elements.namedItem(input.name);
    if(!old) continue;
    if(input.type==='checkbox') input.checked=old.checked;
    else input.value=old.value;
  }
}

function syncQuickInputs(changedId){
  $$('[data-qplayer]').forEach(i=>{
    if(document.activeElement!==i || i.dataset.qplayer===changedId) i.value=state.quickDraft[i.dataset.qplayer]??'';
  });
  $$('[data-qauto]').forEach(label=>{
    const id=label.dataset.qauto;
    label.hidden=!autoBalanceOn() || !!state.quickTouched[id] || !state.quickDraft[id];
  });
}
function readPoints(value){
  const text=String(value??'').trim().replace(/^[−－]/,'-').replace(',','.');
  if(!text) return 0;
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || !Number.isFinite(Number(text))) return NaN;
  return Number(text);
}
function autoFillQuick(){
  const players = state.room?.players||[];
  const manual = players.filter(p=>state.quickTouched[p.id]);
  const free = players.filter(p=>!state.quickTouched[p.id]);
  free.forEach(p=>{ state.quickDraft[p.id]=''; });
  if(autoBalanceOn() && players.length>=2 && manual.length===players.length-1 && free.length===1){
    const sum=manual.reduce((a,p)=>a+readPoints(state.quickDraft[p.id]),0);
    if(Number.isFinite(sum)) state.quickDraft[free[0].id]=String(-sum);
  }
}
function currentQuickItems(){ return state.room.players.map(p=>({playerId:p.id,points:readPoints(state.quickDraft[p.id])})); }

function openScoreConfirmation(items,note=''){
  if(items.some(i=>!Number.isFinite(i.points))) return toast('請確認分數格式');
  const changes=items.filter(i=>i.points!==0);
  if(!changes.length) return toast('請先輸入分數');
  state.pendingRecord={items:changes,note,code:state.room.code,generation:state.room.scoreGeneration||''};
  state.modal='confirmScore';
  render();
}

function openRecordEdit(id){
  const rec=state.room.records.find(x=>x.id===id);
  if(!rec || !isOwner()) return;
  state.recordEdit={id,note:rec.note||'',points:Object.fromEntries((rec.items||[]).map(i=>[i.playerId,String(i.points)]))};
  state.modal='editRecord';
  render();
}

async function act(a){
  const r=state.room;
  try{
    if(a==='home'){ leaveRoom(); render(); }
    if(a==='returnRoom') await returnRoom();
    if(a==='installApp') await installApp();
    if(a==='shareApp') await shareApp();
    if(a==='createSetup'){
      Object.assign(state,{modal:'create',createCount:DEFAULT_PLAYER_COUNT,createRoomName:randomRoomName(),createNames:rememberedPlayerNames(),createStart:'0',createZero:true});
      render();
    }
    if(a==='joinSetup'){
      clearJoinSelection();
      Object.assign(state,{modal:'join',joinCodeDirect:'',lobbyRooms:[]});
      await loadLobbyRooms();
    }
    if(a==='closeModal'){ state.modal=null; state.pendingRecord=null; state.recordEdit=null; render(); }
    if(a==='decCount'){ state.createCount=Math.max(1,Number(state.createCount||1)-1); render(); }
    if(a==='incCount'){ state.createCount=Math.min(20,Number(state.createCount||1)+1); render(); }
    if(a==='toggleLight'){ state.light=!state.light; render(); }
    if(a==='toggleAwake'){ await setAwake(!state.awake); render(); }
    if(a==='clearQuick'){ state.quickDraft={}; state.quickTouched={}; render(); }
    if(a==='openPlayers'){ state.modal='players'; render(); }
    if(a==='openHistory'){ state.recordEdit=null; state.modal='history'; render(); }
    if(a==='createRoom') await createRoom();
    if(a==='joinRoom') await joinRoom();
    if(a==='loadRooms') await loadLobbyRooms();
    if(a==='clearJoinSelect'){ clearJoinSelection(); render(); }
    if(a==='closeRoom') await closeRoom();
    if(a==='clearRoomRecords') await clearRoomRecords();
    if(a==='toggleAutoBalance') await toggleAutoBalance();
    if(a==='submitQuick') openScoreConfirmation(currentQuickItems());
    if(a==='confirmScore') await submitRecord();
    if(a==='submitRecord'){
      const items=$$('[data-player]').map(i=>({playerId:i.dataset.player,points:readPoints(i.value)}));
      openScoreConfirmation(items,$('#note').value||'');
    }
    if(a==='editRoomName') await editRoomName();
    if(a==='savePlayers') await savePlayers();
    if(a==='saveRecordEdit') await saveRecordEdit();
  }catch(e){ console.error(e); toast('操作失敗：'+(e.message||e)); }
}


async function installApp(){
  if(window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone){ toast('已是主畫面模式'); return; }
  if(installPromptEvent){
    const promptEvent = installPromptEvent;
    installPromptEvent = null;
    await promptEvent.prompt();
    await promptEvent.userChoice.catch(()=>null);
    render();
  }else{
    state.modal='install';
    render();
  }
}
async function shareApp(){
  const shareData={title:'ScoreZero 撲克記分板', text:'多人同步記分，總和自動檢查。', url:location.href};
  try{ if(navigator.share) await navigator.share(shareData); else { await navigator.clipboard.writeText(location.href); toast('網址已複製'); } }
  catch(e){}
}

async function returnRoom(){
  const c=localStorage.getItem(LAST_ROOM_KEY)||'';
  if(!/^\d{4}$/.test(c)) return toast('尚無可返回房間');
  setLoading('返回房間中');
  try{
    const snap=await getDoc(roomRef(c));
    if(!snap.exists()) return toast('房間不存在或已關閉');
    const data=snap.data();
    if(data.closed) return toast('房間已關閉');
    if(data.expiresAtMs && Date.now()>Number(data.expiresAtMs)){ await closeExpiredRoom(c); return toast('房間已閒置超過 24 小時'); }
    state.quickDraft={}; state.quickTouched={}; state.screen='room'; state.modal=null;
    await updateDoc(roomRef(c), roomActivity());
    await subscribeRoom(c,data);
  } finally { setLoading(''); }
}
async function editRoomName(){
  if(!isOwner()) return;
  const name=prompt('請輸入新的房間名稱', state.room?.name||'記分房');
  if(name===null) return;
  const v=name.trim();
  if(!v) return toast('房名不可空白');
  await updateDoc(roomRef(state.room.code), { name:v, lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 });
  toast('房名已更新');
}

async function createRoom(){
  if(state.busy) return; state.busy=true;
  try{
    const names=$$('.cname').map(i=>i.value.trim());
    const start=readPoints(state.createStart);
    if(names.some(name=>!name)) return toast('請填寫每位玩家的暱稱');
    if(new Set(names).size!==names.length) return toast('玩家暱稱不可重複');
    if(!Number.isFinite(start)) return toast('請確認起始分數格式');
    setLoading('建立房間中');
    const ownerPlayerId = uid();
    const createdAtMs=Date.now();
    const room={
      name:state.createRoomName.trim()||randomRoomName(), version:VERSION,
      zeroCheck:state.createZero, ownerDeviceId:deviceId, ownerPlayerId, ownerName:names[0],
      defaultStart:start, quickValues:DEFAULT_QUICK_VALUES, autoBalance:true, closed:false,
      createdAt:serverTimestamp(), createdAtMs, ...roomActivity()
    };
    const players=names.map((name,order)=>({
      id:order===0?ownerPlayerId:uid(), name, startScore:start, order,
      joinedAt:serverTimestamp(), joinedAtMs:createdAtMs+order
    }));
    const created=await saveNewRoom(room,players);
    localStorage.setItem(LAST_NICKNAME_KEY,names[0]);
    localStorage.setItem(LAST_PLAYER_NAMES_KEY,JSON.stringify(names));
    state.joinName=names[0];
    localStorage.setItem(playerKey(created.code,names[0]), ownerPlayerId);
    state.quickDraft={}; state.quickTouched={}; state.screen='room'; state.modal=null;
    await subscribeRoom(created.code,created,players);
  } finally { state.busy=false; setLoading(''); }
}
async function joinRoom(){
  const name=state.joinName.trim();
  if(!name) return toast('請先輸入暱稱');
  const selected=state.selectedRoomCode;
  const c=selected||state.joinCodeDirect;
  const typed=selected?state.joinPreviewCode:state.joinCodeDirect;
  if(!/^\d{4}$/.test(c)) return toast('請輸入 4 碼房號');
  if(state.busy) return; state.busy=true;
  setLoading('加入房間中');
  try{
    const newPlayerId=uid();
    const result=await runTransaction(db,async transaction=>{
      const ref=roomRef(c);
      const snap=await transaction.get(ref);
      if(!snap.exists()) return {error:'找不到房間'};
      const room=snap.data();
      if(room.closed) return {error:'房間已關閉'};
      if(!roomIsActive(room)) return {error:'房間已閒置超過 24 小時'};
      const ps=await getDocs(playersRef(c));
      const players=ps.docs.map(d=>({...d.data(),id:d.id}));
      if(isOwnerName(room,players,name)) return {error:'暱稱不能和房主相同。若你是房主，請返回房間。'};
      const existing=players.find(p=>String(p.name||'').trim()===name);
      if(selected && !existing && typed!==c) return {error:typed?'房號密碼錯誤':'請輸入 4 碼房號'};
      if(!existing){
        const now=Date.now();
        transaction.set(doc(playersRef(c),newPlayerId),{
          name,startScore:Number(room.defaultStart||0),startGeneration:room.startGeneration||'',
          order:now,joinedAt:serverTimestamp(),joinedAtMs:now
        });
      }
      const activity=roomActivity();
      transaction.update(ref,activity);
      return {room:{...room,...activity},playerId:existing?.id||newPlayerId};
    });
    if(result.error) return toast(result.error);
    localStorage.setItem(LAST_NICKNAME_KEY,name);
    localStorage.setItem(playerKey(c,name),result.playerId);
    localStorage.setItem(niuSeatKey(c),result.playerId);
    state.joinName=name;
    state.quickDraft={}; state.quickTouched={}; state.screen='room'; state.modal=null;
    await subscribeRoom(c,result.room);
  } finally { state.busy=false; setLoading(''); }
}
async function submitRecord(){
  const pending=state.pendingRecord;
  if(!pending || state.busy) return;
  state.busy=true;
  render();
  try{
    const ref=roomRef(pending.code);
    const record=doc(recordsRef(pending.code));
    await runTransaction(db,async transaction=>{
      const snap=await transaction.get(ref);
      if(!snap.exists() || !roomIsActive(snap.data())) throw new Error('房間已關閉或逾時');
      if((snap.data().scoreGeneration||'')!==pending.generation) throw new Error('計分已清空，請重新輸入');
      const players=await Promise.all(pending.items.map(i=>transaction.get(doc(playersRef(pending.code),i.playerId))));
      if(players.some(player=>!player.exists())) throw new Error('玩家名單已變更，請重新輸入');
      transaction.set(record,{
        items:pending.items,note:pending.note,createdByDeviceId:deviceId,
        createdAt:serverTimestamp(),createdAtMs:Date.now(),scoreGeneration:pending.generation
      });
      transaction.update(ref,roomActivity());
    });
    state.quickDraft={}; state.quickTouched={}; state.pendingRecord=null; state.modal=null;
    toast('已提交','scoreSaved');
    $('.scoreCard')?.scrollIntoView({block:'start'});
  }finally{
    state.busy=false;
    render();
  }
}
async function undo(){
  if(!isOwner()) return toast('只有房主可以撤銷');
  const last=[...(state.room.records||[])].pop(); if(!last) return toast('沒有可撤銷紀錄');
  await deleteDoc(doc(db,'rooms',state.room.code,'records',last.id)); await updateDoc(roomRef(state.room.code), { lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 }); toast('已撤銷上一筆');
}
async function deleteRecord(id){ if(!isOwner()) return toast('只有房主可以刪除'); await deleteDoc(doc(db,'rooms',state.room.code,'records',id)); await updateDoc(roomRef(state.room.code), { lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 }); state.modal='history'; toast('已刪除'); }
async function saveRecordEdit(){
  if(!isOwner()) return toast('只有房主可以修改');
  const edit=state.recordEdit;
  const code=state.room.code;
  const inputs=state.room.players.map(p=>({playerId:p.id,points:readPoints(edit.points[p.id])}));
  if(inputs.some(i=>!Number.isFinite(i.points))) return toast('請確認分數格式');
  const items=inputs.filter(i=>i.points!==0);
  const ref=roomRef(code);
  const record=doc(recordsRef(code),edit.id);
  await runTransaction(db,async transaction=>{
    const [room,rec]=await Promise.all([transaction.get(ref),transaction.get(record)]);
    if(room.data()?.ownerDeviceId!==deviceId) throw new Error('只有房主可以修改');
    if(!rec.exists() || (rec.data().scoreGeneration||'')!==(room.data().scoreGeneration||'')) throw new Error('這筆計分已清除');
    transaction.update(record,{items,note:edit.note,editedAt:serverTimestamp(),editedAtMs:Date.now()});
    transaction.update(ref,roomActivity());
  });
  state.recordEdit=null; state.modal='history'; toast('已修改');
}
async function savePlayers(){
  if(!isOwner()) return toast('只有房主可以修改玩家');
  const {code,startGeneration}=state.room;
  const current=state.room.players.map(p=>({
    id:p.id,
    name:document.querySelector(`[data-name="${p.id}"]`).value.trim(),
    startScore:readPoints(document.querySelector(`[data-start="${p.id}"]`).value)
  }));
  const newName=$('#newPlayer').value.trim();
  const newStart=readPoints($('#newStart').value);
  const names=current.map(p=>p.name).concat(newName?[newName]:[]);
  if(names.some(name=>!name)) return toast('玩家暱稱不可空白');
  if(new Set(names).size!==names.length) return toast('玩家暱稱不可重複');
  if(current.some(p=>!Number.isFinite(p.startScore)) || !Number.isFinite(newStart)) return toast('請確認起始分數格式');
  const values=$$('.quickSet').filter(i=>i.value.trim()!=='').map(i=>Number(i.value));
  if(values.some(n=>!Number.isFinite(n) || n<0)) return toast('快速鍵請輸入 0 或正數');
  const newId=uid();
  await runTransaction(db,async transaction=>{
    const ref=roomRef(code);
    const snapshot=await transaction.get(ref);
    const room=snapshot.data();
    if(room?.ownerDeviceId!==deviceId) throw new Error('只有房主可以修改');
    if((room.startGeneration||'')!==(startGeneration||'')) throw new Error('計分已清空，請重新開啟玩家設定');
    const actual=await getDocs(playersRef(code));
    const seenIds=new Set(current.map(p=>p.id));
    const addedNames=actual.docs.filter(d=>!seenIds.has(d.id)).map(d=>String(d.data().name).trim());
    if(addedNames.some(name=>names.includes(name))) throw new Error('有玩家剛加入且暱稱重複，請重新開啟玩家設定');
    current.forEach(({id,name,startScore})=>{
      transaction.update(doc(playersRef(code),id),{name,startScore,startGeneration:room.startGeneration||''});
    });
    if(newName){
      const now=Date.now();
      transaction.set(doc(playersRef(code),newId),{
        name:newName,startScore:newStart,startGeneration:room.startGeneration||'',order:now,joinedAt:serverTimestamp(),joinedAtMs:now
      });
    }
    const owner=current.find(p=>p.id===room.ownerPlayerId);
    transaction.update(ref,{quickValues:values,...(owner?{ownerName:owner.name}:{}),...roomActivity()});
  });
  state.modal=null; toast('已儲存');
}

async function toggleAutoBalance(){
  if(!isOwner()) return toast('只有房主可以切換自動計算');
  const ref=roomRef(state.room.code);
  await runTransaction(db,async transaction=>{
    const snap=await transaction.get(ref);
    if(snap.data()?.ownerDeviceId!==deviceId) throw new Error('只有房主可以切換自動計算');
    transaction.update(ref,{autoBalance:snap.data().autoBalance===false,...roomActivity()});
  });
}

async function removePlayer(id){
  if(!isOwner()) return toast('只有房主可以移除玩家');
  if(state.room.players.length<=1) return toast('至少需保留 1 位玩家');
  if(id===state.room.ownerPlayerId) return toast('房主玩家不可直接移除');
  if(!confirm('確定要移除這位玩家？相關歷史紀錄仍會保留，但名稱可能顯示為玩家。')) return;
  await deleteDoc(doc(db,'rooms',state.room.code,'players',id));
  toast('已移除玩家');
}
async function clearRoomRecords(){
  if(!isOwner()) return toast('只有房主可以清除本局');
  if(state.busy || !confirm('確定清除本局計分與歷史紀錄？玩家會保留。')) return;
  const code=state.room.code;
  const generation=uid();
  state.busy=true;
  setLoading('清除本局中');
  try{
    const ref=roomRef(code);
    const previous=await runTransaction(db,async transaction=>{
      const room=(await transaction.get(ref)).data();
      if(room?.ownerDeviceId!==deviceId) throw new Error('只有房主可以清除計分');
      transaction.update(ref,{scoreGeneration:generation,niuniu:null,...roomActivity()});
      return room.scoreGeneration||'';
    });
    // 切換記分世代後才刪舊紀錄，避免清空時刪到別人剛提交的新分數。
    try{
      const records=(await getDocs(recordsRef(code))).docs.filter(d=>(d.data().scoreGeneration||'')===previous);
      for(let i=0;i<records.length;i+=450){
        const batch=writeBatch(db);
        records.slice(i,i+450).forEach(d=>batch.delete(d.ref));
        await batch.commit();
      }
    }catch(e){ console.warn('無法刪除已清空的舊紀錄',e); }
    state.quickDraft={}; state.quickTouched={};
    state.modal=null;
    toast('本局已清除','success');
  } finally { state.busy=false; setLoading(''); }
}

async function closeRoom(){
  if(!isOwner()) return toast('只有房主可以關閉房間');
  if(!confirm('確定關閉房間？關閉後其他人將無法再進入。')) return;
  setLoading('關閉房間中');
  try{ await deleteRoomTree(state.room.code); leaveRoom(); toast('房間已關閉'); }
  finally{ setLoading(''); }
}
async function closeExpiredRoom(code){
  try{ await deleteRoomTree(code); }catch(e){ console.warn(e); }
  if(state.room?.code===code){ leaveRoom(); render(); }
}
async function deleteRoomTree(code){
  const batch=writeBatch(db);
  const ps=await getDocs(playersRef(code)); ps.forEach(d=>batch.delete(d.ref));
  const rs=await getDocs(recordsRef(code)); rs.forEach(d=>batch.delete(d.ref));
  batch.delete(roomRef(code));
  await batch.commit();
}

const last = new URLSearchParams(location.search).get('room') || '';
if(last && /^\d{4}$/.test(last)){ state.screen='room'; subscribeRoom(last); }
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('Service worker registration failed',e));
}
setTimeout(()=>{ state.bootReady=true; render(); }, 500);
