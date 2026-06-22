import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, addDoc, onSnapshot, serverTimestamp, query, orderBy, writeBatch } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';

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
const VERSION = 'ScoreZero beta7';
const DEVICE_KEY = 'scorezero_device_id_beta7';
const LAST_ROOM_KEY = 'scorezero_last_room_beta7';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const deviceId = (() => { let id = localStorage.getItem(DEVICE_KEY); if(!id){ id = uid()+Date.now().toString(36); localStorage.setItem(DEVICE_KEY,id); } return id; })();

let unsub = [];
let state = { screen:'home', modal:null, room:null, toast:'', toastType:'', loading:'', bootReady:false, createCount:1, createRoomName:'', joinCodeDirect:'', quickDraft:{}, quickTouched:{}, light:false, awake:false, wakeLock:null, editRecId:null, joinPreview:null, joinPreviewCode:'', lobbyRooms:[], lobbyLoading:false, selectedRoomCode:'', joinName:'', busy:false };
const HUMOR_ROOM_NAMES = ['讓子彈飛一會','報告班長能贏','方丈為人小心眼','我是跟著鄉民進來看熱鬧的','我全都要俱樂部','威龍闖天關廳','五百萬才胡牌局','周星馳電影同好會','看好了世界我們只賭這把','一言不合就開賭','懂的都懂交易所','哭啊這樣也能贏','高手在民間廳','我就爛俱樂部','五樓你怎麼看廳','麥當勞歡樂送點','神功護體不怕輸','賭神高進VIP','看我把你阿嬤賣掉','你終究是要輸的','阿姨我不想努力了','看戲不嫌事大廳','教練我想打牌','真香定律體驗館','國家級邊緣人聚會','發大財研究所','歸剛欸吵架所','我就問你怎麼輸','可憐哪沒牌胡','大人的世界好複雜','男同俱樂部','德撲無限梭哈王','悠閒德州邊緣人','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘','屁↗眼↘派↗對↘'];
const DEFAULT_QUICK_VALUES = [100,50,10,5,1];
function randomRoomName(){ return HUMOR_ROOM_NAMES[Math.floor(Math.random()*HUMOR_ROOM_NAMES.length)]; }
function fmt(n){ n = Number(n||0); return (n>0?'+':'') + n; }

function roomRef(code){ return doc(db,'rooms',code); }
function playersRef(code){ return collection(db,'rooms',code,'players'); }
function recordsRef(code){ return collection(db,'rooms',code,'records'); }
function playerKey(code,name){ return `scorezero_player_${code}_${String(name||'').trim()}`; }
function isOwner(){ return state.room?.ownerDeviceId === deviceId; }
function total(){ return (state.room?.players||[]).reduce((a,p)=>a+Number(p.score||0),0); }
function toast(t,type=''){ state.toast=t; state.toastType=type; render(); setTimeout(()=>{state.toast=''; state.toastType=''; render();}, type==='success'?1400:2200); }
function clearSubs(){ unsub.forEach(u=>u&&u()); unsub=[]; }
function sortPlayers(players){ return [...players].sort((a,b)=>(a.order||0)-(b.order||0)); }
function calcScores(room){
  const byId = Object.fromEntries(room.players.map(p=>[p.id,{...p,score:Number(p.startScore||0)}]));
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
  const vals = (state.room?.quickValues || DEFAULT_QUICK_VALUES).map(v=>Math.abs(Number(v||0))).filter(v=>v>0);
  return vals.slice(0,5);
}

async function genRoomCode(){
  for(let i=0;i<30;i++){
    const c = String(Math.floor(1000 + Math.random()*9000));
    if(!(await getDoc(roomRef(c))).exists()) return c;
  }
  throw new Error('房號產生失敗，請再試一次');
}

