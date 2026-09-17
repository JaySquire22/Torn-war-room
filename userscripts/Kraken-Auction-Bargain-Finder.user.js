// ==UserScript==
// @name         Kraken Auction Bargain Finder
// @namespace    https://github.com/JaySquire22
// @version      0.4.0
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

  const state = { rows: new Map(), busy: false, scanningAll: false, stopRequested: false, timer: null, assessed: 0, errors: 0, page: 0 };
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
      #kabf-results{position:fixed;inset:5vh 3vw;z-index:2147483646;background:#0d131e;border:1px solid #46546d;border-radius:14px;color:#fff;box-shadow:0 12px 45px #000;display:none;flex-direction:column;overflow:hidden;font:13px/1.4 Arial,sans-serif}
      #kabf-results.open{display:flex} #kabf-results .head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#171f2e;font-weight:800} #kabf-results .head button{width:auto;min-height:34px;margin:0;padding:5px 12px}
      #kabf-results-list{padding:10px;overflow:auto;display:grid;gap:8px}.kabf-result{background:#171f2e;border:1px solid #344158;border-radius:10px;padding:10px}.kabf-result.good{border-left:4px solid #3bc98b}.kabf-result .title{font-weight:800;font-size:14px}.kabf-result .meta{color:#aab4c5;margin-top:3px}.kabf-result .deal{color:#86efc0;font-weight:800;margin-top:5px}.kabf-result .waiting{color:#f4d284;margin-top:5px}
      .kabf-open,.kabf-history{display:inline-block;width:auto!important;min-height:34px!important;margin:7px 6px 0 0!important;padding:6px 10px!important;background:#344158!important;color:#fff!important;border:0!important;border-radius:7px!important;text-decoration:none!important;font-weight:700!important}.kabf-history{background:#6e3343!important}.kabf-sales{margin-top:7px;padding-top:6px;border-top:1px solid #344158;color:#aab4c5}.kabf-sale{display:flex;justify-content:space-between;gap:10px;padding:3px 0}.kabf-highlight{animation:kabf-flash 1s 4;box-shadow:inset 0 0 0 3px #f3b644!important}@keyframes kabf-flash{50%{background:rgba(243,182,68,.24)}}
    `; document.head.appendChild(style);
  }

  function makePanel(panel) {
    if ($('kabf')) return;
    const box=document.createElement('details'); box.id='kabf'; box.open=true;
    box.innerHTML=`<summary>🐙 Kraken Auction Bargain Finder</summary><div class="body">
      <label>Weapon names<input id="kabf-weapon" placeholder="e.g. ArmaLite, Minigun"></label>
      <label>Bonus<select id="kabf-bonus"><option value="">All bonuses</option>${Object.keys(BONUS_IDS).sort().map(x=>`<option>${x}</option>`).join('')}</select></label>
      <button class="wide" id="kabf-assess">Search every auction page</button>
      <button class="wide" id="kabf-show">Show matching auctions</button>
      <button class="wide" id="kabf-stop" style="display:none;background:#4a5568">Stop after this page</button>
    </div><div id="kabf-status">Waiting for weapon auctions…</div>`;
    const list=panel.querySelector('div.items-list-wrap'); panel.insertBefore(box,list||panel.firstChild);
    ['kabf-weapon','kabf-bonus'].forEach(id=>$(id).addEventListener(id==='kabf-bonus'?'change':'input',renderResults));
    $('kabf-assess').addEventListener('click', assessVisible);
    $('kabf-show').addEventListener('click',()=>{renderResults();$('kabf-results').classList.add('open');});
    $('kabf-stop').addEventListener('click',()=>{state.stopRequested=true;$('kabf-status').textContent='Stopping after the current page…';});
    if(!$('kabf-results')){const results=document.createElement('section');results.id='kabf-results';results.innerHTML='<div class="head"><span>🐙 Matching Auction Weapons</span><button id="kabf-close">Close</button></div><div id="kabf-results-list"></div>';document.body.appendChild(results);$('kabf-close').addEventListener('click',()=>results.classList.remove('open'));$('kabf-results-list').addEventListener('click',async e=>{const open=e.target.closest('[data-kabf-open]'),historyButton=e.target.closest('[data-kabf-history]');if(open){e.preventDefault();await openAuctionCard(open.dataset.kabfOpen);}if(historyButton){e.preventDefault();const r=state.rows.get(historyButton.dataset.kabfHistory);if(r){historyButton.disabled=true;historyButton.textContent='Loading history…';await assessOne(r,true);renderResults();}}});}
  }

  function endTimeToEpoch(title){const m=String(title||'').match(/(\d{2}):(\d{2}):(\d{2})\s*-\s*(\d{2})\/(\d{2})\/(\d{2})/);if(!m)return null;return Math.floor(Date.UTC(2000+Number(m[6]),Number(m[5])-1,Number(m[4]),Number(m[1]),Number(m[2]),Number(m[3]))/1000);}
  function remaining(r){return r.endEpoch===null?null:r.endEpoch-Math.floor(Date.now()/1000);}
  function remainingText(seconds){if(seconds===null)return 'Unknown end time';if(seconds<=0)return 'Ended';const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;return h?`${h}h ${m}m remaining`:`${m}m ${s}s remaining`;}

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
      const old=state.rows.get(uid)||{},timeEl=li.querySelector('div.time-wrap span[title], [class*="time"] span[title], span[title*="Ends"]'),endEpoch=endTimeToEpoch(timeEl?.getAttribute('title'));
      const row={...old,uid,itemId,li,cardId:li.id||old.cardId||'',price:parsePrice(li),endEpoch,originalIndex:index,page:state.page||1};
      if(row.result?.median&&row.price!==null)row.result.diff=(row.price-row.result.median)*100/row.result.median;
      state.rows.set(uid,row);
      li.dataset.kabf=uid;
      if(row.name)renderBadge(row);
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

  function salesHtml(x){return (x.sales||[]).slice(0,5).map(s=>`<div class="kabf-sale"><span>Quality ${s._quality??'?'}%</span><b>${money(s._price)}</b></div>`).join('');}
  function renderBadge(r) {
    if(!r.li?.isConnected)return;
    let badge=r.li.querySelector('.kabf-badge'); if(!badge){badge=document.createElement('div');badge.className='kabf-badge';r.li.appendChild(badge);}
    if(r.error){badge.className='kabf-badge kabf-bad';badge.innerHTML=`${escapeHtml(r.error)}<br><button class="kabf-history">Retry history</button>`;badge.querySelector('button').onclick=()=>assessOne(r,true);return;}
    if(!r.result){badge.className='kabf-badge kabf-wait';badge.innerHTML=`Historical auction comparison available<br><button class="kabf-history">Load auction history</button>`;badge.querySelector('button').onclick=async()=>{badge.querySelector('button').disabled=true;badge.querySelector('button').textContent='Loading…';await assessOne(r,true);};return;}
    const x=r.result, good=x.diff<0; badge.className='kabf-badge '+(good?'kabf-good':'kabf-bad');
    const summary=remaining(r)!==null&&remaining(r)<=1800&&remaining(r)>0?`<b>${x.diff===null?'No estimate':`${Math.abs(x.diff).toFixed(1)}% ${good?'below':'above'} median`}</b> · `:'';
    badge.innerHTML=`${summary}median ${money(x.median)} · low ${money(x.low)} · high ${money(x.high)}<br>Quality ${r.quality??'?'}% · ${x.count} closest comparable sale${x.count===1?'':'s'}${x.qualityGap!==null?` · closest quality gap ${x.qualityGap.toFixed(1)}%`:''}<details><summary>Show recent comparable sales</summary><div class="kabf-sales">${salesHtml(x)||'No comparable sales found.'}</div></details>`;
    r.li.classList.toggle('kabf-best',x.diff<=-10);
  }

  async function assessOne(r,force=false){
    if(r.result&&!force){renderBadge(r);return r.result;}
    try{const data=await history(r),sales=comparableSales(r,data),prices=sales.map(x=>x._price),med=median(prices),closest=sales.find(x=>r.quality!==null&&x._quality!==null);r.result={median:med,low:prices.length?Math.min(...prices):null,high:prices.length?Math.max(...prices):null,count:sales.length,sales,diff:med&&r.price!==null?((r.price-med)*100/med):null,qualityGap:closest?Math.abs(closest._quality-r.quality):null};r.error=null;state.assessed++;}
    catch(e){r.error='Assessment unavailable: '+e.message;state.errors++;}
    renderBadge(r);renderResults();return r.result;
  }

  async function assessPage(rows) {
      await enrich(rows);
      rows.filter(matchesSearch).forEach(renderBadge);
      for(let i=0;i<rows.length;i++){
        const r=rows[i];
        if(!matchesSearch(r))continue;
        if(remaining(r)===null||remaining(r)>1800||remaining(r)<=0)continue;
        if(r.result&&!r.error){renderBadge(r);continue;}
        $('kabf-status').textContent=`Page ${state.page}: bargain-checking ${i+1} of ${rows.length} · ${state.assessed} ending soon…`;
        await assessOne(r);await new Promise(resolve=>setTimeout(resolve,120));
      }
      renderResults();
  }

  function currentRows(){return [...state.rows.values()].filter(r=>r.li.isConnected);}
  function pageFingerprint(){return currentRows().map(r=>r.uid).sort().join('|');}
  function pager(){return document.querySelector(`${PANEL_SELECTOR} div.pagination-wrap`);}
  function usable(a){return a&&a.offsetParent!==null&&!a.matches('.disabled,[aria-disabled="true"]');}
  function nextPageLink(){
    const p=pager();if(!p)return null;
    const direct=[...p.querySelectorAll('a')].find(a=>usable(a)&&(/next/i.test(`${a.className} ${a.title} ${a.getAttribute('aria-label')||''}`)||/^[›»>]$/.test(a.textContent.trim())));
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
      const matches=matchingRows().length,soon=[...state.rows.values()].filter(r=>remaining(r)!==null&&remaining(r)>0&&remaining(r)<=1800).length;
      $('kabf-status').textContent=`Search complete: ${state.page} page${state.page===1?'':'s'} · ${state.rows.size} auctions indexed · ${matches} match${matches===1?'':'es'} · ${soon} ending within 30 minutes.`;
      renderResults();$('kabf-results').classList.add('open');
    } catch(e){$('kabf-status').textContent='Full scan stopped: '+e.message;}
    finally{state.busy=false;state.scanningAll=false;$('kabf-assess').disabled=false;$('kabf-stop').style.display='none';renderResults();}
  }

  function matchesSearch(r){const terms=($('kabf-weapon')?.value||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),bonus=$('kabf-bonus')?.value||'';return (!terms.length||terms.some(x=>(r.name||'').toLowerCase().includes(x)))&&(!bonus||(r.bonuses||[]).some(b=>(b.title||b.name)===bonus));}
  function matchingRows(){return [...state.rows.values()].filter(matchesSearch).sort((a,b)=>(remaining(a)??Infinity)-(remaining(b)??Infinity));}
  function renderResults(){const list=$('kabf-results-list');if(!list)return;const rows=matchingRows();list.innerHTML=rows.length?rows.map(r=>{const rem=remaining(r),x=r.result,diff=x?.diff,endingSoon=rem!==null&&rem<=1800&&rem>0,deal=diff==null?(endingSoon?'Bargain check pending':'Load history for comparison'):`${Math.abs(diff).toFixed(1)}% ${diff<0?'below':'above'} historical median`;return `<article class="kabf-result ${diff<0?'good':''}"><a href="#" class="title" data-kabf-open="${escapeHtml(r.uid)}">${escapeHtml(r.name||'Loading weapon…')}</a><div class="meta">${escapeHtml((r.bonuses||[]).map(b=>(b.title||b.name)+(b.value!=null?' '+b.value+'%':'')).join(', ')||'Loading bonuses…')} · Page ${r.page}<br>${remainingText(rem)} · Current bid ${money(r.price)}</div><div class="${diff==null?'waiting':'deal'}">${deal}${x?`<br>Median ${money(x.median)} · low ${money(x.low)} · high ${money(x.high)} · ${x.count} comparisons`:''}</div>${x?`<details><summary>Comparable auction sales</summary><div class="kabf-sales">${salesHtml(x)||'No comparable sales found.'}</div></details>`:`<button class="kabf-history" data-kabf-history="${escapeHtml(r.uid)}">Load auction history</button>`}<button class="kabf-open" data-kabf-open="${escapeHtml(r.uid)}">Open auction card</button></article>`;}).join(''):'<div class="kabf-result">No indexed auctions match those weapon and bonus choices.</div>';}

  function updateStatus(){if(!$('kabf-status')||state.busy)return;const visible=[...state.rows.values()].filter(r=>r.li.isConnected).length;$('kabf-status').textContent=`${visible} visible weapon auction${visible===1?'':'s'} · ${state.assessed} assessed${state.errors?` · ${state.errors} error${state.errors===1?'':'s'}`:''}`;}
  function schedule(){clearTimeout(state.timer);state.timer=setTimeout(scrape,450);}
  injectStyle(); new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true}); window.addEventListener('hashchange',schedule); schedule();
})();
