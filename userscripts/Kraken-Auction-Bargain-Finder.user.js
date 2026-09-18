// ==UserScript==
// @name         Kraken Auction Bargain Finder
// @namespace    https://github.com/JaySquire22
// @version      0.8.4
// @description  Adds ranked weapon and armor bargain assessment, searching and sorting to Torn's Auction House in Torn PDA.
// @author       Jay / Kraken
// @match        https://www.torn.com/amarket.php*
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const API_KEY = '###PDA-APIKEY###';
  const HISTORY_URL = 'https://btrmmuuoofbonmuwrkzg.supabase.co/functions/v1/search-auctions';
  const HISTORY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0cm1tdXVvb2Zib25tdXdya3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTEzMTgsImV4cCI6MjA4NDQyNzMxOH0.E-s0k46BORXLICAvxtEpqoM3Qmh4-TRLaJAwXO6wJTY';
  const CACHE_MS = 30 * 60 * 1000;
  const PANEL_SELECTOR = '.tabContent[data-itemtype="weapons"], .tabContent[data-itemtype="armor"]';
  const ROW_SELECTOR = 'div.items-list-wrap > ul.items-list > li';
  const BONUS_IDS = {Achilles:50,Assassinate:72,Backstab:52,Berserk:54,Bleed:57,Blindfire:33,Blindside:51,Bloodlust:85,Comeback:67,Conserve:55,Cripple:45,Crusher:49,Cupid:47,Deadeye:63,Deadly:62,Demoralize:36,Disarm:86,'Double Tap':105,'Double-edged':74,Empower:87,Eviscerate:56,Execute:75,Expose:1,Finale:82,Focus:79,Freeze:38,Frenzy:80,Fury:64,Grace:53,Hazardous:34,'Home run':83,Immutable:115,Impassable:26,Impenetrable:17,Imperviable:22,Impregnable:15,Insurmountable:92,Invulnerable:91,Irradiate:102,Irrepressible:121,Kinetokinesis:112,Lacerate:89,Motivation:61,Paralyze:59,Parry:84,Penetrate:101,Plunder:21,Powerful:68,Proficience:14,Puncture:66,Quicken:88,'Radiation Protection':90,Rage:65,Revitalize:41,Roshambo:43,Shock:120,Slow:44,Smash:104,Smurf:73,Specialist:71,Spray:35,Storage:37,Stricken:20,Stun:58,Suppress:60,'Sure Shot':78,Throttle:48,Toxin:103,Warlord:81,Weaken:46,'Wind-up':76,Wither:42};
  const ARMOR_ATTRIBUTE_NAMES=['Immutable','Impassable','Impenetrable','Imperviable','Impregnable','Insurmountable','Invulnerable','Irrepressible','Kinetokinesis','Radiation Protection'];
  const ARMOR_SETS=['Assault','Dune','EOD','Marauder','Riot','Sentinel'];
  const WEAPON_BONUS_NAMES=Object.keys(BONUS_IDS).filter(x=>!ARMOR_ATTRIBUTE_NAMES.includes(x)).sort();
  const SLOT_TYPES={primary:new Set(['HA','MG','RF','SG','SM']),secondary:new Set(['HA','MK','PI','PS','SG','SM']),melee:new Set(['CL','MK','PI','SL'])};
  const BONUS_TYPES={Achilles:['PI','PS','RF'],Assassinate:['PI','PS','RF'],Backstab:['PI'],Berserk:['SL'],Bleed:['PI','SG','SL'],Blindfire:['MG'],Blindside:['SG'],Bloodlust:['SL'],Comeback:['SM'],Conserve:['MG','RF','SM'],Cripple:['HA','SG'],Crusher:['CL'],Cupid:['PI','PS','RF'],Deadeye:['PI','PS','RF','MG'],Deadly:['SG'],Demoralize:['RF'],Disarm:['CL','PI','PS','RF','SL'],'Double Tap':['PS'],'Double-edged':['SL'],Empower:['PI','CL','SL'],Eviscerate:['PI','SG','SL'],Execute:['PS'],Expose:['PS','RF','SG','SL'],Finale:['HA'],Focus:['RF'],Freeze:['HA'],Frenzy:['CL','PI','SL'],Fury:['CL','PI','SL'],Grace:['SL'],Hazardous:['SG'],'Home run':['CL'],Irradiate:['PI'],Lacerate:['SL'],Motivation:['CL','PS','SL','SM'],Paralyze:['HA'],Parry:['SL'],Penetrate:['MG','PI','RF'],Plunder:['CL','PI','SL'],Powerful:['CL','HA','RF','SM','SG','MG'],Proficience:['SM'],Puncture:['MG','PI','RF'],Quicken:['PS','SL','SM'],Rage:['CL','PI','SL'],Revitalize:['SM'],Roshambo:['CL'],Shock:['MK'],Slow:['CL','PI','SM'],Smash:['CL'],Smurf:['MG'],Specialist:['MG','PS','RF','SM','SG','HA'],Spray:['SM'],Storage:['CL'],Stricken:['HA'],Stun:['CL','HA','SG'],Suppress:['MG'],'Sure Shot':['RF'],Throttle:['PS','RF','SG','SL','SM'],Toxin:['SL'],Warlord:['HA','RF','SG','SM','MG'],Weaken:['PI','RF','SG','SL'],'Wind-up':['CL','PI','SL'],Wither:['PI','PS','SM']};

  const state = { rows: new Map(), weaponCatalogue: [], weaponCatalogues:{primary:[],secondary:[],melee:[]}, armorCatalogue: [], activeMode: null, weaponSlot:'all', armorType:'all', selections:{weapon:{items:[],bonuses:[]},armor:{items:[],bonuses:[]}}, catalogueLoading: false, busy: false, hydrating: false, scanningAll: false, stopRequested: false, timer: null, hydrateTimer: null, assessed: 0, errors: 0, page: 0 };
  const $ = (id) => document.getElementById(id);
  const money = (n) => Number.isFinite(n) ? '$' + Math.round(n).toLocaleString() : '—';
  const number = (v) => { if(v===null||v===undefined||String(v).trim()==='')return null;const n = Number(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null; };
  const median = (a) => { if (!a.length) return null; const s=[...a].sort((x,y)=>x-y), m=Math.floor(s.length/2); return s.length%2?s[m]:Math.round((s[m-1]+s[m])/2); };
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  function injectStyle() {
    if ($('kabf-style')) return;
    const style=document.createElement('style'); style.id='kabf-style'; style.textContent=`
      #kabf{margin:8px 0 12px;background:#111723;border:1px solid #344158;border-radius:12px;color:#f4f7fb;font:13px/1.35 Arial,sans-serif;overflow:hidden}
      #kabf summary{padding:12px 14px;font-weight:800;cursor:pointer;background:#171f2e;list-style:none} #kabf summary::-webkit-details-marker{display:none}
      #kabf .body{padding:10px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px} #kabf label{color:#aab4c5;font-size:11px}
      #kabf select,#kabf input,#kabf button{width:100%;min-height:40px;margin-top:3px;border:1px solid #344158;border-radius:8px;background:#202a3b;color:#fff;padding:7px;font:inherit}
      #kabf button{background:#a72f43;font-weight:800} #kabf .wide{grid-column:1/-1} #kabf-status{color:#aab4c5;padding:0 10px 10px}
      #kabf .multi{position:relative;margin-top:3px}#kabf .multi>summary{min-height:40px;padding:10px;border:1px solid #344158;border-radius:8px;background:#202a3b;color:#fff;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#kabf .multi-options{max-height:240px;overflow:auto;padding:6px;background:#171f2e;border:1px solid #344158;border-radius:8px;margin-top:4px}#kabf .multi-options label{display:flex;align-items:center;gap:8px;padding:7px;color:#fff;font-size:12px}#kabf .multi-options input{width:20px;min-height:20px;margin:0;accent-color:#c43a50}
      li[data-kabf]{position:relative} .kabf-badge{margin:7px 8px;padding:7px 9px;border-radius:8px;background:#1c2636;border-left:4px solid #718096;font:12px/1.35 Arial,sans-serif;color:#eaf0f8}
      .kabf-good{border-left-color:#3bc98b;color:#86efc0}.kabf-bad{border-left-color:#e55262;color:#ff9ba6}.kabf-wait{border-left-color:#e7b24a;color:#f4d284}
      li.kabf-hidden{display:none!important} li.kabf-best{box-shadow:inset 4px 0 #3bc98b}
      #kabf-results{position:fixed;inset:5vh 3vw;z-index:2147483646;background:#0d131e;border:1px solid #46546d;border-radius:14px;color:#fff;box-shadow:0 12px 45px #000;display:none;flex-direction:column;overflow:hidden;font:13px/1.4 Arial,sans-serif}
      #kabf-results.open{display:flex} #kabf-results .head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#171f2e;font-weight:800} #kabf-results .head button{width:auto;min-height:34px;margin:0;padding:5px 12px}
      #kabf-results .sortbar{display:flex;align-items:center;gap:8px;padding:8px 14px;background:#111927;border-bottom:1px solid #344158;color:#aab4c5}#kabf-results .sortbar select{flex:1;min-height:36px;border:1px solid #344158;border-radius:7px;background:#202a3b;color:#fff;padding:6px}
      #kabf-results-list{padding:10px;overflow:auto;display:grid;gap:8px}.kabf-result{background:#171f2e;border:1px solid #344158;border-radius:10px;padding:10px}.kabf-result.good{border-left:4px solid #3bc98b}.kabf-result .title{font-weight:800;font-size:14px;color:#fff!important}.kabf-result .meta{color:#aab4c5;margin-top:3px}.kabf-result .deal{color:#86efc0;font-weight:800;margin-top:5px}.kabf-result .waiting{color:#f4d284;margin-top:5px}
      .kabf-open,.kabf-history{display:inline-block;width:auto!important;min-height:34px!important;margin:7px 6px 0 0!important;padding:6px 10px!important;background:#344158!important;color:#fff!important;border:0!important;border-radius:7px!important;text-decoration:none!important;font-weight:700!important}.kabf-history{background:#6e3343!important}.kabf-sales{margin-top:7px;padding-top:6px;border-top:1px solid #344158;color:#aab4c5}.kabf-sale{display:flex;justify-content:space-between;gap:10px;padding:3px 0}.kabf-highlight{animation:kabf-flash 1s 4;box-shadow:inset 0 0 0 3px #f3b644!important}@keyframes kabf-flash{50%{background:rgba(243,182,68,.24)}}
    `; document.head.appendChild(style);
  }

  function auctionPanel(){const panels=[...document.querySelectorAll(PANEL_SELECTOR)];return panels.find(p=>p.offsetParent!==null&&!p.hidden&&getComputedStyle(p).display!=='none')||panels.find(p=>p.classList.contains('active'))||panels[0]||null;}
  function panelMode(panel){return panel?.dataset.itemtype==='armor'?'armor':'weapon';}

  function makePanel(panel) {
    if ($('kabf')){const box=$('kabf'),list=panel.querySelector('div.items-list-wrap');if(box.parentElement!==panel)panel.insertBefore(box,list||panel.firstChild);switchSearchMode(panelMode(panel));return;}
    const box=document.createElement('details'); box.id='kabf'; box.open=true;
    box.innerHTML=`<summary>🐙 Kraken Auction Bargain Finder</summary><div class="body">
      <label class="wide" id="kabf-slot-field">Weapon category<select id="kabf-weapon-slot"><option value="all">All weapon categories</option><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="melee">Melee</option></select></label>
      <label><span id="kabf-item-label">Weapons</span><details class="multi" id="kabf-weapon-picker"><summary id="kabf-weapon-summary">All weapons</summary><div class="multi-options" id="kabf-weapon-options"></div></details></label>
      <label><span id="kabf-bonus-label">Bonuses</span><details class="multi" id="kabf-bonus-picker"><summary id="kabf-bonus-summary">All bonuses</summary><div class="multi-options" id="kabf-bonus-options"></div></details></label>
      <button class="wide" id="kabf-assess">Search every auction page</button>
      <button class="wide" id="kabf-show">Show matching auctions</button>
      <button class="wide" id="kabf-stop" style="display:none;background:#4a5568">Stop after this page</button>
    </div><div id="kabf-status">Waiting for weapon auctions…</div>`;
    const list=panel.querySelector('div.items-list-wrap'); panel.insertBefore(box,list||panel.firstChild);
    ['kabf-weapon-options','kabf-bonus-options'].forEach(id=>$(id).addEventListener('change',async()=>{saveCurrentSelections();updatePickerSummaries();renderResults();if(!state.busy){await loadMatchingHistories();renderResults();}}));
    $('kabf-weapon-slot').addEventListener('change',async e=>{if(state.activeMode==='armor')state.armorType=e.target.value;else state.weaponSlot=e.target.value;pruneCategorySelections();refreshWeaponOptions();refreshBonusOptions();renderResults();if(!state.busy){await loadMatchingHistories();renderResults();}});
    $('kabf-assess').addEventListener('click', assessVisible);
    $('kabf-show').addEventListener('click',async()=>{if(!state.busy)await loadMatchingHistories();renderResults();$('kabf-results').classList.add('open');});
    $('kabf-stop').addEventListener('click',()=>{state.stopRequested=true;$('kabf-status').textContent='Stopping after the current page…';});
    if(!$('kabf-results')){const results=document.createElement('section');results.id='kabf-results';results.innerHTML='<div class="head"><span>🐙 Matching Auction Items</span><button id="kabf-close">Close</button></div><div class="sortbar"><label for="kabf-result-sort">Sort</label><select id="kabf-result-sort"><option value="end">Ending soonest</option><option value="bonus">Highest bonus %</option><option value="damage">Highest damage / armor</option><option value="quality">Highest quality</option></select></div><div id="kabf-results-list"></div>';document.body.appendChild(results);$('kabf-close').addEventListener('click',()=>results.classList.remove('open'));$('kabf-result-sort').addEventListener('change',renderResults);$('kabf-results-list').addEventListener('click',async e=>{const open=e.target.closest('[data-kabf-open]'),historyButton=e.target.closest('[data-kabf-history]');if(open){e.preventDefault();await openAuctionCard(open.dataset.kabfOpen);}if(historyButton){e.preventDefault();const r=state.rows.get(historyButton.dataset.kabfHistory);if(r){historyButton.disabled=true;historyButton.textContent='Loading history…';await assessOne(r,true);renderResults();}}});}
    loadWeaponCatalogue();
    switchSearchMode(panelMode(panel));
  }

  function selectedValues(id){return [...($(id)?.querySelectorAll('input:checked')||[])].map(x=>x.value);}
  function pickerText(values,empty){return values.length?values.join(', '):empty;}
  function updatePickerSummaries(){const armor=state.activeMode==='armor';$('kabf-weapon-summary').textContent=pickerText(selectedValues('kabf-weapon-options'),armor?'All armor':'All weapons');$('kabf-bonus-summary').textContent=pickerText(selectedValues('kabf-bonus-options'),armor?'All armor sets':'All bonuses');}
  function saveCurrentSelections(){if(!state.activeMode)return;state.selections[state.activeMode]={items:selectedValues('kabf-weapon-options'),bonuses:selectedValues('kabf-bonus-options')};}
  function refreshCategorySelect(){const field=$('kabf-slot-field'),select=$('kabf-weapon-slot');if(!field||!select)return;if(state.activeMode==='armor'){field.firstChild.textContent='Armor type';select.innerHTML='<option value="all">All armor types</option>'+ARMOR_SETS.map(x=>`<option value="${x.toLowerCase()}">${x}</option>`).join('');select.value=state.armorType;}else{field.firstChild.textContent='Weapon category';select.innerHTML='<option value="all">All weapon categories</option><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="melee">Melee</option>';select.value=state.weaponSlot;}}
  function switchSearchMode(mode){if(!$('kabf-weapon-options')||state.activeMode===mode)return;saveCurrentSelections();state.activeMode=mode;refreshCategorySelect();$('kabf-item-label').textContent=mode==='armor'?'Armor':'Weapons';$('kabf-bonus-label').textContent=mode==='armor'?'Armor sets':'Bonuses';refreshWeaponOptions();refreshBonusOptions();}

  function endTimeToEpoch(title){const m=String(title||'').match(/(\d{2}):(\d{2}):(\d{2})\s*-\s*(\d{2})\/(\d{2})\/(\d{2})/);if(!m)return null;return Math.floor(Date.UTC(2000+Number(m[6]),Number(m[5])-1,Number(m[4]),Number(m[1]),Number(m[2]),Number(m[3]))/1000);}
  function remaining(r){return r.endEpoch===null?null:r.endEpoch-Math.floor(Date.now()/1000);}
  function remainingText(seconds){if(seconds===null)return 'Unknown end time';if(seconds<=0)return 'Ended';const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;return h?`${h}h ${m}m remaining`:`${m}m ${s}s remaining`;}

  function parsePrice(li) {
    const clean=li.cloneNode(true);clean.querySelectorAll('.kabf-badge,#kabf,.kabf-result').forEach(x=>x.remove());
    const candidates=['.price-wrap','.price','.bid-wrap','.current-bid','.amount'];
    for (const sel of candidates) { const el=clean.querySelector(sel); const matches=el&&el.textContent.match(/\$\s*([\d,]+)/g); if(matches?.length){const values=matches.map(number).filter(Number.isFinite); if(values.length)return values[0];} }
    const bidText=[...clean.querySelectorAll('div,span')].find(x=>/^\s*Bid\s*:/i.test(x.textContent||''))?.textContent||clean.textContent;
    const match=bidText.match(/Bid\s*:\s*\$\s*([\d,]+)/i)||bidText.match(/\$\s*([\d,]+)/);return match?number(match[1]):null;
  }

  function scrape() {
    const panel=auctionPanel(); if(!panel)return;
    makePanel(panel);
    panel.querySelectorAll(ROW_SELECTOR).forEach((li,index)=>{
      const hover=li.querySelector('span.item-hover');
      const uid=hover?.getAttribute('armoury'); const itemId=number(hover?.getAttribute('item'));
      if(!uid||!itemId)return;
      const old=state.rows.get(uid)||{},timeEl=li.querySelector('div.time-wrap span[title], [class*="time"] span[title], span[title*="Ends"]'),endEpoch=endTimeToEpoch(timeEl?.getAttribute('title'));
      const row={...old,uid,itemId,li,itemType:panel.dataset.itemtype==='armor'?'armor':'weapon',cardId:li.id||old.cardId||'',price:parsePrice(li),endEpoch,originalIndex:index,page:state.page||1};
      if(row.result?.median&&row.price!==null)row.result.diff=(row.price-row.result.median)*100/row.result.median;
      state.rows.set(uid,row);
      li.dataset.kabf=uid;
      if(row.name)renderBadge(row);
    });
    updateStatus();
    clearTimeout(state.hydrateTimer);state.hydrateTimer=setTimeout(hydrateVisibleCards,250);
  }

  async function pdaGet(url,headers={}) { const r=await PDA_httpGet(url,headers); if(Number(r.status)>=400)throw new Error(`Torn API HTTP ${r.status}`); return JSON.parse(r.responseText); }
  async function pdaPost(url,headers,body) { const r=await PDA_httpPost(url,headers,body); if(Number(r.status)>=400)throw new Error(`History HTTP ${r.status}: ${(r.responseText||'').slice(0,100)}`); return JSON.parse(r.responseText); }

  async function enrich(rows) {
    for(let i=0;i<rows.length;i+=25){
      const batch=rows.slice(i,i+25), uids=batch.map(x=>x.uid).join(',');
      const data=await pdaGet(`https://api.torn.com/v2/torn/${uids}/itemdetails?key=${encodeURIComponent(API_KEY)}&comment=KrakenAuctionFinder`);
      const details=Array.isArray(data.itemdetails)?data.itemdetails:Object.values(data.itemdetails||{});
      details.forEach(d=>{const r=state.rows.get(String(d.uid??d.UID)); if(!r)return; const stats=d.stats||{}; Object.assign(r,{name:d.name||'Unknown',type:d.type||'',rarity:d.rarity||'',bonuses:Array.isArray(d.bonuses)?d.bonuses:Object.values(d.bonuses||{}),damage:number(stats.damage??d.damage),accuracy:number(stats.accuracy??d.accuracy),armor:number(stats.armor??d.armor),quality:number(d.quality??d.stat_quality??stats.quality)});});
    }
    refreshWeaponOptions();
  }

  function eligibleBonuses(){if(state.weaponSlot==='all')return WEAPON_BONUS_NAMES;const types=SLOT_TYPES[state.weaponSlot];return WEAPON_BONUS_NAMES.filter(name=>(BONUS_TYPES[name]||[]).some(type=>types.has(type)));}
  function armorTypeMatch(name){return state.armorType==='all'||String(name||'').toLowerCase().includes(state.armorType);}
  function activeCatalogue(){if(state.activeMode==='armor')return state.armorCatalogue.filter(armorTypeMatch);return state.weaponSlot==='all'?state.weaponCatalogue:state.weaponCatalogues[state.weaponSlot]||[];}
  function pruneCategorySelections(){if(state.activeMode==='armor'){const itemNames=new Set(activeCatalogue());state.selections.armor.items=state.selections.armor.items.filter(x=>itemNames.has(x));if(state.armorType!=='all')state.selections.armor.bonuses=[];return;}const itemNames=new Set(activeCatalogue()),bonusNames=new Set(eligibleBonuses());state.selections.weapon.items=state.selections.weapon.items.filter(x=>itemNames.has(x));state.selections.weapon.bonuses=state.selections.weapon.bonuses.filter(x=>bonusNames.has(x));}
  function refreshWeaponOptions(){const box=$('kabf-weapon-options');if(!box||!state.activeMode)return;const selected=new Set(state.selections[state.activeMode].items),catalogue=activeCatalogue(),visibleRows=[...state.rows.values()].filter(r=>r.itemType===state.activeMode&&(state.activeMode==='armor'?armorTypeMatch(r.name):(state.weaponSlot==='all'||catalogue.includes(r.name)))).map(r=>r.name),names=[...new Set([...catalogue,...visibleRows].filter(Boolean))];selected.forEach(x=>{if(!names.includes(x))names.push(x);});names.sort((a,b)=>a.localeCompare(b));box.innerHTML=names.map(x=>`<label><input type="checkbox" value="${escapeHtml(x)}" ${selected.has(x)?'checked':''}>${escapeHtml(x)}</label>`).join('');updatePickerSummaries();}
  function refreshBonusOptions(){const box=$('kabf-bonus-options');if(!box||!state.activeMode)return;const selected=new Set(state.selections[state.activeMode].bonuses),names=state.activeMode==='armor'?ARMOR_SETS:eligibleBonuses();box.innerHTML=names.map(x=>`<label><input type="checkbox" value="${escapeHtml(x)}" ${selected.has(x)?'checked':''}>${escapeHtml(x)}</label>`).join('');updatePickerSummaries();}
  async function loadWeaponCatalogue(){if(state.catalogueLoading||(state.weaponCatalogue.length&&state.armorCatalogue.length))return;state.catalogueLoading=true;try{const categories=['Primary','Secondary','Melee'],weaponPayloads=await Promise.all(categories.map(cat=>pdaGet(`https://api.torn.com/v2/torn/items?cat=${encodeURIComponent(cat)}&key=${encodeURIComponent(API_KEY)}&comment=KrakenAuctionFinder`))),armorPayload=await pdaGet(`https://api.torn.com/v2/torn/items?cat=Defensive&key=${encodeURIComponent(API_KEY)}&comment=KrakenAuctionFinder`);categories.forEach((cat,i)=>{state.weaponCatalogues[cat.toLowerCase()]=[...new Set((weaponPayloads[i].items||[]).map(x=>x.name).filter(Boolean))];});state.weaponCatalogue=[...new Set(Object.values(state.weaponCatalogues).flat())];state.armorCatalogue=[...new Set((armorPayload.items||[]).map(x=>x.name).filter(Boolean))];pruneCategorySelections();refreshWeaponOptions();refreshBonusOptions();}catch(_){refreshWeaponOptions();refreshBonusOptions();}finally{state.catalogueLoading=false;}}

  function requestBody(r,exact=true) {
    const body={limit:100,offset:0,sort_by:'timestamp',sort_order:'desc',item_name:r.name};
    (r.bonuses||[]).slice(0,2).forEach((b,i)=>{const p=i+1,title=b.title||b.name||'',id=b.id||BONUS_IDS[title],value=number(b.value??b.percentage??b.percent); if(!id)return; body[`bonus${p}_ids`]=[Number(id)]; if(exact&&value!==null){const exactValue=Math.round(value);body[`bonus${p}_id`]=Number(id);body[`bonus${p}_value_min`]=exactValue;body[`bonus${p}_value_max`]=exactValue;}});
    return body;
  }

  function targetBonuses(r){return (r.bonuses||[]).slice(0,2).map(b=>({id:Number(b.id||BONUS_IDS[b.title||b.name]),value:Math.round(number(b.value??b.percentage??b.percent))})).filter(b=>b.id&&Number.isFinite(b.value));}
  function saleBonuses(s){return (s.bonus_values||s.bonuses||[]).map(b=>({id:Number(b.bonus_id??b.id),value:Math.round(number(b.bonus_value??b.value??b.percentage??b.percent))})).filter(b=>b.id&&Number.isFinite(b.value));}
  function exactBonusMatch(r,s){const wanted=targetBonuses(r),got=saleBonuses(s);return wanted.length===got.length&&wanted.every(w=>got.some(g=>g.id===w.id&&g.value===w.value));}
  function sameBonusTypes(r,s){const wanted=targetBonuses(r),got=saleBonuses(s);return wanted.length===got.length&&wanted.every(w=>got.some(g=>g.id===w.id));}
  function bonusDistance(r,s){const got=saleBonuses(s);return targetBonuses(r).reduce((total,w)=>{const g=got.find(x=>x.id===w.id);return total+(g?Math.abs(g.value-w.value):999);},0);}
  function saleEpoch(s){const raw=s.timestamp??s.sold_at??s.end_time??s.created_at;if(raw==null)return null;if(typeof raw==='number'||/^\d+$/.test(String(raw))) {const n=Number(raw);return n>1e12?Math.floor(n/1000):Math.floor(n);}const parsed=Date.parse(raw);return Number.isFinite(parsed)?Math.floor(parsed/1000):null;}
  function comparableSales(r,data) {
    const cutoff=Math.floor(Date.now()/1000)-(365*24*60*60);
    const sales=(data.auctions||[]).filter(x=>number(x.price)>0&&exactBonusMatch(r,x)&&saleEpoch(x)!==null&&saleEpoch(x)>=cutoff).map(x=>({...x,_price:number(x.price),_quality:number(x.stat_quality??x.quality),_damage:number(x.stat_damage??x.damage),_armor:number(x.stat_armor??x.armor),_bonuses:saleBonuses(x)}));
    sales.sort((a,b)=>{const aq=r.quality!==null&&a._quality!==null?Math.abs(a._quality-r.quality):9999,bq=r.quality!==null&&b._quality!==null?Math.abs(b._quality-r.quality):9999;return aq-bq;});
    return sales.slice(0,20);
  }

  function closestSales(r,data){const cutoff=Math.floor(Date.now()/1000)-(365*24*60*60);const sales=(data.auctions||[]).filter(x=>number(x.price)>0&&sameBonusTypes(r,x)&&saleEpoch(x)!==null&&saleEpoch(x)>=cutoff).map(x=>({...x,_price:number(x.price),_quality:number(x.stat_quality??x.quality),_damage:number(x.stat_damage??x.damage),_armor:number(x.stat_armor??x.armor),_bonuses:saleBonuses(x),_bonusGap:bonusDistance(r,x)}));sales.sort((a,b)=>a._bonusGap-b._bonusGap||((r.quality!==null&&a._quality!==null?Math.abs(a._quality-r.quality):9999)-(r.quality!==null&&b._quality!==null?Math.abs(b._quality-r.quality):9999)));return sales.slice(0,20);}

  function cacheKey(r,exact){return `kabf-${exact?'exact':'closest'}12:`+r.name+':'+(r.bonuses||[]).slice(0,2).map(b=>`${b.title||b.name}:${Math.round(number(b.value??b.percentage??b.percent))}`).join('|');}
  function trimHistoryCache(keep=6){const entries=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith('kabf-'))continue;let at=0;try{at=JSON.parse(localStorage.getItem(key)||'null')?.at||0;}catch(_){ }entries.push({key,at});}entries.sort((a,b)=>b.at-a.at);entries.slice(keep).forEach(x=>localStorage.removeItem(x.key));}
  function cacheHistory(key,data){const value=JSON.stringify({at:Date.now(),data});try{localStorage.setItem(key,value);}catch(_){try{trimHistoryCache(4);localStorage.setItem(key,value);}catch(__){/* Caching is optional; never fail an assessment because PDA storage is full. */}}}
  async function history(r,exact=true) {
    const key=cacheKey(r,exact); try{const c=JSON.parse(localStorage.getItem(key)||'null');if(c&&Date.now()-c.at<CACHE_MS)return c.data;}catch(_){ }
    const data=await pdaPost(HISTORY_URL,{'Content-Type':'application/json',apikey:HISTORY_KEY,Authorization:'Bearer '+HISTORY_KEY},JSON.stringify(requestBody(r,exact)));
    cacheHistory(key,data); return data;
  }

  function salesHtml(x){return (x.sales||[]).slice(0,10).map(s=>`<div class="kabf-sale"><span>${Number.isFinite(s._armor)?'ARM '+s._armor:'DMG '+(s._damage??'?')} · Bonus ${s._bonuses?.map(b=>`${b.value}%`).join(' + ')||'?'} · Quality ${s._quality??'?'}%</span><b>${money(s._price)}</b></div>`).join('');}
  function renderBadge(r) {
    if(!r.li?.isConnected)return;
    let badge=r.li.querySelector('.kabf-badge'); if(!badge){badge=document.createElement('div');badge.className='kabf-badge';r.li.appendChild(badge);}const wasOpen=badge.querySelector('details')?.open||false;
    if(r.error){badge.className='kabf-badge kabf-bad';badge.innerHTML=`${escapeHtml(r.error)}<br><button class="kabf-history">Retry history</button>`;badge.querySelector('button').onclick=()=>assessOne(r,true);return;}
    if(!r.result){badge.className='kabf-badge kabf-wait';badge.innerHTML=`<details><summary>Show auction historical prices</summary><div class="kabf-sales">Historical auction comparison available<br><button class="kabf-history">Load auction history</button></div></details>`;const details=badge.querySelector('details');if(wasOpen)details.open=true;badge.querySelector('button').onclick=async()=>{details.open=true;badge.querySelector('button').disabled=true;badge.querySelector('button').textContent='Loading…';await assessOne(r,true);};return;}
    const x=r.result, good=x.diff<0; badge.className='kabf-badge '+(good?'kabf-good':'kabf-bad');
    const summary=remaining(r)!==null&&remaining(r)<=3600&&remaining(r)>0?`<b>${x.diff===null?'No estimate':`${Math.abs(x.diff).toFixed(1)}% ${good?'below':'above'} median`}</b> · `:'';
    badge.innerHTML=`${x.exact?'':'<b style="color:#ff6b78">No exact comparisons</b><br>'}${summary}median ${money(x.median)} · low ${money(x.low)} · high ${money(x.high)}<br>Quality ${r.quality??'?'}% · ${x.count} ${x.exact?'exact':'closest'} comparable sale${x.count===1?'':'s'}${x.qualityGap!==null?` · closest quality gap ${x.qualityGap.toFixed(1)}%`:''}<details><summary>Show recent comparable sales</summary><div class="kabf-sales">${salesHtml(x)||'No comparable sales found.'}</div></details>`;if(wasOpen)badge.querySelector('details').open=true;
    r.li.classList.toggle('kabf-best',x.diff<=-10);
  }

  async function assessOne(r,force=false){
    if(r.result&&!force){renderBadge(r);return r.result;}
    try{const exactData=await history(r,true);let sales=comparableSales(r,exactData),exact=sales.length>0;if(!exact){const broadData=await history(r,false);sales=closestSales(r,broadData);}const prices=sales.map(x=>x._price),med=median(prices),closest=sales.find(x=>r.quality!==null&&x._quality!==null);r.result={exact,median:med,low:prices.length?Math.min(...prices):null,high:prices.length?Math.max(...prices):null,count:sales.length,sales,diff:med&&r.price!==null?((r.price-med)*100/med):null,qualityGap:closest?Math.abs(closest._quality-r.quality):null};r.error=null;state.assessed++;}
    catch(e){r.error='Assessment unavailable: '+e.message;state.errors++;}
    renderBadge(r);renderResults();return r.result;
  }

  async function hydrateVisibleCards(){
    if(state.busy||state.hydrating)return;const rows=currentRows();if(!rows.length)return;state.hydrating=true;
    try{const missing=rows.filter(r=>!r.name);if(missing.length)await enrich(missing);rows.filter(matchesSearch).forEach(renderBadge);for(const r of rows){const rem=remaining(r);if(matchesSearch(r)&&rem!==null&&rem>0&&rem<=3600&&!r.result){await assessOne(r);await new Promise(resolve=>setTimeout(resolve,120));}}}
    catch(e){if($('kabf-status'))$('kabf-status').textContent='Visible-card setup failed: '+e.message;}
    finally{state.hydrating=false;updateStatus();}
  }

  async function loadMatchingHistories(){const rows=matchingRows().filter(r=>!r.result);for(let i=0;i<rows.length;i++){if(state.stopRequested)break;$('kabf-status').textContent=`Loading matching auction history ${i+1} of ${rows.length}…`;await assessOne(rows[i]);await new Promise(resolve=>setTimeout(resolve,120));}}

  async function assessPage(rows) {
      await enrich(rows);
      rows.filter(matchesSearch).forEach(renderBadge);
      for(let i=0;i<rows.length;i++){
        const r=rows[i];
        if(!matchesSearch(r))continue;
        if(remaining(r)===null||remaining(r)>3600||remaining(r)<=0)continue;
        if(r.result&&!r.error){renderBadge(r);continue;}
        $('kabf-status').textContent=`Page ${state.page}: bargain-checking ${i+1} of ${rows.length} · ${state.assessed} ending soon…`;
        await assessOne(r);await new Promise(resolve=>setTimeout(resolve,120));
      }
      renderResults();
  }

  function currentRows(){return [...state.rows.values()].filter(r=>r.li.isConnected);}
  function pageFingerprint(){return currentRows().map(r=>r.uid).sort().join('|');}
  function pager(){return auctionPanel()?.querySelector('div.pagination-wrap')||null;}
  function usable(a){return a&&!a.matches('.disabled,[aria-disabled="true"]');}
  function nextPageLink(){
    const p=pager();if(!p)return null;
    const anchors=[...p.querySelectorAll('a')];
    const numbered=anchors.find(a=>usable(a)&&a.textContent.trim()===String(state.page+1));if(numbered)return numbered;
    const direct=anchors.find(a=>usable(a)&&(/next/i.test(`${a.className} ${a.title} ${a.getAttribute('aria-label')||''}`)||/^[›»>]$/.test(a.textContent.trim())));
    if(direct)return direct;
    const active=p.querySelector('.active,[aria-current="page"]');
    if(active){let n=active.nextElementSibling;while(n){const a=n.matches?.('a')?n:n.querySelector?.('a');if(usable(a))return a;n=n.nextElementSibling;}}
    return null;
  }
  function firstPageLink(){
    const p=pager();if(!p)return null;
    return [...p.querySelectorAll('a')].find(a=>usable(a)&&(/^1$/.test(a.textContent.trim())||/[?&#](start|page)=0(?:&|$)/.test(a.getAttribute('href')||'')))||null;
  }
  function waitForDifferentPage(before,timeout=15000){return new Promise((resolve,reject)=>{const started=Date.now(),tick=()=>{scrape();const now=pageFingerprint();if(now&&now!==before)return resolve();if(Date.now()-started>timeout)return reject(new Error('Torn did not load the next auction page'));setTimeout(tick,250);};setTimeout(tick,250);});}
  async function clickAndWait(link){const before=pageFingerprint();link.click();await waitForDifferentPage(before);}
  async function openAuctionCard(uid){
    $('kabf-results')?.classList.remove('open');let target=state.rows.get(String(uid));
    if(target?.li?.isConnected){target.li.scrollIntoView({behavior:'smooth',block:'center'});target.li.classList.add('kabf-highlight');setTimeout(()=>target.li.classList.remove('kabf-highlight'),4500);return;}
    if(state.busy)return;state.busy=true;$('kabf-status').textContent=`Opening auction on page ${target?.page||'?'}…`;
    try{scrape();const first=firstPageLink();if(first)await clickAndWait(first);let page=1;
      while(page<=Math.max(1,target?.page||100)){scrape();target=state.rows.get(String(uid));if(target?.li?.isConnected)break;const next=nextPageLink();if(!next)break;await clickAndWait(next);page++;}
      target=state.rows.get(String(uid));if(!target?.li?.isConnected)throw new Error('Auction card is no longer available');renderBadge(target);target.li.scrollIntoView({behavior:'smooth',block:'center'});target.li.classList.add('kabf-highlight');setTimeout(()=>target.li.classList.remove('kabf-highlight'),4500);
    }catch(e){$('kabf-status').textContent='Could not open auction: '+e.message;}finally{state.busy=false;}
  }

  async function assessVisible() {
    if(state.busy)return; state.busy=true; state.scanningAll=true;state.stopRequested=false;state.assessed=0;state.errors=0;state.page=0;document.querySelectorAll('.kabf-badge').forEach(x=>x.remove());document.querySelectorAll('.kabf-best').forEach(x=>x.classList.remove('kabf-best'));state.rows.clear();$('kabf-assess').disabled=true;$('kabf-stop').style.display='block';
    try{
      scrape();
      const first=firstPageLink();if(first){$('kabf-status').textContent='Opening auction page 1…';await clickAndWait(first);}
      const visited=new Set();
      while(!state.stopRequested){
        state.page++;scrape();const fingerprint=pageFingerprint();if(!fingerprint||visited.has(fingerprint))break;visited.add(fingerprint);
        await assessPage(currentRows());
        if(state.stopRequested)break;
        const next=nextPageLink();if(!next)break;
        $('kabf-status').textContent=`Page ${state.page} complete · opening the next auction page…`;
        await clickAndWait(next);
      }
      await loadMatchingHistories();
      const matches=matchingRows().length,soon=[...state.rows.values()].filter(r=>remaining(r)!==null&&remaining(r)>0&&remaining(r)<=3600).length;
      $('kabf-status').textContent=`Search complete: ${state.page} page${state.page===1?'':'s'} · ${state.rows.size} auctions indexed · ${matches} match${matches===1?'':'es'} · ${soon} ending within 1 hour.`;
      renderResults();$('kabf-results').classList.add('open');
    } catch(e){$('kabf-status').textContent='Full scan stopped: '+e.message;}
    finally{state.busy=false;state.scanningAll=false;$('kabf-assess').disabled=false;$('kabf-stop').style.display='none';renderResults();$('kabf-results')?.classList.add('open');}
  }

  function matchesSearch(r){const items=selectedValues('kabf-weapon-options'),choices=selectedValues('kabf-bonus-options');if(r.itemType!==state.activeMode)return false;const categoryMatch=state.activeMode==='armor'?armorTypeMatch(r.name):(state.weaponSlot==='all'||(state.weaponCatalogues[state.weaponSlot]||[]).includes(r.name)),choiceMatch=state.activeMode==='armor'?(!choices.length||choices.some(x=>(r.name||'').toLowerCase().includes(x.toLowerCase()))):(!choices.length||choices.some(x=>(r.bonuses||[]).some(b=>(b.title||b.name)===x)));return categoryMatch&&(!items.length||items.includes(r.name))&&choiceMatch;}
  function maxBonus(r){return Math.max(0,...(r.bonuses||[]).map(b=>number(b.value??b.percentage??b.percent)||0));}
  function combatStat(r){return r.itemType==='armor'?r.armor:r.damage;}
  function matchingRows(){const sort=$('kabf-result-sort')?.value||'end';return [...state.rows.values()].filter(matchesSearch).sort((a,b)=>sort==='bonus'?maxBonus(b)-maxBonus(a):sort==='damage'?(combatStat(b)??-Infinity)-(combatStat(a)??-Infinity):sort==='quality'?(b.quality??-Infinity)-(a.quality??-Infinity):(remaining(a)??Infinity)-(remaining(b)??Infinity));}
  function renderResults(){const list=$('kabf-results-list');if(!list)return;const openUids=new Set([...list.querySelectorAll('details[open]')].map(d=>d.closest('[data-result-uid]')?.dataset.resultUid).filter(Boolean)),rows=matchingRows();list.innerHTML=rows.length?rows.map(r=>{const rem=remaining(r),x=r.result,diff=x?.diff,endingSoon=rem!==null&&rem<=3600&&rem>0,deal=diff==null?(endingSoon?'Bargain check pending':'Load history for comparison'):`${Math.abs(diff).toFixed(1)}% ${diff<0?'below':'above'} historical median`;return `<article class="kabf-result ${diff<0?'good':''}" data-result-uid="${escapeHtml(r.uid)}"><a href="#" class="title" data-kabf-open="${escapeHtml(r.uid)}">${escapeHtml(r.name||'Loading weapon…')}</a><div class="meta">${escapeHtml((r.bonuses||[]).map(b=>(b.title||b.name)+(b.value!=null?' '+b.value+'%':'')).join(', ')||'Loading bonuses…')} · Page ${r.page}<br>${remainingText(rem)} · Current bid ${money(r.price)}</div><div class="${diff==null?'waiting':'deal'}">${x&&!x.exact?'<b style="color:#ff6b78">No exact comparisons</b><br>':''}${deal}${x?`<br>Median ${money(x.median)} · low ${money(x.low)} · high ${money(x.high)} · ${x.count} ${x.exact?'exact':'closest'} comparisons`:''}</div>${x?`<details ${openUids.has(r.uid)?'open':''}><summary>Comparable auction sales</summary><div class="kabf-sales">${salesHtml(x)||'No comparable sales found.'}</div></details>`:`<button class="kabf-history" data-kabf-history="${escapeHtml(r.uid)}">Load auction history</button>`}<button class="kabf-open" data-kabf-open="${escapeHtml(r.uid)}">Open auction card</button></article>`;}).join(''):'<div class="kabf-result">No indexed auctions match those weapon and bonus choices.</div>';}

  function updateStatus(){if(!$('kabf-status')||state.busy)return;const visible=[...state.rows.values()].filter(r=>r.li.isConnected).length;$('kabf-status').textContent=`${visible} visible weapon auction${visible===1?'':'s'} · ${state.assessed} assessed${state.errors?` · ${state.errors} error${state.errors===1?'':'s'}`:''}`;}
  function schedule(){clearTimeout(state.timer);state.timer=setTimeout(scrape,450);}
  injectStyle(); new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true}); window.addEventListener('hashchange',schedule); schedule();
})();
