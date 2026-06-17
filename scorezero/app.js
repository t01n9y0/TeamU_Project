import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, onSnapshot, serverTimestamp, query, orderBy, writeBatch } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';

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
const VERSION = 'ScoreZero beta3';
const DEVICE_KEY = 'scorezero_device_id_beta3';
const LAST_ROOM_KEY = 'scorezero_last_room_beta3';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const deviceId = (() => { let id = localStorage.getItem(DEVICE_KEY); if(!id){ id = uid()+Date.now().toString(36); localStorage.setItem(DEVICE_KEY,id); } return id; })();

let unsub = [];
let state = { screen:'home', modal:null, room:null, toast:'', createCount:3, quickDraft:{}, quickTouched:{}, light:false, awake:false, wakeLock:null, editRecId:null };

function fmt(n){ n = Number(n||0); return (n>0?'+':'') + n; }
function roomRef(code){ return doc(db,'rooms',code); }
function playersRef(code){ return collection(db,'rooms',code,'players'); }
function recordsRef(code){ return collection(db,'rooms',code,'records'); }
function isOwner(){ return state.room?.ownerDeviceId === deviceId; }
function total(){ return (state.room?.players||[]).reduce((a,p)=>a+Number(p.score||0),0); }
function toast(t){ state.toast=t; render(); setTimeout(()=>{state.toast=''; render();},1800); }
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
    state.room = { ...base, ...(state.room||{}), code, ...snap.data() };
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
  document.body.classList.toggle('light',state.light);
  $('#app').innerHTML = `<div class="wrap">${views[state.screen]()}${state.toast?`<div class="toast">${state.toast}</div>`:''}</div>${state.modal?modals[state.modal]():''}`;
  bind();
}

const views = {
  home(){ return `<div class="hero"><div class="brand">ScoreZero 撲克記分板</div><div class="version">本次版本: ${VERSION}</div></div><div class="homeButtons"><button data-act="createSetup">建立房間</button><button class="secondary" data-act="joinSetup">加入房間</button></div><div class="intro"><b>功能簡介</b><p>4碼房號加入、多人即時同步、快速加減分、自動補差額、總和歸零提示、歷史紀錄、螢幕常亮與開關燈。</p></div>`; },
  room(){
    const r = state.room;
    if(!r) return `<div class="hero"><div class="brand">載入中...</div></div>`;
    const sum = total();
    const ownerBadge = isOwner()?'<span class="pill">👑 房主</span>':'<span class="pill">玩家</span>';
    return `<div class="topbar"><div><div class="brand smallBrand">${esc(r.name||'記分房')}</div><div class="sub">房號 ${r.code}　${ownerBadge}</div></div><button class="secondary small" data-act="home">首頁</button></div>
    <div class="card scoreCard"><div class="scoreHead"><div><h3>目前分數</h3><span class="pill">${r.players.length} 位玩家</span></div><div class="scoreSumMini ${sum===0?'sumGood':'sumBad'}">總和 ${fmt(sum)}</div></div>${[...r.players].sort((a,b)=>b.score-a.score).map(p=>`<div class="player"><div class="pname">${esc(p.name)}<div class="sub">起始 ${p.startScore||0}</div></div><div class="pscore ${p.score>0?'pos':p.score<0?'neg':'zero'}">${fmt(p.score)}</div></div>`).join('')}</div>
    <div class="card"><h3>快速計分</h3><div class="sub">輸入或點按快捷鍵會累加；只剩一位未手動輸入時，系統會即時自動補到總和為 0。</div><div class="quickRows">${r.players.map(p=>quickRow(p)).join('')}</div><div class="field"><label>備註</label><input id="quickNote" placeholder="可不填"></div><button style="width:100%" data-act="submitQuick">提交</button><button style="width:100%;margin-top:8px" class="secondary" data-act="clearQuick">清空快速計分</button></div>
    <div class="card bottomActions"><button data-act="openAdd">新增</button><button class="secondary" data-act="openPlayers">玩家</button><button class="secondary" data-act="openHistory">紀錄</button><button class="danger" data-act="undo">撤銷</button><button class="secondary" data-act="toggleAwake">${state.awake?'關閉常亮':'螢幕常亮'}</button><button class="secondary" data-act="toggleLight">${state.light?'關燈':'開燈'}</button></div>`;
  }
};