async function subscribeRoom(code){
  clearSubs();
  const base = { code, players:[], records:[] };
  unsub.push(onSnapshot(roomRef(code), snap => {
    if(!snap.exists()){ toast('房間不存在'); state.screen='home'; state.room=null; render(); return; }
    const data=snap.data();
    if(data.closed){ toast('房間已關閉'); clearSubs(); state.screen='home'; state.room=null; render(); return; }
    if(data.expiresAtMs && Date.now()>Number(data.expiresAtMs)){ closeExpiredRoom(code); return; }
    state.room = { ...base, ...(state.room||{}), code, ...data };
    calcScores(state.room); render();
  }));
  unsub.push(onSnapshot(query(playersRef(code), orderBy('order','asc')), snap => {
    const players = snap.docs.map(d=>({id:d.id,...d.data()}));
    state.room = { ...(state.room||base), code, players };
    calcScores(state.room); render();
  }));
  unsub.push(onSnapshot(query(recordsRef(code), orderBy('createdAtMs','asc')), snap => {
    const records = snap.docs.map(d=>({id:d.id,...d.data()}));
    state.room = { ...(state.room||base), code, records };
    calcScores(state.room); render();
  }));
  localStorage.setItem(LAST_ROOM_KEY, code);
}

function render(){
  if(!state.bootReady){ return; }
  document.body.classList.toggle('light',state.light);
  $('#app').innerHTML = `<div class="wrap">${views[state.screen]()}${state.toast?`<div class="toast ${state.toastType||''}">${state.toast}</div>`:''}</div>${state.modal?modals[state.modal]():''}${state.loading?loadingView(state.loading):''}`;
  bind();
}
function loadingView(text){ return `<div class="loadingLayer"><div class="loadingBox"><div class="loaderText">LOADING...</div><div class="loaderBar"><span></span></div><div class="loadingSub">${esc(text)}</div></div></div>`; }
function setLoading(text){ state.loading=text||''; render(); }

const views = {
  home(){ const last=localStorage.getItem(LAST_ROOM_KEY)||''; return `<div class="hero"><div class="brand">ScoreZero 撲克記分板</div><div class="version">本次版本: ${VERSION}</div></div><div class="homeButtons"><button data-act="createSetup">建立房間</button><button class="secondary" data-act="joinSetup">加入房間</button>${last?`<button class="secondary wide" data-act="returnRoom">返回房間 ${esc(last)}</button>`:''}</div><div class="intro classic"><b>功能小序</b><p>凡友朋戲局，分數往來，最忌口算紛亂。本板以四碼入房，眾人同記；分合即明，總和歸零，勝負有據。</p><p>然牌戲怡情，不可沉迷；以賭為業者，實為下策。願君記分而不迷財，遊戲而不失度。</p><p></p><p>末流 TingYo 題</p></div>`; },
  room(){
    const r = state.room;
    if(!r) return `<div class="hero"><div class="brand">載入中...</div></div>`;
    const sum = total();
    const ownerBadge = isOwner()?'<span class="pill">👑 房主</span>':'<span class="pill">玩家</span>';
    return `<div class="topbar"><div><button class="roomTitleBtn" ${isOwner()?'data-act="editRoomName" title="點擊修改房名"':''}>${esc(r.name||'記分房')}${isOwner()?' <span>✏️</span>':''}</button><div class="sub">房號 ${r.code}　${ownerBadge}</div></div><button class="secondary small" data-act="home">返回大廳</button></div>
    <div class="card scoreCard"><div class="scoreHead"><div class="scoreTitleLine"><h3>目前分數</h3><div class="scoreSumMini ${sum===0?'sumGood':'sumBad'}">總和 ${fmt(sum)}</div></div><span class="pill">${r.players.length} 位玩家</span></div>${[...r.players].sort((a,b)=>b.score-a.score).map(p=>`<div class="player"><div class="pname">${esc(p.name)}<div class="sub">起始 ${p.startScore||0}</div></div><div class="pscore ${p.score>0?'pos':p.score<0?'neg':'zero'}">${fmt(p.score)}</div></div>`).join('')}</div>
    <div class="card"><h3>快速計分</h3><div class="sub">連按會加總，最後一位玩家系統自動填入</div><div class="quickRows">${r.players.map(p=>quickRow(p)).join('')}</div><button style="width:100%" data-act="submitQuick">提交</button><button style="width:100%;margin-top:8px" class="secondary" data-act="clearQuick">清空快速計分</button></div>
    <div class="card bottomActions"><button class="secondary" data-act="openPlayers">玩家</button><button class="secondary" data-act="openHistory">紀錄</button><button class="secondary" data-act="toggleAwake">${state.awake?'關閉常亮':'螢幕常亮'}</button><button class="secondary" data-act="toggleLight">${state.light?'關燈':'開燈'}</button>${isOwner()?'<button class="danger" data-act="clearRoomRecords">清除本局</button><button class="danger" data-act="closeRoom">關閉房間</button>':''}</div>`;
  }
};

