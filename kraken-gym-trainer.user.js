// ==UserScript==
// @name         Kraken Gym Trainer
// @namespace    https://github.com/JaySquire22
// @version      1.0.1
// @description  Steadfast, specialist-gym training limits and drug battle-stat estimates
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @downloadURL  https://raw.githubusercontent.com/JaySquire22/Torn-war-room/main/kraken-gym-trainer.user.js
// @updateURL    https://raw.githubusercontent.com/JaySquire22/Torn-war-room/main/kraken-gym-trainer.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.torn.com
// @run-at       document-end
// ==/UserScript==

(() => {
  'use strict';
  if (!/\/gym\.php(?:$|[?#])/i.test(location.pathname + location.search)) return;
  if (document.getElementById('kgt')) return;
  const NAMES = ['strength', 'defense', 'speed', 'dexterity'];
  const LABEL = {strength:'Strength', defense:'Defense', speed:'Speed', dexterity:'Dexterity'};
  const get = (k, fallback) => typeof GM_getValue === 'function' ? GM_getValue(k, fallback) : localStorage.getItem(k) ?? fallback;
  const set = (k, value) => typeof GM_setValue === 'function' ? GM_setValue(k, value) : localStorage.setItem(k, value);
  const num = x => typeof x === 'number' ? x : Number(String(x ?? '').replace(/,/g, ''));
  const fmt = x => !Number.isFinite(x) ? '—' : x >= 1e12 ? (x / 1e12).toFixed(2) + 't' : x >= 1e9 ? (x / 1e9).toFixed(2) + 'b' : x >= 1e6 ? (x / 1e6).toFixed(2) + 'm' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'k' : Math.floor(x).toLocaleString();
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let last = null, busy = false, refreshTimer = null;
  const style = document.createElement('style');
  style.textContent = `#kgt{box-sizing:border-box;background:#171d26;color:#f0f3f8;border:1px solid #35536c;border-radius:10px;padding:14px;margin:12px auto;max-width:1000px;font:13px/1.45 Arial,sans-serif}#kgt *{box-sizing:border-box}#kgt h3{margin:0 0 10px;color:#81d7eb;font-size:17px}#kgt h4{margin:14px 0 5px;font-size:13px;color:#81d7eb}#kgt .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}#kgt table{width:100%;border-collapse:collapse}#kgt td,#kgt th{padding:4px 3px;text-align:right;border-bottom:1px solid #33404a}#kgt td:first-child,#kgt th:first-child{text-align:left}#kgt .good{color:#7fe09a}#kgt .bad{color:#ff8179}#kgt .warn{color:#ffc36b}#kgt small{color:#a9b4c1}#kgt button{padding:5px 9px;margin:2px;border:1px solid #5d8298;background:#24384a;color:white;border-radius:5px;cursor:pointer}#kgt input{padding:5px;background:#101821;color:white;border:1px solid #668295;border-radius:4px}#kgt .status{margin-top:8px}#kgt .scroll{overflow:auto}#kgt .head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}`;
  (document.head || document.documentElement).appendChild(style);
  const panel = document.createElement('section'); panel.id = 'kgt';
  panel.innerHTML = `<div class="head"><h3>🐙 Kraken Gym Trainer</h3><div><button type="button" data-action="refresh">Refresh</button><button type="button" data-action="settings">Settings</button></div></div><div id="kgt-body">Enter your Torn API key in Settings to start.</div><div class="status" id="kgt-status"></div>`;
  const mount = () => {
    if (!document.body) return;
    if (!panel.isConnected) {
      document.body.prepend(panel);
    }
  };
  mount(); new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});
  const body = () => panel.querySelector('#kgt-body');
  const status = (s, cls='') => {const e=panel.querySelector('#kgt-status'); e.className='status '+cls;e.textContent=s;};
  function request(url) {return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'GET',url,timeout:15000,onload:r=>{try{const d=JSON.parse(r.responseText);if(d.error) reject(new Error(d.error.error || 'API error'));else if(r.status!==200) reject(new Error('HTTP '+r.status));else resolve(d);}catch(e){reject(e)}},onerror:()=>reject(new Error('Network error')),ontimeout:()=>reject(new Error('API timed out'))}));}
  function limits(s, buffer) {
    // All inequalities must stay true. Limits assume only ONE stat increases.
    const ratio = 1.25 + buffer / 100;
    const frontline = s.strength+s.speed-ratio*(s.defense+s.dexterity);
    const iso = Math.min(...['strength','speed','dexterity'].map(k=>s.defense-ratio*s[k]));
    const ok = frontline >= 0 && iso >= 0;
    const out = {};
    for(const k of NAMES) {
      if(!ok){out[k]={value:0, reason:'Restore both gym requirements first'};continue;}
      const caps=[];
      if(k==='defense'||k==='dexterity') caps.push({value:frontline/ratio,reason:'Frontline Fitness'});
      if(k!=='defense') caps.push({value:s.defense/ratio-s[k],reason:'Mr. Isoyama’s'});
      caps.sort((a,b)=>a.value-b.value); out[k]=caps[0] || {value:Infinity,reason:'Neither gym has an upper limit'};
      out[k].value=Math.max(0,out[k].value);
    }
    return {out,frontline,iso,ok};
  }
  function steadfast(perks) {
    const result={};
    for(const name of NAMES){
      const entries=(perks.faction_perks||[]).filter(p=>/steadfast/i.test(String(p)) && new RegExp(name,'i').test(String(p)));
      const numbers=entries.map(p=>String(p).match(/(?:\+\s*)?(\d+(?:\.\d+)?)\s*%/)).filter(Boolean).map(m=>Number(m[1]));
      result[name]=numbers.length ? Math.max(...numbers)+'%' : entries.length ? 'Active (rate unknown)' : '—';
    }
    return result;
  }
  function render(data){
    const {s,perks}=data, total=NAMES.reduce((a,k)=>a+s[k],0), buffer=Math.max(0,Math.min(10,num(get('kgt_buffer','1'))||0));
    const {out,frontline,iso,ok}=limits(s,buffer), fRatio=(s.strength+s.speed)/(s.defense+s.dexterity), isoRatio=s.defense/Math.max(s.strength,s.speed,s.dexterity), sf=steadfast(perks);
    const line=(value,ratio)=>`<span class="${value>=0?'good':'bad'}">${value>=0?'✓ Eligible by stats':'✕ Below requirement'}</span> · ratio ${(ratio*100).toFixed(2)}% (needs 125%)`;
    body().innerHTML=`<div class="grid"><div><h4>Raw battle stats</h4><table><tr><th>Stat</th><th>Raw</th><th>Share</th><th>Steadfast</th></tr>${NAMES.map(k=>`<tr><td>${LABEL[k]}</td><td>${fmt(s[k])}</td><td>${(100*s[k]/total).toFixed(2)}%</td><td>${escape(sf[k])}</td></tr>`).join('')}<tr><th>Total</th><th>${fmt(total)}</th><th>100%</th><th></th></tr></table></div><div><h4>Specialist gyms</h4><div>Frontline Fitness: ${line(frontline,fRatio)}</div><div>Mr. Isoyama’s: ${line(iso,isoRatio)}</div><small>Eligibility by raw stats only; membership and gym unlocks are not checked.</small><h4>Safe extra gains in one stat</h4><table>${NAMES.map(k=>`<tr><td>${LABEL[k]}</td><td class="${!ok||out[k].value<=0?'bad':out[k].value<total*.01?'warn':'good'}">${!ok?'0':fmt(out[k].value)}</td><td><small>${escape(out[k].reason)}</small></td></tr>`).join('')}</table><small>One stat at a time, using a ${buffer}% extra margin above each 25% requirement. These are stat gains, not energy or train counts. Refresh after every train.</small></div></div><h4>⚔️ Combat stat scenarios (estimates)</h4><div class="scroll"><table><tr><th>Stat</th><th>Raw baseline</th><th>Xanax −35%</th><th>Loss</th><th>Vicodin +25%</th></tr>${NAMES.map(k=>`<tr><td>${LABEL[k]}</td><td>${fmt(s[k])}</td><td>${fmt(s[k]*.65)}</td><td class="bad">▼ ${fmt(s[k]*.35)}</td><td>${fmt(s[k]*1.25)}</td></tr>`).join('')}<tr><th>Total</th><th>${fmt(total)}</th><th>${fmt(total*.65)}</th><th class="bad">▼ ${fmt(total*.35)}</th><th>${fmt(total*1.25)}</th></tr></table></div><small>Drug-only estimates from raw stats. Passive bonuses, addiction, other effects and Torn’s stacking rules may change actual effective combat stats; these figures are not an in-game effective-stat readout. Xanax leaves 65% of this baseline, Vicodin 125%.</small>`;
    status('Updated '+new Date().toLocaleTimeString()+'. Refresh after training.');
  }
  async function refresh(){
    const key=String(get('kgt_api_key','')).trim();if(!key){settings();return;}if(busy)return;
    busy=true;status('Loading battle stats and perks…');
    try{
      const url='https://api.torn.com/user/?selections=battlestats,perks&key='+encodeURIComponent(key)+'&comment=KrakenGymTrainer';
      const d=await request(url), s={};
      for(const k of NAMES){s[k]=num(d[k]);if(!Number.isFinite(s[k])||s[k]<0)throw new Error('API did not return valid '+k+' stats. Use a Limited or higher key.');}
      last={s,perks:d};render(last);
    }catch(e){status(e.message,'bad');if(!last)body().textContent='Could not load your stats. Check your API key in Settings.';}
    finally{busy=false;}
  }
  function settings(){body().innerHTML=`<h4>Settings</h4><label>API key <input id="kgt-key" type="password" autocomplete="off" placeholder="Limited or higher key" /></label><br><label>Extra safety margin <input id="kgt-buffer" type="number" min="0" max="10" step="0.1" style="width:60px" /> %</label><br><button data-action="save" type="button">Save and refresh</button><button data-action="delete" type="button">Forget key</button><p><small>The key stays in this userscript’s local storage and is sent only to api.torn.com. Never share it with anyone. The margin raises the required 125% ratio; it does not promise protection from an unexpectedly large single train.</small></p>`;panel.querySelector('#kgt-key').value=get('kgt_api_key','');panel.querySelector('#kgt-buffer').value=get('kgt_buffer','1');}
  panel.addEventListener('click',e=>{const a=e.target.closest('[data-action]')?.dataset.action;if(a==='refresh')refresh();if(a==='settings')settings();if(a==='save'){const key=panel.querySelector('#kgt-key').value.trim(),buffer=num(panel.querySelector('#kgt-buffer').value);if(!key||!Number.isFinite(buffer)||buffer<0||buffer>10){status('Enter a key and a margin from 0 to 10%.','bad');return;}set('kgt_api_key',key);set('kgt_buffer',String(buffer));refresh();}if(a==='delete'){set('kgt_api_key','');last=null;settings();status('Saved key removed.');}});
  // Gym training is handled by Torn's own page; refresh after a successful interaction.
  document.addEventListener('click',e=>{if(e.target.closest('#kgt'))return;if(!e.target.closest('button,[role="button"],input[type="submit"]'))return;clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(get('kgt_api_key',''))refresh();},3500);},true);
  if(get('kgt_api_key',''))refresh();else settings();
})();