function quickRow(p){
  let v = state.quickDraft[p.id]; if(v===undefined) v='';
  const auto = !state.quickTouched[p.id] && v!=='' ? '<span class="pill">自動</span>' : '';
  return `<div class="quickRow"><div class="qName">${esc(p.name)} ${auto}</div><input class="qInput" data-qplayer="${p.id}" type="number" inputmode="numeric" value="${v}" placeholder="格子"><div class="qBtns">${[-100,-50,-10,-5,-1,1,5,10,50,100].map(n=>`<button class="qbtn ${n<0?'minus':'plus'}" data-qadd="${n}" data-pid="${p.id}">${fmt(n)}</button>`).join('')}</div></div>`;
}

const modals = {
  create(){ return `<div class="modal"><div class="sheet"><h2>建立房間</h2><div class="field"><label>房間名稱</label><input id="roomName" value="今晚記分"></div><div class="field"><label>玩家數量</label><input id="playerCount" type="number" min="2" max="20" value="${state.createCount}" inputmode="numeric"></div><button class="secondary" style="width:100%" data-act="makeNameInputs">產生玩家格子</button><div id="nameInputs" class="nameInputs">${createNameInputs()}</div><div class="field"><label>起始點數</label><input id="start" type="number" value="0" inputmode="numeric"></div><label class="check"><input id="zero" type="checkbox" checked> 開啟總和歸零檢查</label><div class="grid"><button data-act="createRoom">建立</button><button class="secondary" data-act="closeModal">取消</button></div></div></div>`; },
  join(){ return `<div class="modal"><div class="sheet"><h2>加入房間</h2><div class="field"><label>4碼房號</label><input id="joinCode" inputmode="numeric" maxlength="4" placeholder="例如 9527"></div><div class="field"><label>你的暱稱</label><input id="joinName" placeholder="輸入暱稱"></div><div class="grid"><button data-act="joinRoom">加入</button><button class="secondary" data-act="closeModal">取消</button></div></div></div>`; },
  add(){ const r=state.room; return `<div class="modal"><div class="sheet"><h2>新增紀錄</h2>${r.players.map(p=>`<div class="field"><label>${esc(p.name)}</label><input data-player="${p.id}" type="number" inputmode="numeric" value="0"></div>`).join('')}<div class="field"><label>備註</label><input id="note" placeholder="可不填"></div><div class="grid"><button data-act="submitRecord">送出</button><button class="secondary" data-act="closeModal">取消</button></div></div></div>`; },
  players(){ const r=state.room; return `<div class="modal"><div class="sheet"><h2>玩家管理</h2>${!isOwner()?'<p class="muted">只有房主可以修改玩家。</p>':''}${r.players.map(p=>`<div class="playerEdit"><input data-name="${p.id}" value="${esc(p.name)}" ${!isOwner()?'disabled':''}><input data-start="${p.id}" type="number" inputmode="numeric" value="${p.startScore||0}" ${!isOwner()?'disabled':''}></div>`).join('')}<div class="divider"></div>${isOwner()?`<div class="playerEdit"><input id="newPlayer" placeholder="新增玩家暱稱"><input id="newStart" type="number" inputmode="numeric" value="0"></div><div class="grid"><button data-act="savePlayers">儲存</button><button class="secondary" data-act="closeModal">關閉</button></div>`:`<button class="secondary" style="width:100%" data-act="closeModal">關閉</button>`}</div></div>`; },
  history(){ const r=state.room; return `<div class="modal"><div class="sheet"><h2>歷史紀錄</h2>${r.records.length?[...r.records].reverse().map((rec,i)=>`<div class="historyItem"><div class="histTop"><span>第 ${r.records.length-i} 筆｜${time(rec.createdAtMs)}</span><div>${isOwner()?`<button class="secondary small" data-editrec="${rec.id}">修改</button><button class="danger small" data-delrec="${rec.id}">刪除</button>`:''}</div></div><div class="changes">${(rec.items||[]).map(it=>`${esc(r.players.find(p=>p.id===it.playerId)?.name||'玩家')} ${fmt(it.points)}`).join('　')}</div>${rec.note?`<div class="sub">${esc(rec.note)}</div>`:''}</div>`).join(''):'<p class="muted">尚無紀錄</p>'}<button class="secondary" style="width:100%" data-act="closeModal">關閉</button></div></div>`; },
  editRecord(){ const r=state.room; const rec=r.records.find(x=>x.id===state.editRecId); if(!rec)return ''; return `<div class="modal"><div class="sheet"><h2>修改紀錄</h2>${r.players.map(p=>{let it=(rec.items||[]).find(x=>x.playerId===p.id);return `<div class="field"><label>${esc(p.name)}</label><input data-editplayer="${p.id}" type="number" inputmode="numeric" value="${it?it.points:0}"></div>`}).join('')}<div class="field"><label>備註</label><input id="editNote" value="${esc(rec.note||'')}"></div><div class="grid"><button data-act="saveRecordEdit">儲存</button><button class="secondary" data-act="openHistory">取消</button></div></div></div>`; }
};

