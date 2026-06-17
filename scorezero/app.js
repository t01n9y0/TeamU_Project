const KEY='scorezero_rooms_beta2';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const uid=()=>Math.random().toString(36).slice(2,9);
const code=()=>Math.random().toString(36).slice(2,8).toUpperCase();
let state={screen:'home',room:null,modal:null,toast:'',createCount:3,quickDraft:{},light:false,awake:false,wakeLock:null};
function loadRooms(){return JSON.parse(localStorage.getItem(KEY)||'{}')}
function saveRooms(rooms){localStorage.setItem(KEY,JSON.stringify(rooms))}
function saveRoom(room){const rooms=loadRooms();rooms[room.code]=room;saveRooms(rooms);state.room=room;}
function fmt(n){n=Number(n||0);return (n>0?'+':'')+n}
function total(room){return room.players.reduce((a,p)=>a+Number(p.score||0),0)}
function recalc(room){room.players.forEach(p=>p.score=Number(p.startScore||0));room.records.forEach(r=>r.items.forEach(it=>{let p=room.players.find(x=>x.id===it.playerId);if(p)p.score+=Number(it.points||0)}));}
function toast(t){state.toast=t;render();setTimeout(()=>{state.toast='';render()},1600)}
async function setAwake(on){state.awake=on;try{if(on&&'wakeLock'in navigator){state.wakeLock=await navigator.wakeLock.request('screen');state.wakeLock.addEventListener('release',()=>{state.wakeLock=null});}else if(state.wakeLock){await state.wakeLock.release();state.wakeLock=null;}}catch(e){toast('此瀏覽器不支援螢幕常亮')}}
function render(){document.body.classList.toggle('light',state.light);document.getElementById('app').innerHTML=`<div class="wrap">${views[state.screen]()}${state.toast?`<div class="toast">${state.toast}</div>`:''}</div>${state.modal?modals[state.modal]():''}`; bind();}
const views={
 home(){return `<div class="hero"><div class="brand">ScoreZero 撲克記分板</div><div class="version">本次版本: ScoreZero beta2</div></div><div class="homeButtons"><button data-act="createSetup">建立房間</button><button class="secondary" data-act="joinSetup">加入房間</button></div><div class="intro"><b>功能簡介</b><p>多人遊戲快速記分，支援起始分數、總和歸零檢查、歷史紀錄、撤銷修改、快速加減分、螢幕常亮與開關燈模式。</p></div>`},
 room(){const r=state.room;const sum=total(r);return `<div class="topbar"><div><div class="brand smallBrand">${r.name}</div><div class="sub">房號 ${r.code}</div></div><button class="secondary small" data-act="home">首頁</button></div><div class="card scoreCard"><div class="scoreHead"><div><h3>目前分數</h3><span class="pill">${r.players.length} 位玩家</span></div><div class="scoreSumMini ${sum===0?'sumGood':'sumBad'}">總和 ${fmt(sum)}</div></div>${[...r.players].sort((a,b)=>b.score-a.score).map(p=>`<div class="player"><div class="pname">${p.name}<div class="sub">起始 ${p.startScore}</div></div><div class="pscore ${p.score>0?'pos':p.score<0?'neg':'zero'}">${fmt(p.score)}</div></div>`).join('')}</div><div class="card"><h3>快速計分</h3><div class="quickRows">${r.players.map((p,i)=>quickRow(p,i)).join('')}</div><div class="field"><label>備註</label><input id="quickNote" placeholder="可不填"></div><button style="width:100%" data-act="submitQuick">提交</button></div><div class="card bottomActions"><button data-act="openAdd">新增</button><button class="secondary" data-act="openPlayers">玩家</button><button class="secondary" data-act="openHistory">紀錄</button><button class="danger" data-act="undo">撤銷</button><button class="secondary" data-act="toggleAwake">${state.awake?'關閉常亮':'螢幕常亮'}</button><button class="secondary" data-act="toggleLight">${state.light?'關燈':'開燈'}</button></div>`}
};
function quickRow(p,i){let v=state.quickDraft[p.id]; if(v===undefined)v=''; return `<div class="quickRow"><div class="qName">${p.name}</div><input class="qInput" data-qplayer="${p.id}" data-qindex="${i}" type="number" inputmode="numeric" value="${v}" placeholder="格子"><div class="qBtns">${[-100,-50,-10,-5,-1,1,5,10,50,100].map(n=>`<button class="qbtn ${n<0?'minus':'plus'}" data-qadd="${n}" data-pid="${p.id}">${fmt(n)}</button>`).join('')}</div></div>`}
const modals={
 create(){return `<div class="modal"><div class="sheet"><h2>建立房間</h2><div class="field"><label>房間名稱</label><input id="roomName" value="今晚記分"></div><div class="field"><label>玩家數量</label><input id="playerCount" type="number" min="2" max="20" value="${state.createCount}" inputmode="numeric"></div><button class="secondary" style="width:100%" data-act="makeNameInputs">產生玩家格子</button><div id="nameInputs" class="nameInputs">${createNameInputs()}</div><div class="field"><label>起始點數</label><input id="start" type="number" value="0" inputmode="numeric"></div><label class="check"><input id="zero" type="checkbox" checked> 開啟總和歸零檢查</label><div class="grid"><button data-act="createRoom">建立</button><button class="secondary" data-act="closeModal">取消</button></div></div></div>`},
 join(){return `<div class="modal"><div class="sheet"><h2>加入房間</h2><div class="field"><label>房號</label><input id="joinCode" placeholder="例如 A7K29Q"></div><div class="field"><label>你的暱稱</label><input id="joinName" placeholder="輸入暱稱"></div><div class="grid"><button data-act="joinRoom">加入</button><button class="secondary" data-act="closeModal">取消</button></div><p class="muted">目前 beta2 是本機原型；不同手機即時同步版需再接 Firebase。</p></div></div>`},
 add(){const r=state.room;return `<div class="modal"><div class="sheet"><h2>新增紀錄</h2>${r.players.map(p=>`<div class="field"><label>${p.name}</label><input data-player="${p.id}" type="number" inputmode="numeric" value="0"></div>`).join('')}<div class="field"><label>備註</label><input id="note" placeholder="可不填"></div><div class="grid"><button data-act="submitRecord">送出</button><button class="secondary" data-act="closeModal">取消</button></div></div></div>`},
 players(){const r=state.room;return `<div class="modal"><div class="sheet"><h2>玩家管理</h2>${r.players.map(p=>`<div class="playerEdit"><input data-name="${p.id}" value="${p.name}"><input data-start="${p.id}" type="number" inputmode="numeric" value="${p.startScore}"></div>`).join('')}<div class="divider"></div><div class="playerEdit"><input id="newPlayer" placeholder="新增玩家暱稱"><input id="newStart" type="number" inputmode="numeric" value="0"></div><div class="grid"><button data-act="savePlayers">儲存</button><button class="secondary" data-act="closeModal">關閉</button></div></div></div>`},
 history(){const r=state.room;return `<div class="modal"><div class="sheet"><h2>歷史紀錄</h2>${r.records.length?[...r.records].reverse().map((rec,i)=>`<div class="historyItem"><div class="histTop"><span>第 ${r.records.length-i} 筆｜${new Date(rec.createdAt).toLocaleTimeString()}</span><div><button class="secondary small" data-editrec="${rec.id}">修改</button><button class="danger small" data-delrec="${rec.id}">刪除</button></div></div><div class="changes">${rec.items.map(it=>`${r.players.find(p=>p.id===it.playerId)?.name||'玩家'} ${fmt(it.points)}`).join('　')}</div>${rec.note?`<div class="sub">${rec.note}</div>`:''}</div>`).join(''):'<p class="muted">尚無紀錄</p>'}<button class="secondary" style="width:100%" data-act="closeModal">關閉</button></div></div>`},
 editRecord(){const r=state.room;const rec=r.records.find(x=>x.id===state.editRecId);if(!rec)return '';return `<div class="modal"><div class="sheet"><h2>修改紀錄</h2>${r.players.map(p=>{let it=rec.items.find(x=>x.playerId===p.id);return `<div class="field"><label>${p.name}</label><input data-editplayer="${p.id}" type="number" inputmode="numeric" value="${it?it.points:0}"></div>`}).join('')}<div class="field"><label>備註</label><input id="editNote" value="${rec.note||''}"></div><div class="grid"><button data-act="saveRecordEdit">儲存</button><button class="secondary" data-act="openHistory">取消</button></div></div></div>`}
};
function createNameInputs(){let n=Math.max(2,Math.min(20,Number(state.createCount||3)));return Array.from({length:n},(_,i)=>`<div class="field"><label>玩家 ${i+1}</label><input class="cname" value="玩家${i+1}"></div>`).join('')}
function bind(){
 $$('[data-act]').forEach(b=>b.onclick=()=>act(b.dataset.act));
 $$('[data-qplayer]').forEach(inp=>{inp.oninput=()=>{state.quickDraft[inp.dataset.qplayer]=inp.value;autoFillQuick(inp.dataset.qplayer);syncQuickInputs();}});
 $$('[data-qadd]').forEach(b=>b.onclick=()=>{let id=b.dataset.pid;let cur=Number(state.quickDraft[id]||0);state.quickDraft[id]=cur+Number(b.dataset.qadd);autoFillQuick(id);render();});
 $$('[data-delrec]').forEach(b=>b.onclick=()=>{let r=state.room;r.records=r.records.filter(x=>x.id!==b.dataset.delrec);recalc(r);saveRoom(r);state.modal='history';render();});
 $$('[data-editrec]').forEach(b=>b.onclick=()=>{state.editRecId=b.dataset.editrec;state.modal='editRecord';render();});
 const pc=$('#playerCount'); if(pc) pc.oninput=()=>{state.createCount=pc.value};
}
function syncQuickInputs(){$$('[data-qplayer]').forEach(i=>{if(document.activeElement!==i)i.value=state.quickDraft[i.dataset.qplayer]??''})}
function autoFillQuick(changedId){const ids=state.room.players.map(p=>p.id);const blanks=ids.filter(id=>state.quickDraft[id]===''||state.quickDraft[id]===undefined);if(blanks.length===1 && blanks[0]!==changedId){let sum=ids.filter(id=>id!==blanks[0]).reduce((a,id)=>a+Number(state.quickDraft[id]||0),0);state.quickDraft[blanks[0]]=-sum;}}
function currentQuickItems(){return state.room.players.map(p=>({playerId:p.id,points:Number(state.quickDraft[p.id]||0)})).filter(x=>x.points!==0)}
function act(a){let r=state.room;
 if(a==='home'){state.screen='home';state.modal=null;render()}
 if(a==='createSetup'){state.modal='create';render()}
 if(a==='joinSetup'){state.modal='join';render()}
 if(a==='closeModal'){state.modal=null;render()}
 if(a==='makeNameInputs'){state.createCount=Number($('#playerCount').value||3);render()}
 if(a==='createRoom'){let names=$$('.cname').map(i=>i.value.trim()).filter(Boolean);let start=Number($('#start').value||0);if(names.length<2)return toast('至少需要 2 位玩家');let room={code:code(),name:$('#roomName').value||'記分房',zeroCheck:$('#zero').checked,players:names.map(n=>({id:uid(),name:n,startScore:start,score:start})),records:[],createdAt:Date.now()};saveRoom(room);state.quickDraft={};state.screen='room';state.modal=null;render()}
 if(a==='joinRoom'){let rooms=loadRooms();let c=$('#joinCode').value.trim().toUpperCase();let name=$('#joinName').value.trim();if(!rooms[c])return toast('找不到房間');r=rooms[c];if(name)r.players.push({id:uid(),name,startScore:0,score:0});saveRoom(r);state.screen='room';state.modal=null;render()}
 if(a==='openAdd'){state.modal='add';render()}
 if(a==='openPlayers'){state.modal='players';render()}
 if(a==='openHistory'){state.modal='history';render()}
 if(a==='toggleLight'){state.light=!state.light;render()}
 if(a==='toggleAwake'){setAwake(!state.awake);render()}
 if(a==='undo'){if(!r.records.length)return toast('沒有可撤銷紀錄');r.records.pop();recalc(r);saveRoom(r);toast('已撤銷上一筆')}
 if(a==='submitQuick'){let items=currentQuickItems();if(!items.length)return toast('請先輸入分數');r.records.push({id:uid(),createdAt:Date.now(),items,note:$('#quickNote').value||''});recalc(r);saveRoom(r);state.quickDraft={};render()}
 if(a==='submitRecord'){let items=$$('[data-player]').map(i=>({playerId:i.dataset.player,points:Number(i.value||0)})).filter(x=>x.points!==0);if(!items.length)return toast('請至少輸入一筆分數');r.records.push({id:uid(),createdAt:Date.now(),items,note:$('#note').value||''});recalc(r);saveRoom(r);state.modal=null;render()}
 if(a==='savePlayers'){r.players.forEach(p=>{let n=document.querySelector(`[data-name="${p.id}"]`);let s=document.querySelector(`[data-start="${p.id}"]`);p.name=n.value;p.startScore=Number(s.value||0)});let np=$('#newPlayer').value.trim();if(np)r.players.push({id:uid(),name:np,startScore:Number($('#newStart').value||0),score:Number($('#newStart').value||0)});recalc(r);saveRoom(r);state.modal=null;render()}
 if(a==='saveRecordEdit'){let rec=r.records.find(x=>x.id===state.editRecId);rec.items=$$('[data-editplayer]').map(i=>({playerId:i.dataset.editplayer,points:Number(i.value||0)})).filter(x=>x.points!==0);rec.note=$('#editNote').value||'';recalc(r);saveRoom(r);state.modal='history';render()}
}
render();
