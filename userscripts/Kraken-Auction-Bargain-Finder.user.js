// ==UserScript==
// @name         Kraken Auction Bargain Finder
// @namespace    https://github.com/JaySquire22
// @version      0.1.0
// @description  Adds ranked-weapon bargain assessment, filters and sorting to Torn's Auction House in Torn PDA.
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
  const PANEL_SELECTOR = '.tabContent[data-itemtype="weapons"]';
  const ROW_SELECTOR = 'div.items-list-wrap > ul.items-list > li';
  const BONUS_IDS = {Achilles:50,Assassinate:72,Backstab:52,Berserk:54,Bleed:57,Blindfire:33,Blindside:51,Bloodlust:85,Comeback:67,Conserve:55,Cripple:45,Crusher:49,Cupid:47,Deadeye:63,Deadly:62,Demoralize:36,Disarm:86,'Double Tap':105,'Double-edged':74,Empower:87,Eviscerate:56,Execute:75,Expose:1,Finale:82,Focus:79,Freeze:38,Frenzy:80,Fury:64,Grace:53,Hazardous:34,'Home run':83,Irradiate:102,Lacerate:89,Motivation:61,Paralyze:59,Parry:84,Penetrate:101,Plunder:21,Powerful:68,Proficience:14,Puncture:66,Quicken:88,Rage:65,Revitalize:41,Roshambo:43,Shock:120,Slow:44,Smash:104,Smurf:73,Specialist:71,Spray:35,Storage:37,Stricken:20,Stun:58,Suppress:60,'Sure Shot':78,Throttle:48,Toxin:103,Warlord:81,Weaken:46,'Wind-up':76,Wither:42};

  const state = { rows: new Map(), busy: false, timer: null, assessed: 0, errors: 0 };
  const $ = (id) => document.getElementById(id);
  const money = (n) => Number.isFinite(n) ? '$' + Math.round(n).toLocaleString() : '—';
  const number = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null; };
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
      li[data-kabf]{position:relative} .kabf-badge{margin:7px 8px;padding:7px 9px;border-radius:8px;background:#1c2636;border-left:4px solid #718096;font:12px/1.35 Arial,sans-serif;color:#eaf0f8}
      .kabf-good{border-left-color:#3bc98b;color:#86efc0}.kabf-bad{border-left-color:#e55262;color:#ff9ba6}.kabf-wait{border-left-color:#e7b24a;color:#f4d284}
      li.kabf-hidden{display:none!important} li.kabf-best{box-shadow:inset 4px 0 #3bc98b}
    `; document.head.appendChild(style);
  }

  function makePanel(panel) {
    if ($('kabf')) return;
    const box=document.createElement('details'); box.id='kabf'; box.open=true;
    box.innerHTML=`<summary>🐙 Kraken Auction Bargain Finder</summary><div class="body">
      <label>Minimum saving<input id="kabf-saving" type="number" inputmode="decimal" value="0" placeholder="% below median"></label>
      <label>Maximum current bid<input id="kabf-max" type="number" inputmode="numeric" placeholder="Any price"></label>
      <label>Weapon<input id="kabf-weapon" placeholder="All weapons"></label>
      <label>Bonus<select id="kabf-bonus"><option value="">All bonuses</option>${Object.keys(BONUS_IDS).sort().map(x=>`<option>${x}</option>`).join('')}</select></label>
      <label>Minimum damage<input id="kabf-damage" type="number" inputmode="decimal" placeholder="Any"></label>
      <label>Minimum accuracy<input id="kabf-accuracy" type="number" inputmode="decimal" placeholder="Any"></label>
      <label class="wide">Sort<select id="kabf-sort"><option value="saving">Biggest saving first</option><option value="quality">Closest-quality evidence first</option><option value="price">Lowest current bid</option><option value="ending">Torn's current order</option></select></label>
      <button class="wide" id="kabf-assess">Assess visible auctions</button>
    </div><div id="kabf-status">Waiting for weapon auctions…</div>`;
    const list=panel.querySelector('div.items-list-wrap'); panel.insertBefore(box,list||panel.firstChild);
    ['kabf-saving','kabf-max','kabf-weapon','kabf-bonus','kabf-damage','kabf-accuracy','kabf-sort'].forEach(id=>$(id).addEventListener(id==='kabf-sort'||id==='kabf-bonus'?'change':'input',applyFilters));
    $('kabf-assess').addEventListener('click', assessVisible);
  }

  function parsePrice(li) {
    const candidates=['.price-wrap','.price','.bid-wrap','.current-bid','.amount'];
    for (const sel of candidates) { const el=li.querySelector(sel); const matches=el&&el.textContent.match(/\$\s*([\d,]+)/g); if(matches?.length){const values=matches.map(number).filter(Number.isFinite); if(values.length)return Math.max(...values);} }
    const matches=li.textContent.match(/\$\s*([\d,]+)/g)||[]; return matches.length ? Math.max(...matches.map(number).filter(Number.isFinite)) : null;
  }

  function scrape() {
    const panel=document.querySelector(PANEL_SELECTOR); if(!panel)return;
    makePanel(panel);
    panel.querySelectorAll(ROW_SELECTOR).forEach((li,index)=>{
      const hover=li.querySelector('span.item-hover');
      const uid=hover?.getAttribute('armoury'); const itemId=number(hover?.getAttribute('item'));
      if(!uid||!itemId)return;
      const old=state.rows.get(uid)||{};
      state.rows.set(uid,{...old,uid,itemId,li,price:parsePrice(li),originalIndex:index});
      li.dataset.kabf=uid;
    });
    updateStatus();
  }

  async function pdaGet(url,headers={}) { const r=await PDA_httpGet(url,headers); if(Number(r.status)>=400)throw new Error(`Torn API HTTP ${r.status}`); return JSON.parse(r.responseText); }
  async function pdaPost(url,headers,body) { const r=await PDA_httpPost(url,headers,body); if(Number(r.status)>=400)throw new Error(`History HTTP ${r.status}: ${(r.responseText||'').slice(0,100)}`); return JSON.parse(r.responseText); }

  async function enrich(rows) {
    for(let i=0;i<rows.length;i+=25){
      const batch=rows.slice(i,i+25), uids=batch.map(x=>x.uid).join(',');
      const data=await pdaGet(`https://api.torn.com/v2/torn/${uids}/itemdetails?key=${encodeURIComponent(API_KEY)}&comment=KrakenAuctionFinder`);
      const details=Array.isArray(data.itemdetails)?data.itemdetails:Object.values(data.itemdetails||{});
      details.forEach(d=>{const r=state.rows.get(String(d.uid??d.UID)); if(!r)return; const stats=d.stats||{}; Object.assign(r,{name:d.name||'Unknown',type:d.type||'',rarity:d.rarity||'',bonuses:Array.isArray(d.bonuses)?d.bonuses:Object.values(d.bonuses||{}),damage:number(stats.damage??d.damage),accuracy:number(stats.accuracy??d.accuracy),quality:number(d.quality??d.stat_quality??stats.quality)});});
    }
  }

  function requestBody(r) {
    const body={limit:50,offset:0,sort_by:'timestamp',sort_order:'desc',item_name:r.name};
    (r.bonuses||[]).slice(0,2).forEach((b,i)=>{const p=i+1,title=b.title||b.name||'',id=b.id||BONUS_IDS[title],value=number(b.value??b.percentage??b.percent); if(!id)return; body[`bonus${p}_ids`]=[Number(id)]; if(value!==null){const m=Math.abs(value)*.1;body[`bonus${p}_id`]=Number(id);body[`bonus${p}_value_min`]=Math.max(0,Math.round((value-m)*100)/100);body[`bonus${p}_value_max`]=Math.round((value+m)*100)/100;}});
    return body;
  }

  function comparableSales(r,data) {
    const sales=(data.auctions||[]).filter(x=>number(x.price)>0).map(x=>({...x,_price:number(x.price),_quality:number(x.stat_quality??x.quality)}));
    sales.sort((a,b)=>{const aq=r.quality!==null&&a._quality!==null?Math.abs(a._quality-r.quality):9999,bq=r.quality!==null&&b._quality!==null?Math.abs(b._quality-r.quality):9999;return aq-bq;});
    return sales.slice(0,20);
  }

  function cacheKey(r){return 'kabf:'+r.name+':'+(r.bonuses||[]).slice(0,2).map(b=>`${b.title||b.name}:${b.value??''}`).join('|');}
  async function history(r) {
    const key=cacheKey(r); try{const c=JSON.parse(localStorage.getItem(key)||'null');if(c&&Date.now()-c.at<CACHE_MS)return c.data;}catch(_){ }
    const data=await pdaPost(HISTORY_URL,{'Content-Type':'application/json',apikey:HISTORY_KEY,Authorization:'Bearer '+HISTORY_KEY},JSON.stringify(requestBody(r)));
    localStorage.setItem(key,JSON.stringify({at:Date.now(),data})); return data;
  }

  function renderBadge(r) {
    let badge=r.li.querySelector('.kabf-badge'); if(!badge){badge=document.createElement('div');badge.className='kabf-badge';r.li.appendChild(badge);}
    if(r.error){badge.className='kabf-badge kabf-bad';badge.textContent=r.error;return;}
    if(!r.result){badge.className='kabf-badge kabf-wait';badge.textContent='Ready for bargain assessment';return;}
    const x=r.result, good=x.diff<0; badge.className='kabf-badge '+(good?'kabf-good':'kabf-bad');
    badge.innerHTML=`<b>${x.diff===null?'No estimate':`${Math.abs(x.diff).toFixed(1)}% ${good?'below':'above'} median`}</b> · median ${money(x.median)}<br>${escapeHtml(r.name)} · ${escapeHtml((r.bonuses||[]).map(b=>(b.title||b.name)+(b.value!=null?' '+b.value+'%':'')).join(', '))}<br>DMG ${r.damage??'?'} · ACC ${r.accuracy??'?'} · Quality ${r.quality??'?'}% · ${x.count} closest comparable sale${x.count===1?'':'s'}${x.qualityGap!==null?` · closest quality gap ${x.qualityGap.toFixed(1)}%`:''}`;
    r.li.classList.toggle('kabf-best',x.diff<=-10);
  }

  async function assessVisible() {
    if(state.busy)return; state.busy=true; state.assessed=0; state.errors=0; $('kabf-assess').disabled=true;
    try{
      scrape(); const rows=[...state.rows.values()].filter(r=>r.li.isConnected);
      await enrich(rows);
      for(let i=0;i<rows.length;i++){
        const r=rows[i]; $('kabf-status').textContent=`Assessing ${i+1} of ${rows.length}: ${r.name||'weapon'}…`;
        try{const data=await history(r),sales=comparableSales(r,data),prices=sales.map(x=>x._price),med=median(prices),closest=sales.find(x=>r.quality!==null&&x._quality!==null);r.result={median:med,count:sales.length,diff:med&&r.price!==null?((r.price-med)*100/med):null,qualityGap:closest?Math.abs(closest._quality-r.quality):null};r.error=null;state.assessed++;}
        catch(e){r.error='Assessment unavailable: '+e.message;state.errors++;}
        renderBadge(r); await new Promise(resolve=>setTimeout(resolve,120));
      }
      applyFilters();
    } catch(e){$('kabf-status').textContent='Could not read auction details: '+e.message;}
    finally{state.busy=false;$('kabf-assess').disabled=false;updateStatus();}
  }

  function applyFilters() {
    const min=number($('kabf-saving')?.value)||0,max=number($('kabf-max')?.value),weapon=($('kabf-weapon')?.value||'').toLowerCase(),bonus=$('kabf-bonus')?.value||'',dmg=number($('kabf-damage')?.value),acc=number($('kabf-accuracy')?.value),sort=$('kabf-sort')?.value;
    const rows=[...state.rows.values()].filter(r=>r.li.isConnected);
    rows.forEach(r=>{const saving=r.result?.diff==null?null:-r.result.diff,visible=(!weapon||(r.name||'').toLowerCase().includes(weapon))&&(!bonus||(r.bonuses||[]).some(b=>(b.title||b.name)===bonus))&&(max===null||r.price<=max)&&(dmg===null||r.damage>=dmg)&&(acc===null||r.accuracy>=acc)&&(min<=0||saving>=min);r.li.classList.toggle('kabf-hidden',!visible);});
    if(sort!=='ending'){const list=rows[0]?.li.parentElement;if(list){rows.sort((a,b)=>sort==='price'?(a.price??Infinity)-(b.price??Infinity):sort==='quality'?(a.result?.qualityGap??Infinity)-(b.result?.qualityGap??Infinity):(a.result?.diff??Infinity)-(b.result?.diff??Infinity));rows.forEach(r=>list.appendChild(r.li));}}
  }

  function updateStatus(){if(!$('kabf-status')||state.busy)return;const visible=[...state.rows.values()].filter(r=>r.li.isConnected).length;$('kabf-status').textContent=`${visible} visible weapon auction${visible===1?'':'s'} · ${state.assessed} assessed${state.errors?` · ${state.errors} error${state.errors===1?'':'s'}`:''}`;}
  function schedule(){clearTimeout(state.timer);state.timer=setTimeout(scrape,450);}
  injectStyle(); new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true}); window.addEventListener('hashchange',schedule); schedule();
})();