function esc(s=''){ return String(s).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function time(ms){ return ms ? new Date(ms).toLocaleTimeString() : '同步中'; }
function createNameInputs(){ const n=Math.max(2,Math.min(20,Number(state.createCount||3))); return Array.from({length:n},(_,i)=>`<div class="field"><label>玩家 ${i+1}</label><input class="cname" value="玩家${i+1}"></div>`).join(''); }
function bind(){
  $$('[data-act]').forEach(b=>b.onclick=()=>act(b.dataset.act));
  $$('[data-qplayer]').forEach(inp=>{ inp.oninput=()=>{ state.quickTouched[inp.dataset.qplayer]=true; state.quickDraft[inp.dataset.qplayer]=inp.value; autoFillQuick(); syncQuickInputs(); }; });
  $$('[data-qadd]').forEach(b=>b.onclick=()=>{ const id=b.dataset.pid; state.quickTouched[id]=true; const cur=Number(state.quickDraft[id]||0); state.quickDraft[id]=String(cur+Number(b.dataset.qadd)); autoFillQuick(); render(); });
  $$('[data-delrec]').forEach(b=>b.onclick=()=>deleteRecord(b.dataset.delrec));
  $$('[data-editrec]').forEach(b=>b.onclick=()=>{ state.editRecId=b.dataset.editrec; state.modal='editRecord'; render(); });
  const pc=$('#playerCount'); if(pc) pc.oninput=()=>{state.createCount=pc.value};
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
    if(a==='createSetup'){ state.modal='create'; render(); }
    if(a==='joinSetup'){ state.modal='join'; render(); }
    if(a==='closeModal'){ state.modal=null; render(); }
    if(a==='makeNameInputs'){ state.createCount=Number($('#playerCount').value||3); render(); }
    if(a==='toggleLight'){ state.light=!state.light; render(); }
    if(a==='toggleAwake'){ await setAwake(!state.awake); render(); }
    if(a==='clearQuick'){ state.quickDraft={}; state.quickTouched={}; render(); }
    if(a==='openAdd'){ state.modal='add'; render(); }
    if(a==='openPlayers'){ state.modal='players'; render(); }
    if(a==='openHistory'){ state.modal='history'; render(); }
    if(a==='createRoom') await createRoom();
    if(a==='joinRoom') await joinRoom();
    if(a==='submitQuick') await submitRecord(currentQuickItems(), $('#quickNote')?.value||'');
    if(a==='submitRecord'){ const items=$$('[data-player]').map(i=>({playerId:i.dataset.player,points:Number(i.value||0)})).filter(x=>x.points!==0); await submitRecord(items,$('#note').value||''); state.modal=null; }
    if(a==='undo') await undo();
    if(a==='savePlayers') await savePlayers();
    if(a==='saveRecordEdit') await saveRecordEdit();
  }catch(e){ console.error(e); toast('操作失敗：'+(e.message||e)); }
}