function quickRow(p){
  let v = state.quickDraft[p.id]; if(v===undefined) v='';
  const auto = !state.quickTouched[p.id] && v!=='' ? '<span class="pill">自動</span>' : '';
  const vals = quickValues();
  const btns = [...vals.map(v=>-v), ...vals];
  return `<div class="quickRow"><div class="qName">${esc(p.name)} ${auto}</div><input class="qInput" data-qplayer="${p.id}" type="text" inputmode="decimal" value="${v}" placeholder="分數"><div class="qBtns">${btns.map(n=>`<button class="qbtn ${n<0?'minus':'plus'}" data-qadd="${n}" data-pid="${p.id}">${fmt(n)}</button>`).join('')}</div></div>`;
}

const modals = {
  create(){ return `<div class="modal"><div class="sheet"><h2>建立房間</h2><div class="field"><label>房間名稱</label><input id="roomName" value="${esc(state.createRoomName||randomRoomName())}"></div><div class="field"><label>玩家數量</label><div class="counter"><button class="secondary" data-act="decCount">－</button><strong>${state.createCount}</strong><button class="secondary" data-act="incCount">＋</button></div></div><div id="nameInputs" class="nameInputs">${createNameInputs()}</div><div class="field"><label>起始點數</label><input id="start" type="number" value="0" inputmode="numeric"></div><label class="check"><input id="zero" type="checkbox" checked> 開啟總和歸零檢查</label><div class="grid"><button data-act="createRoom">建立</button><button class="secondary" data-act="closeModal">取消</button></div></div></div>`; },
  join(){ return `<div class="modal"><div class="sheet"><h2>加入房間</h2><div class="field"><label>你的暱稱</label><input id="joinName" placeholder="先輸入暱稱" value="${esc(state.joinName||'')}"></div>${joinLobbyHtml()}<div class="grid"><button data-act="loadRooms">查詢目前房間</button><button class="secondary" data-act="closeModal">取消</button></div></div></div>`; },
  add(){ const r=state.room; return `<div class="modal"><div class="sheet"><h2>新增紀錄</h2>${r.players.map(p=>`<div class="field"><label>${esc(p.name)}</label><input data-player="${p.id}" type="text" inputmode="decimal" value="0"></div>`).join('')}<div class="field"><label>備註</label><input id="note" placeholder="可不填"></div><div class="grid"><button data-act="submitRecord">送出</button><button class="secondary" data-act="closeModal">取消</button></div></div></div>`; },
  players(){ const r=state.room; return `<div class="modal"><div class="sheet"><h2>玩家管理</h2>${!isOwner()?'<p class="muted">只有房主可以修改玩家。</p>':'<p class="muted">房主可修改名稱、起始分數或移除玩家。</p>'}${r.players.map(p=>`<div class="playerEdit removeGrid"><input data-name="${p.id}" value="${esc(p.name)}" ${!isOwner()?'disabled':''}><input data-start="${p.id}" type="number" inputmode="numeric" value="${p.startScore||0}" ${!isOwner()?'disabled':''}>${isOwner()?`<button class="danger small" data-remplayer="${p.id}">移除</button>`:''}</div>`).join('')}<div class="divider"></div>${isOwner()?`<h3>快速鍵設定</h3><p class="muted">輸入正數，最多 5 個；系統會自動產生正負按鈕。</p><div class="quickSettingGrid">${quickSettingInputs()}</div><div class="divider"></div><div class="playerEdit"><input id="newPlayer" placeholder="新增玩家暱稱"><input id="newStart" type="number" inputmode="numeric" value="0"></div><div class="grid"><button data-act="savePlayers">儲存</button><button class="secondary" data-act="closeModal">關閉</button></div>`:`<button class="secondary" style="width:100%" data-act="closeModal">關閉</button>`}</div></div>`; },
  history(){ const r=state.room; return `<div class="modal"><div class="sheet"><div class="sheetHead"><h2>歷史紀錄</h2><button class="secondary closeX" data-act="closeModal">×</button></div>${r.records.length?[...r.records].reverse().map((rec,i)=>`<div class="historyItem"><div class="histTop"><span>第 ${r.records.length-i} 筆｜${time(rec.createdAtMs)}</span><div>${isOwner()?`<button class="secondary small" data-editrec="${rec.id}">修改</button><button class="danger small" data-delrec="${rec.id}">刪除</button>`:''}</div></div><div class="changes">${(rec.items||[]).map(it=>`${esc(r.players.find(p=>p.id===it.playerId)?.name||'玩家')} ${fmt(it.points)}`).join('　')}</div>${rec.note?`<div class="sub">${esc(rec.note)}</div>`:''}</div>`).join(''):'<p class="muted">尚無紀錄</p>'}<button class="secondary" style="width:100%" data-act="closeModal">關閉</button></div></div>`; },
  editRecord(){ const r=state.room; const rec=r.records.find(x=>x.id===state.editRecId); if(!rec)return ''; return `<div class="modal"><div class="sheet"><h2>修改紀錄</h2>${r.players.map(p=>{let it=(rec.items||[]).find(x=>x.playerId===p.id);return `<div class="field"><label>${esc(p.name)}</label><input data-editplayer="${p.id}" type="text" inputmode="decimal" value="${it?it.points:0}"></div>`}).join('')}<div class="field"><label>備註</label><input id="editNote" value="${esc(rec.note||'')}"></div><div class="grid"><button data-act="saveRecordEdit">儲存</button><button class="secondary" data-act="openHistory">取消</button></div></div></div>`; }
};


