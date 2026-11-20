const suits=['♣','♦','♥','♠'];
const ranks=['','A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const defaultRules={bankerMode:'rotate',fixedBanker:'p1',base:50,lowMax:7,deckMode:'new',special:{straightFlush:true,four:true,five:true,straight:true},multipliers:{straightFlush:8,four:6,five:5,straight:4,niu:3,high:2}};
const specialNames={straightFlush:'同花順',four:'鐵支',five:'五公',straight:'順子'};

function shuffled(){
  const deck=suits.flatMap((_,suit)=>Array.from({length:13},(_,i)=>({rank:i+1,suit})));
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  return deck;
}
function cardValue(c){return Math.min(c.rank,10);}
function highest(cards){return Math.max(...cards.map(c=>c.rank*4+c.suit));}
function evaluate(cards,settings=defaultRules){
  const r=cards.map(c=>c.rank).sort((a,b)=>a-b);
  const straight=new Set(r).size===5 && (r[4]-r[0]===4 || r.join(',')==='1,10,11,12,13');
  const sameSuit=cards.every(c=>c.suit===cards[0].suit);
  const four=r.some(rank=>r.filter(x=>x===rank).length===4);
  const matches={straightFlush:straight&&sameSuit,four,five:cards.every(c=>c.rank>=11),straight};
  let order=14;
  for(const key of ['straightFlush','four','five','straight']){
    if(settings.special[key]&&matches[key])return {name:specialNames[key],rank:order,multiplier:settings.multipliers[key],high:highest(cards)};
    order--;
  }
  let niu=-1,combo=null;
  for(let a=0;a<3;a++)for(let b=a+1;b<4;b++)for(let c=b+1;c<5;c++){
    if((cardValue(cards[a])+cardValue(cards[b])+cardValue(cards[c]))%10===0){
      const rest=cards.filter((_,i)=>![a,b,c].includes(i));
      const point=(cardValue(rest[0])+cardValue(rest[1]))%10||10;
      if(point>niu){niu=point;combo=[a,b,c];}
    }
  }
  const lowMax=settings.lowMax??defaultRules.lowMax;
  const raised=niu>lowMax && niu<10;
  const multiplier=niu===10?settings.multipliers.niu:raised?settings.multipliers.high:1;
  return {name:niu===10?'妞妞':niu<0?'無點':niu+(raised?'升':'點'),rank:Math.max(niu,0),multiplier,high:highest(cards),combo};
}
function beatsBanker(hand,bankerHand){
  return hand.rank===bankerHand.rank ? hand.high>bankerHand.high : hand.rank>bankerHand.rank;
}

export function newGame(players,ownerId,session){
  if(players.length<2 || players.length>10) throw new Error('妞妞需 2 至 10 位玩家');
  if(!players.some(p=>p.id===ownerId)) throw new Error('房主資料尚未載入');
  return {
    players:players.map(({id,name})=>({id,name})),
    session, stage:'setup', banker:ownerId, round:0, deck:[], hands:{},
    settings:{...defaultRules,fixedBanker:ownerId}, settled:null
  };
}

const whole=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const everyHandOpen=game=>game.players.every(p=>game.hands[p.id]?.revealed.every(Boolean));

export function playGame(current,action,{actor,owner,scores}){
  const game=JSON.parse(JSON.stringify(current));
  const banker=!!actor&&game.banker===actor;
  const participant=game.players.some(p=>p.id===actor);
  const {stage}=game;
  const {type}=action;
  const {settings}=game;
  if(type==='cancelSetup'&&owner&&stage==='setup') return null;
  if(type==='end'&&banker&&['ready','settled'].includes(stage)) return null;

  if(type==='configure'&&owner&&stage==='setup'){
    const next=action.settings;
    if(!['fixed','rotate'].includes(next.bankerMode)||
      !['new','shoe'].includes(next.deckMode)||
      !game.players.some(p=>p.id===next.fixedBanker)||
      !whole(next.base,1,100000)||!whole(next.lowMax,0,8)||
      !Object.keys(settings.multipliers).every(key=>whole(next.multipliers[key],1,100))){
      throw new Error('請檢查莊家、底注與倍率設定');
    }
    game.settings=next;
    game.banker=next.fixedBanker;
    game.stage='ready';
    return game;
  }
  if(type==='deal'&&banker&&stage==='ready'){
    if(settings.deckMode==='new'||game.deck.length<game.players.length*5) game.deck=shuffled();
    game.hands=Object.fromEntries(game.players.map(p=>[p.id,{cards:[],revealed:Array(5).fill(false)}]));
    for(let i=0;i<5;i++) for(const p of game.players) game.hands[p.id].cards.push(game.deck.pop());
    game.round++;
    game.stage='reveal';
    game.settled=null;
    return game;
  }
  if(type==='reveal'&&stage==='reveal'&&(banker||(participant&&actor===action.playerId))){
    const hand=game.hands[action.playerId];
    if(hand && action.index==null) hand.revealed.fill(true);
    else if(hand&&whole(action.index,0,4)) hand.revealed[action.index]=true;
    return game;
  }
  if(type==='forceAll'&&banker&&stage==='reveal'){
    for(const hand of Object.values(game.hands)) hand.revealed.fill(true);
    return game;
  }
  if(type==='settle'&&stage==='reveal'&&banker){
    if(!everyHandOpen(game)) throw new Error('請等所有玩家開牌後再結算');
    const bankerHand=evaluate(game.hands[game.banker].cards,settings);
    const deltas=Object.fromEntries(game.players.map(p=>[p.id,0]));
    for(const p of game.players){
      if(p.id===game.banker) continue;
      const hand=evaluate(game.hands[p.id].cards,settings);
      const wins=beatsBanker(hand,bankerHand);
      deltas[p.id]=settings.base*(wins?hand.multiplier:-bankerHand.multiplier);
      deltas[game.banker]-=deltas[p.id];
    }
    game.settled={round:game.round,banker:game.banker,base:settings.base,
      before:Object.fromEntries(game.players.map(p=>[p.id,scores[p.id]])),deltas};
    game.stage='settled';
    return game;
  }
  if(type==='next'&&banker&&stage==='settled'){
    game.stage='next';
    return game;
  }
  if(type==='backSettlement'&&banker&&stage==='next'){
    game.stage='settled';
    return game;
  }
  if(type==='nextRound'&&banker&&stage==='next'){
    if(!whole(action.base,1,100000)) throw new Error('底注請填 1 至 100000 的整數');
    if(!game.players.some(p=>p.id===action.banker)||
      (settings.bankerMode==='fixed'&&action.banker!==game.banker)){
      throw new Error('請選擇下一局莊家');
    }
    game.banker=action.banker;
    settings.base=action.base;
    game.stage='ready';
    game.hands={};
    game.settled=null;
    return game;
  }
  throw new Error('目前無法執行這個操作');
}

export function gameView(state,me,isOwner,esc,fmt){
  const owner=()=>isOwner;
  const banker=()=>me===state.banker && !!me;
  const pname=id=>state.players.find(p=>p.id===id)?.name||'玩家';
  const allRevealed=()=>state.players.every(p=>state.hands[p.id]?.revealed.every(Boolean));
  const evaluations=new Map();
  for(const {id} of state.players){
    const hand=state.hands[id];
    if(hand?.revealed.every(Boolean)) evaluations.set(id,evaluate(hand.cards,state.settings));
  }
  const bankerHand=evaluations.get(state.banker);
  const results=new Map();
  if(bankerHand){
    for(const [id,hand] of evaluations){
      if(id!==state.banker) results.set(id,beatsBanker(hand,bankerHand));
    }
  }
  function resultHtml(id){
    if(id!==state.banker && results.has(id)){
      return results.get(id)
        ? '<strong class="niuOutcome win">勝</strong>'
        : '<strong class="niuOutcome loss">敗</strong>';
    }
    if(id===state.banker && results.size===state.players.length-1){
      const losses=[...results.values()].filter(Boolean).length;
      const wins=results.size-losses;
      if(!losses) return '<strong class="niuOutcome win">勝</strong>';
      if(!wins) return '<strong class="niuOutcome loss">敗</strong>';
      return `<strong class="niuOutcome split"><span class="win">${wins}勝</span><span class="loss">${losses}敗</span></strong>`;
    }
    return evaluations.has(id)?'<span class="muted small">待比牌</span>':'';
  }
  function handTypeHtml(hand){
    if(!hand) return '<span class="handtype">等待開牌</span>';
    if(hand.rank!==0) return `<span class="handtype">${hand.name}</span>`;
    const suit=hand.high%4;
    const rank=ranks[Math.floor(hand.high/4)];
    return `<span class="handtype">無點 <strong class="niuHighCard ${suit===1||suit===2?'red':''}">${rank}${suits[suit]}</strong></span>`;
  }
function cardHtml(card,open,id,i){
  const allowed=state.stage==='reveal'&&(id===me||banker());
  const name=open?ranks[card.rank]+suits[card.suit]:'未開牌 '+(i+1);
  return '<button class="playingcard '+(open?([1,2].includes(card.suit)?'red':''):'back')+'" aria-label="'+name+'" data-niu-card="'+id+':'+i+'" '+(!allowed||open?'disabled':'')+'>'+(open?'<span class="rank">'+ranks[card.rank]+'</span><span class="suit">'+suits[card.suit]+'</span>':'♠')+'</button>';
}
function handHtml(p){
  const h=state.hands[p.id];
  const evaluation=evaluations.get(p.id);
  const revealButton=(me===p.id||banker())&&!evaluation&&state.stage==='reveal'
    ? `<button class="alt" data-niu-reveal="${p.id}">${me===p.id?'一鍵全開':'強制開牌'}</button>` : '';
  return `<section class="hand ${p.id===state.banker?'banker ':''}${me===p.id?'self':''}">
    <div class="row"><h3>${esc(p.name)}${p.id===state.banker?' · 莊家':''}</h3><span class="tag">${me===p.id?'你的手牌':h.revealed.filter(Boolean).length+'/5 已開'}</span></div>
    <div class="cards">${h.cards.map((card,i)=>cardHtml(card,h.revealed[i],p.id,i)).join('')}</div>
    <div class="row handResult">${handTypeHtml(evaluation)}${resultHtml(p.id)}${revealButton}</div>
  </section>`;
}
function settingsHtml(){
  return '<h2>妞妞玩法設定</h2><p class="muted" style="margin-top:8px">三張湊十、另兩張算妞點。同牌型依最大單張，再比花色。</p>'+
  (owner()?'<form id="niuSettings"><div class="fields"><label>莊家模式<select name="bankerMode"><option value="rotate">輪流當莊</option><option value="fixed">固定莊家</option></select></label><label>首局／固定莊家<select name="fixedBanker">'+state.players.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('')+'</select></label><label>每局底注<input name="base" type="number" value="'+state.settings.base+'" min="1" max="100000" step="1" required></label><label>發牌方式<select name="deckMode"><option value="new">每局一副新牌</option><option value="shoe">同副牌用完重洗</option></select></label></div><h3>一般牌型與倍率</h3><div class="fields"><label>升 範圍<div class="rangeInput"><input aria-label="升 範圍" name="highFrom" type="number" min="1" max="9" step="1" value="'+(state.settings.lowMax+1)+'" required><span>～9</span></div></label><label>升 倍率<input name="m_high" type="number" min="1" max="100" step="1" value="'+state.settings.multipliers.high+'" required></label><label>妞 倍率<input name="m_niu" type="number" min="1" max="100" step="1" value="'+state.settings.multipliers.niu+'" required></label></div><h3 style="margin-top:20px">特殊牌型與倍率</h3><div class="rulegrid">'+Object.entries(specialNames).map(([key,name])=>'<label class="check"><input type="checkbox" name="'+key+'" '+(state.settings.special[key]?'checked':'')+'>'+name+'</label><label>倍率<input name="m_'+key+'" type="number" min="1" max="100" step="1" required value="'+state.settings.multipliers[key]+'"></label>').join('')+'</div><div class="summary">每位玩家對莊家結算額＝底注 × 勝方牌型倍率。底注 50 時，1 倍為 50、2 倍為 100。</div><div class="footer"><button class="alt" type="button" data-niu-action="cancelSetup">返回記分表</button><button class="gold">開始遊戲</button></div></form>':'<p class="notice">房主正在設定玩法。設定完成後，所有玩家會同步進入牌桌。</p>')+
  '<details><summary>牌型與結算規則</summary><p>特殊牌型由大至小為同花順、鐵支、五公、順子，再比妞妞、9 至 1、無點。「升」從設定的起始數字至 9，其他點數為「點」。點與無點固定 1 倍。五公限五張 J、Q、K，順子包含 A2345 及 10JQKA。同級取五張內最大牌，K＞Q＞J＞10＞…＞A，黑桃＞紅心＞方塊＞梅花。每位玩家單獨與莊家比牌，依勝方牌型倍率乘以底注轉移分數。完全相同時由莊家勝。</p><p>倍率可在開局前修改。單副牌不足下一局所需張數時，會在發牌前整副重洗。</p></details>';
}
function nextHtml(){
  return '<h2>準備下一局</h2><p class="notice">目前莊家為 '+esc(pname(state.banker))+'，目前底注 '+state.settings.base+' 點。</p>'+
  (banker()?'<form id="niuNext"><div class="fields"><label>是否輪莊<select name="nextBanker"><option value="'+state.banker+'" selected>否（保留目前莊家）</option>'+state.players.filter(p=>state.settings.bankerMode!=='fixed' && p.id!==state.banker).map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('')+'</select></label><label>下一局底注<input type="number" name="base" value="'+state.settings.base+'" min="1" max="100000" step="1" required></label></div><div class="footer"><button class="alt" type="button" data-niu-action="backSettlement">返回結算</button><button class="gold">確認下一局</button></div></form>':'<p class="notice">等待本局莊家確認輪莊與底注。</p>');
}
function settlementHtml(){
  const s=state.settled;
  const rows=state.players.map(({id,name})=>{
    const delta=s.deltas[id];
    const cards=state.hands[id].cards.map(c=>
      `<span class="settlementCard ${[1,2].includes(c.suit)?'red':''}">${c.rank===10?'T':ranks[c.rank]}<small>${suits[c.suit]}</small></span>`
    ).join('');
    return `<div class="settlerow">
      <div><b>${esc(name)}</b><div class="handResult">${handTypeHtml(evaluations.get(id))}${resultHtml(id)}</div><div class="settlementCards" aria-label="${esc(name)} 的五張牌">${cards}</div></div>
      <span>${fmt(s.before[id])}</span><span class="delta ${delta>=0?'pos':'neg'}">${fmt(delta)}</span><strong class="score">${fmt(s.before[id]+delta)}</strong>
    </div>`;
  }).join('');
  return `<h2>第 ${s.round} 局結算</h2><p class="notice">莊家 ${esc(pname(s.banker))} · 底注 ${s.base} 點 · 分數已加入記分表</p>
    <div class="settlement"><div class="settlerow muted small"><span>玩家／牌型</span><span>原分數</span><span>本局增減</span><span>目前分數</span></div>${rows}</div>
    <div class="summary">本局分數合計 ${Object.values(s.deltas).reduce((a,b)=>a+b,0)}。每位玩家對莊家單獨比較，採勝方牌型倍率。</div>
    <div class="footer">${banker()?'<button class="alt" data-niu-action="end">結束遊戲</button><button class="gold" data-niu-action="next">再來一局</button>':'<span class="muted">等待本局莊家選擇下一局或結束。</span>'}</div>`;
}
function gameHtml(){
  if(state.stage==='setup')return settingsHtml();
  if(state.stage==='next')return nextHtml();
  if(state.stage==='settled')return settlementHtml();
  const ready=state.stage==='ready';
  return '<div class="table"><div class="row"><div><h2>妞妞牌桌</h2><p class="muted">莊家 '+esc(pname(state.banker))+' · 底注 '+state.settings.base+' 點</p></div><span class="tag">'+(ready?'準備發牌':'第 '+state.round+' 局')+'</span></div><div class="statusbar"><span>'+ (state.settings.bankerMode==='fixed'?'固定莊家':'輪流當莊')+'</span><span>'+(state.settings.deckMode==='new'?'每局新牌':'同副牌 · 剩 '+state.deck.length+' 張')+'</span></div>'+(!ready?'<div class="hands">'+[...state.players].sort((a,b)=>Number(b.id===me)-Number(a.id===me)).map(handHtml).join('')+'</div>':'<p class="notice">'+(banker()?'由你按下發牌，所有玩家各獲得五張。':'等待莊家發牌。')+'</p>')+'</div><div class="bottom"><span class="muted">'+(ready?'本局尚未發牌':allRevealed()?'全部玩家已開牌，可結算。':'已完成 '+state.players.filter(p=>state.hands[p.id].revealed.every(Boolean)).length+'／'+state.players.length+' 位玩家')+'</span><div class="actions">'+(banker()?(ready?'<button class="alt" data-niu-action="end">結束遊戲</button><button class="gold" data-niu-action="deal">發牌</button>':'<button class="alt" data-niu-action="forceAll">強制全員開牌</button><button class="gold" data-niu-action="settle" '+(!allRevealed()?'disabled':'')+'>結算</button>'):'')+'</div></div>';
}
  return `<div class="niuOverlay" data-niu-session="${esc(state.session)}" data-niu-stage="${state.stage}">
    <section class="dialog" role="dialog" aria-modal="true" aria-label="妞妞遊戲">
      <div class="top"><span class="tag">♠ ScoreZero 妞妞</span><button class="alt" data-niu-action="lobby">返回大廳</button></div>
      ${gameHtml()}
    </section>
  </div>`;
}