async function createRoom(){
  const names=$$('.cname').map(i=>i.value.trim()).filter(Boolean);
  const start=Number($('#start').value||0);
  if(names.length<2) return toast('至少需要 2 位玩家');
  const c=await genRoomCode();
  await setDoc(roomRef(c), { code:c, name:$('#roomName').value||'記分房', version:VERSION, zeroCheck:$('#zero').checked, ownerDeviceId:deviceId, ownerName:names[0], defaultStart:start, createdAt:serverTimestamp(), createdAtMs:Date.now() });
  const batch=writeBatch(db);
  names.forEach((n,i)=>batch.set(doc(playersRef(c),uid()), { name:n, startScore:start, order:i, joinedAt:serverTimestamp(), joinedAtMs:Date.now()+i }));
  await batch.commit();
  state.quickDraft={}; state.quickTouched={}; state.screen='room'; state.modal=null;
  await subscribeRoom(c);
}
async function joinRoom(){
  const c=($('#joinCode').value||'').trim(); const name=($('#joinName').value||'').trim();
  if(!/^\d{4}$/.test(c)) return toast('請輸入 4 碼數字房號');
  const snap=await getDoc(roomRef(c)); if(!snap.exists()) return toast('找不到房間');
  if(!name) return toast('請輸入暱稱');
  const data=snap.data();
  await setDoc(doc(playersRef(c),uid()), { name, startScore:Number(data.defaultStart||0), order:Date.now(), joinedAt:serverTimestamp(), joinedAtMs:Date.now() });
  state.quickDraft={}; state.quickTouched={}; state.screen='room'; state.modal=null;
  await subscribeRoom(c);
}
async function submitRecord(items,note){
  if(!items.length) return toast('請先輸入分數');
  await addDoc(recordsRef(state.room.code), { items, note, createdByDeviceId:deviceId, createdAt:serverTimestamp(), createdAtMs:Date.now() });
  state.quickDraft={}; state.quickTouched={}; toast('已提交');
}
async function undo(){
  if(!isOwner()) return toast('只有房主可以撤銷');
  const last=[...(state.room.records||[])].pop(); if(!last) return toast('沒有可撤銷紀錄');
  await deleteDoc(doc(db,'rooms',state.room.code,'records',last.id)); toast('已撤銷上一筆');
}
async function deleteRecord(id){ if(!isOwner()) return toast('只有房主可以刪除'); await deleteDoc(doc(db,'rooms',state.room.code,'records',id)); state.modal='history'; toast('已刪除'); }
async function saveRecordEdit(){
  if(!isOwner()) return toast('只有房主可以修改');
  const items=$$('[data-editplayer]').map(i=>({playerId:i.dataset.editplayer,points:Number(i.value||0)})).filter(x=>x.points!==0);
  await updateDoc(doc(db,'rooms',state.room.code,'records',state.editRecId), { items, note:$('#editNote').value||'', editedAt:serverTimestamp(), editedAtMs:Date.now() });
  state.modal='history'; toast('已修改');
}
async function savePlayers(){
  if(!isOwner()) return toast('只有房主可以修改玩家');
  const batch=writeBatch(db);
  state.room.players.forEach(p=>{ const n=document.querySelector(`[data-name="${p.id}"]`); const s=document.querySelector(`[data-start="${p.id}"]`); batch.update(doc(db,'rooms',state.room.code,'players',p.id), { name:n.value, startScore:Number(s.value||0) }); });
  const np=$('#newPlayer')?.value.trim();
  if(np) batch.set(doc(playersRef(state.room.code),uid()), { name:np, startScore:Number($('#newStart').value||0), order:Date.now(), joinedAt:serverTimestamp(), joinedAtMs:Date.now() });
  await batch.commit(); state.modal=null; toast('已儲存');
}

const last = new URLSearchParams(location.search).get('room') || '';
if(last && /^\d{4}$/.test(last)){ state.screen='room'; subscribeRoom(last); }
render();