function joinLobbyHtml(){
  if(!state.joinName.trim()) return '<div class="preview muted">請先輸入暱稱，再用房號加入或查詢目前房間。</div>';
  const selected = state.lobbyRooms.find(r=>r.code===state.selectedRoomCode);
  const list = state.lobbyLoading ? '<div class="preview">查詢房間中...</div>' : (state.lobbyRooms.length ? state.lobbyRooms.map(r=>`<button class="roomPreviewCard ${r.code===state.selectedRoomCode?'selected':''}" data-roompick="${r.code}"><b>${esc(r.name||'記分房')}</b><span>房主：${esc(r.ownerName||'未知')}｜${Number(r.playerCount||0)} 人｜閒置 ${idleText(r.lastActiveAtMs)}</span><small>${r.code===state.selectedRoomCode?'已選擇，請輸入房號加入':'點選輸入房號加入'}</small></button>`).join('') : '<div class="preview muted">目前沒有可加入的房間。</div>');
  const directBlock = selected ? '' : `<div class="field"><label>輸入房號</label><input id="joinCodeDirect" inputmode="numeric" maxlength="4" placeholder="輸入房號" value="${esc(state.joinCodeDirect||'')}"></div><button style="width:100%;margin-bottom:14px" class="secondary" data-act="joinRoom">透過房號加入</button>`;
  return `${directBlock}<div class="field"><label>目前房間</label>${list}</div>${selected?`<div class="field"><label>房號密碼</label><input id="joinCode" inputmode="numeric" maxlength="4" placeholder="輸入房號" value="${esc(state.joinPreviewCode||'')}"></div><button style="width:100%;margin-bottom:14px" class="secondary" data-act="joinRoom">加入選擇房間</button>`:''}`;
}
let lobbyTimer=null;
function loadLobbyRooms(){
  clearTimeout(lobbyTimer);
  if(!state.joinName.trim()){ state.lobbyRooms=[]; state.lobbyLoading=false; render(); return; }
  lobbyTimer=setTimeout(async()=>{
    state.lobbyLoading=true; render();
    try{
      const snap=await getDocs(collection(db,'rooms'));
      const rooms=[];
      for(const d of snap.docs){
        const data=d.data();
        if(data.closed) continue;
        if(data.version !== VERSION) continue;
        if(data.expiresAtMs && Date.now()>Number(data.expiresAtMs)) continue;
        if(data.lastActiveAtMs && Date.now()-Number(data.lastActiveAtMs) > 24*60*60*1000) continue;
        let playerCount=0;
        try{ playerCount=(await getDocs(playersRef(d.id))).size; }catch(e){}
        rooms.push({code:d.id,...data,playerCount});
      }
      rooms.sort((a,b)=>Number(b.lastActiveAtMs||0)-Number(a.lastActiveAtMs||0));
      state.lobbyRooms=rooms.slice(0,20);
    }catch(e){ state.lobbyRooms=[]; toast('房間列表讀取失敗'); }
    state.lobbyLoading=false; render();
  },250);
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
function createNameInputs(){ const n=Math.max(1,Math.min(20,Number(state.createCount||1))); return Array.from({length:n},(_,i)=>`<div class="field"><label>玩家 ${i+1}</label><input class="cname" value="${i===0?'房主':'玩家'+(i+1)}"></div>`).join(''); }
function bind(){
  $$('[data-act]').forEach(b=>b.onclick=()=>act(b.dataset.act));
  $$('[data-qplayer]').forEach(inp=>{ inp.oninput=()=>{ state.quickTouched[inp.dataset.qplayer]=true; state.quickDraft[inp.dataset.qplayer]=inp.value; autoFillQuick(); syncQuickInputs(); }; });
  $$('[data-qadd]').forEach(b=>{ b.onclick=()=>{ const id=b.dataset.pid; state.quickTouched[id]=true; const cur=Number(state.quickDraft[id]||0); state.quickDraft[id]=String(cur+Number(b.dataset.qadd)); autoFillQuick(); render(); }; b.addEventListener('touchstart',()=>{}, {passive:true}); });
  $$('[data-delrec]').forEach(b=>b.onclick=()=>deleteRecord(b.dataset.delrec));
  $$('[data-editrec]').forEach(b=>b.onclick=()=>{ state.editRecId=b.dataset.editrec; state.modal='editRecord'; render(); });
  $$('[data-remplayer]').forEach(b=>b.onclick=()=>removePlayer(b.dataset.remplayer));
  const jn=$('#joinName'); if(jn) jn.oninput=()=>{ state.joinName=jn.value; state.lobbyRooms=[]; state.selectedRoomCode=''; };
  const rn=$('#roomName'); if(rn) rn.oninput=()=>{ state.createRoomName=rn.value; };
  const jcd=$('#joinCodeDirect'); if(jcd) jcd.oninput=()=>{ state.joinCodeDirect=jcd.value.replace(/\D/g,'').slice(0,4); if(jcd.value!==state.joinCodeDirect) jcd.value=state.joinCodeDirect; };
  const jc=$('#joinCode'); if(jc) jc.oninput=()=>{ state.joinPreviewCode=jc.value.replace(/\D/g,'').slice(0,4); if(jc.value!==state.joinPreviewCode) jc.value=state.joinPreviewCode; };
  $$('[data-roompick]').forEach(b=>b.onclick=()=>{ state.selectedRoomCode=b.dataset.roompick; state.joinPreviewCode=''; render(); });

}
function syncQuickInputs(){ $$('[data-qplayer]').forEach(i=>{ if(document.activeElement!==i) i.value = state.quickDraft[i.dataset.qplayer] ?? ''; }); }
function autoFillQuick(){
  const players = state.room?.players||[];
  const manual = players.filter(p=>state.quickTouched[p.id]);
  const free = players.filter(p=>!state.quickTouched[p.id]);
  free.forEach(p=>{ state.quickDraft[p.id]=''; });
  if(players.length>=2 && manual.length===players.length-1 && free.length===1){
    const s = manual.reduce((a,p)=>a+Number(state.quickDraft[p.id]||0),0);
    state.quickDraft[free[0].id] = String(-s);
  }
}
function currentQuickItems(){ return (state.room?.players||[]).map(p=>({playerId:p.id,points:Number(state.quickDraft[p.id]||0)})).filter(x=>x.points!==0); }

async function act(a){
  const r=state.room;
  try{
    if(a==='home'){ clearSubs(); state.screen='home'; state.modal=null; state.room=null; render(); }
    if(a==='returnRoom') await returnRoom();
    if(a==='createSetup'){ state.createRoomName=randomRoomName(); state.modal='create'; render(); }
    if(a==='joinSetup'){ state.modal='join'; state.selectedRoomCode=''; state.joinPreviewCode=''; state.joinCodeDirect=''; state.lobbyRooms=[]; render(); }
    if(a==='closeModal'){ state.modal=null; render(); }
    if(a==='decCount'){ state.createCount=Math.max(1,Number(state.createCount||1)-1); render(); }
    if(a==='incCount'){ state.createCount=Math.min(20,Number(state.createCount||1)+1); render(); }
    if(a==='toggleLight'){ state.light=!state.light; render(); }
    if(a==='toggleAwake'){ await setAwake(!state.awake); render(); }
    if(a==='clearQuick'){ state.quickDraft={}; state.quickTouched={}; render(); }
    if(a==='openPlayers'){ state.modal='players'; render(); }
    if(a==='openHistory'){ state.modal='history'; render(); }
    if(a==='createRoom') await createRoom();
    if(a==='joinRoom') await joinRoom();
    if(a==='loadRooms') loadLobbyRooms();
    if(a==='clearJoinSelect'){ state.selectedRoomCode=''; state.joinPreviewCode=''; render(); }
    if(a==='closeRoom') await closeRoom();
    if(a==='clearRoomRecords') await clearRoomRecords();
    if(a==='submitQuick') await submitRecord(currentQuickItems(), '');
    if(a==='submitRecord'){ const items=$$('[data-player]').map(i=>({playerId:i.dataset.player,points:Number(i.value||0)})).filter(x=>x.points!==0); await submitRecord(items,$('#note').value||''); state.modal=null; }
    if(a==='editRoomName') await editRoomName();
    if(a==='savePlayers') await savePlayers();
    if(a==='saveRecordEdit') await saveRecordEdit();
  }catch(e){ console.error(e); toast('操作失敗：'+(e.message||e)); }
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
    await updateDoc(roomRef(c), { lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 });
    await subscribeRoom(c);
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
  const names=$$('.cname').map(i=>i.value.trim()).filter(Boolean);
  const start=Number($('#start').value||0);
  if(names.length<1) return toast('至少需要 1 位玩家');
  if(state.busy) return; state.busy=true;
  setLoading('建立房間中');
  try{
    const c=await genRoomCode();
    const ownerPlayerId = uid();
    const expiresAtMs = Date.now() + 24*60*60*1000;
    await setDoc(roomRef(c), { code:c, name:($('#roomName').value||state.createRoomName||randomRoomName()), version:VERSION, zeroCheck:$('#zero').checked, ownerDeviceId:deviceId, ownerPlayerId, ownerName:names[0], defaultStart:start, quickValues:DEFAULT_QUICK_VALUES, closed:false, createdAt:serverTimestamp(), createdAtMs:Date.now(), lastActiveAtMs:Date.now(), expiresAtMs });
    const batch=writeBatch(db);
    names.forEach((n,i)=>{ const id = i===0 ? ownerPlayerId : uid(); batch.set(doc(playersRef(c),id), { name:n, startScore:start, order:i, joinedAt:serverTimestamp(), joinedAtMs:Date.now()+i }); });
    await batch.commit();
    localStorage.setItem(playerKey(c,names[0]), ownerPlayerId);
    state.quickDraft={}; state.quickTouched={}; state.screen='room'; state.modal=null;
    await subscribeRoom(c);
  } finally { state.busy=false; setLoading(''); }
}
async function joinRoom(){
  const name=($('#joinName').value||state.joinName||'').trim();
  if(!name) return toast('請先輸入暱稱');
  const direct=($('#joinCodeDirect').value||state.joinCodeDirect||'').trim();
  const pass=($('#joinCode').value||state.joinPreviewCode||'').trim();
  const c=state.selectedRoomCode || direct;
  const typed=state.selectedRoomCode ? pass : direct;
  if(!/^\d{4}$/.test(typed)) return toast('請輸入 4 碼房號');
  if(state.selectedRoomCode && typed!==state.selectedRoomCode) return toast('房號密碼錯誤');
  if(state.busy) return; state.busy=true;
  setLoading('加入房間中');
  try{
    const snap=await getDoc(roomRef(c)); if(!snap.exists()) return toast('找不到房間');
    const data=snap.data();
    if(data.closed) return toast('房間已關閉');
    if(data.expiresAtMs && Date.now()>Number(data.expiresAtMs)){ await closeExpiredRoom(c); return toast('房間已閒置超過 24 小時'); }
    const ps=await getDocs(playersRef(c));
    let existing = null;
    ps.forEach(d=>{ const v=d.data(); if(String(v.name||'').trim()===name) existing={id:d.id,...v}; });
    if(existing){
      localStorage.setItem(playerKey(c,name), existing.id);
      const shouldRestoreOwner = (data.ownerPlayerId && data.ownerPlayerId===existing.id) || (!data.ownerPlayerId && data.ownerName===name);
      if(shouldRestoreOwner) await updateDoc(roomRef(c), { ownerDeviceId:deviceId, lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 });
      else await updateDoc(roomRef(c), { lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 });
    }else{
      const id=uid();
      await setDoc(doc(playersRef(c),id), { name, startScore:Number(data.defaultStart||0), order:Date.now(), joinedAt:serverTimestamp(), joinedAtMs:Date.now() });
      localStorage.setItem(playerKey(c,name), id);
      await updateDoc(roomRef(c), { lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 });
    }
    state.quickDraft={}; state.quickTouched={}; state.screen='room'; state.modal=null;
    await subscribeRoom(c);
  } finally { state.busy=false; setLoading(''); }
}
async function submitRecord(items,note){
  if(!items.length) return toast('請先輸入分數');
  await addDoc(recordsRef(state.room.code), { items, note, createdByDeviceId:deviceId, createdAt:serverTimestamp(), createdAtMs:Date.now() });
  await updateDoc(roomRef(state.room.code), { lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 });
  state.quickDraft={}; state.quickTouched={}; toast('已提交','success');
}
async function undo(){
  if(!isOwner()) return toast('只有房主可以撤銷');
  const last=[...(state.room.records||[])].pop(); if(!last) return toast('沒有可撤銷紀錄');
  await deleteDoc(doc(db,'rooms',state.room.code,'records',last.id)); await updateDoc(roomRef(state.room.code), { lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 }); toast('已撤銷上一筆');
}
async function deleteRecord(id){ if(!isOwner()) return toast('只有房主可以刪除'); await deleteDoc(doc(db,'rooms',state.room.code,'records',id)); await updateDoc(roomRef(state.room.code), { lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 }); state.modal='history'; toast('已刪除'); }
async function saveRecordEdit(){
  if(!isOwner()) return toast('只有房主可以修改');
  const items=$$('[data-editplayer]').map(i=>({playerId:i.dataset.editplayer,points:Number(i.value||0)})).filter(x=>x.points!==0);
  await updateDoc(doc(db,'rooms',state.room.code,'records',state.editRecId), { items, note:$('#editNote').value||'', editedAt:serverTimestamp(), editedAtMs:Date.now() });
  await updateDoc(roomRef(state.room.code), { lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 });
  state.modal='history'; toast('已修改');
}
async function savePlayers(){
  if(!isOwner()) return toast('只有房主可以修改玩家');
  const batch=writeBatch(db);
  state.room.players.forEach(p=>{ const n=document.querySelector(`[data-name="${p.id}"]`); const s=document.querySelector(`[data-start="${p.id}"]`); batch.update(doc(db,'rooms',state.room.code,'players',p.id), { name:n.value, startScore:Number(s.value||0) }); });
  const np=$('#newPlayer')?.value.trim();
  if(np) batch.set(doc(playersRef(state.room.code),uid()), { name:np, startScore:Number($('#newStart').value||0), order:Date.now(), joinedAt:serverTimestamp(), joinedAtMs:Date.now() });
  const quickValuesNew = $$('.quickSet').map(i=>Math.abs(Number(i.value||0))).filter(v=>v>0).slice(0,5);
  batch.update(roomRef(state.room.code), { quickValues: quickValuesNew.length?quickValuesNew:DEFAULT_QUICK_VALUES, lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 });
  await batch.commit(); state.modal=null; toast('已儲存');
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
  if(!confirm('確定清除本局計分與歷史紀錄？玩家會保留。')) return;
  setLoading('清除本局中');
  try{
    const batch=writeBatch(db);
    const rs=await getDocs(recordsRef(state.room.code));
    rs.forEach(d=>batch.delete(d.ref));
    batch.update(roomRef(state.room.code), { lastActiveAtMs:Date.now(), expiresAtMs:Date.now()+24*60*60*1000 });
    await batch.commit();
    state.quickDraft={}; state.quickTouched={};
    toast('本局已清除','success');
  } finally { setLoading(''); }
}

async function closeRoom(){
  if(!isOwner()) return toast('只有房主可以關閉房間');
  if(!confirm('確定關閉房間？關閉後其他人將無法再進入。')) return;
  setLoading('關閉房間中');
  try{ await deleteRoomTree(state.room.code); clearSubs(); state.room=null; state.screen='home'; state.modal=null; toast('房間已關閉'); }
  finally{ setLoading(''); }
}
async function closeExpiredRoom(code){
  try{ await deleteRoomTree(code); }catch(e){ console.warn(e); }
  clearSubs(); state.room=null; state.screen='home'; state.modal=null; render();
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
setTimeout(()=>{ state.bootReady=true; render(); }, 500);
