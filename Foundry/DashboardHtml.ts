// The Foundry control-panel page (M9/M11). Self-contained HTML+CSS+JS served at "/". Left column
// drives a "Learn" run (settings + live SSE progress with a per-run progress bar + timestamped log);
// right column shows system info (CPU/GPU/backend/model), aggregate stats, and a per-repo accordion
// whose files open in a viewer modal on click. Learn settings persist in localStorage. Kept in its
// own file so Dashboard.ts stays small.

export const DashboardHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shahd — Data Foundry</title>
<style>
 :root{--bg:#0e1116;--panel:#161b22;--line:#262c36;--txt:#e6edf3;--mut:#8b949e;--blue:#388bfd;--green:#3fb950;--red:#f85149;--yellow:#d29922}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.5 system-ui,sans-serif}
 header{padding:14px 22px;background:var(--panel);border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:12px}
 header h1{margin:0;font-size:17px} header .m{color:var(--mut);font-size:12px} header a{margin-left:auto;color:var(--blue);text-decoration:none;font-size:13px}
 .wrap{display:grid;grid-template-columns:380px 1fr;gap:18px;padding:18px;max-width:1300px;margin:0 auto}
 @media(max-width:900px){.wrap{grid-template-columns:1fr}}
 .panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
 h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:0 0 12px}
 label{display:block;font-size:12px;color:var(--mut);margin:10px 0 3px}
 input,select{width:100%;background:#0d1117;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:7px 9px;font:inherit}
 .row{display:flex;gap:8px} .row>div{flex:1}
 .chk{display:flex;align-items:center;gap:8px;margin-top:12px} .chk input{width:auto}
 button{margin-top:14px;width:100%;background:var(--blue);color:#fff;border:0;border-radius:7px;padding:10px;font:600 14px system-ui;cursor:pointer}
 button:disabled{opacity:.5;cursor:not-allowed}
 .cards{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px}
 .card{background:#0d1117;border:1px solid var(--line);border-radius:8px;padding:11px 15px;min-width:96px}
 .card b{display:block;font-size:20px} .card span{color:var(--mut);font-size:11px}
 .chips{font-size:12px;color:var(--mut);margin:6px 0}
 .srow{display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-top:1px solid var(--line);font-size:12px} .srow:first-child{border-top:0} .srow span{color:var(--mut)} .srow b{font-weight:600;text-align:right;word-break:break-word}
 .pbar{height:8px;background:#0d1117;border:1px solid var(--line);border-radius:6px;overflow:hidden;margin-bottom:6px} .pfill{height:100%;width:0;background:var(--blue);transition:width .3s}
 .pstat{font-size:12px;color:var(--mut);margin-bottom:8px}
 .log{background:#0d1117;border:1px solid var(--line);border-radius:8px;padding:10px;height:210px;overflow:auto;font:12px ui-monospace,monospace}
 .log div{padding:1px 0;white-space:pre-wrap} .log .t{color:var(--mut)} .ok{color:var(--green)} .skip{color:var(--yellow)} .err{color:var(--red)}
 .acc{border:1px solid var(--line);border-radius:8px;margin-top:8px;overflow:hidden}
 .acc>.h{display:flex;justify-content:space-between;padding:9px 13px;cursor:pointer;background:#0d1117}
 .acc>.h:hover{background:#11161d} .acc .h .r{color:var(--mut);font-size:12px}
 .acc>.b{display:none;border-top:1px solid var(--line);max-height:340px;overflow:auto} .acc.open>.b{display:block}
 .acc .b table{width:100%;border-collapse:collapse} .acc .b tr{cursor:pointer} .acc .b tr:hover td{background:#11161d}
 .acc .b td{padding:4px 13px;border-top:1px solid var(--line);font:12px ui-monospace,monospace}
 .acc .b td.mut{color:var(--mut);text-align:right;white-space:nowrap}
 .lvl-high{color:var(--green)} .lvl-medium{color:var(--yellow)} .lvl-low{color:var(--red)}
 .tier-Filtered{color:var(--green)} .tier-Raw{color:var(--yellow)} .tier-Rejected{color:var(--red)}
 .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.62);align-items:center;justify-content:center;z-index:50;padding:20px}
 .mcard{background:var(--panel);border:1px solid var(--line);border-radius:10px;width:min(940px,94vw);max-height:88vh;display:flex;flex-direction:column}
 .mhead{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)} .mhead b{word-break:break-all;font:13px ui-monospace,monospace}
 .mx{cursor:pointer;color:var(--mut);font-size:18px;line-height:1} .mx:hover{color:var(--txt)}
 .mmeta{padding:6px 16px;color:var(--mut);font-size:11px;border-bottom:1px solid var(--line);word-break:break-all}
 .mbody{margin:0;padding:14px 16px;overflow:auto;font:12px ui-monospace,monospace;white-space:pre;tab-size:2;color:var(--txt)}
</style></head><body>
<header><h1>Shahd — Data Foundry</h1><span class="m">learn from whole repos · tiered · inspectable</span><a href="/chat">Chat with the model →</a></header>
<div class="wrap">
 <div>
  <div class="panel">
   <h2>Learn</h2>
   <label>Source</label>
   <select id="source"><option value="github">Public GitHub repos</option><option value="local">Our own repos (local)</option><option value="both">Both</option></select>
   <div id="ghbox"><label>GitHub query</label><input id="query" value="language:typescript stars:>1000"></div>
   <div id="localbox" style="display:none"><label>Local repo paths (comma-separated)</label><input id="repos" value="."></div>
   <div class="row"><div><label>Min level</label><select id="minlevel"><option>medium</option><option>high</option><option>low</option></select></div><div><label>Max repos</label><input id="maxrepos" type="number" value="5"></div></div>
   <div class="row"><div><label>Max files/repo</label><input id="maxfiles" type="number" value="2000"></div><div><label>Max MB/repo</label><input id="maxmb" type="number" value="32"></div><div><label>Max KB/file</label><input id="maxkb" type="number" value="512"></div></div>
   <div class="chk"><input type="checkbox" id="skip" checked><label style="margin:0">Skip repos already learned</label></div>
   <button id="go" onclick="learn()">▶ Learn</button>
  </div>
  <div class="panel" style="margin-top:16px"><h2>Progress</h2>
   <div class="pbar"><div class="pfill" id="pfill"></div></div>
   <div class="pstat" id="pstat">idle — configure and press Learn.</div>
   <div class="log" id="log"></div>
  </div>
 </div>
 <div>
  <div class="panel"><h2>System</h2><div id="sys" class="chips">loading…</div></div>
  <div class="panel" style="margin-top:16px"><h2>Foundry stats</h2><div class="cards" id="cards"></div><div class="chips" id="langs"></div><div class="chips" id="lics"></div></div>
  <div class="panel" style="margin-top:16px"><h2>Learned repos <span style="text-transform:none;color:var(--mut)">— click a file to view it</span></h2><div id="repos-list"></div></div>
 </div>
</div>
<div class="modal" id="modal" onclick="if(event.target===this)closeModal()">
 <div class="mcard"><div class="mhead"><b id="mtitle"></b><span class="mx" onclick="closeModal()">✕</span></div><div class="mmeta" id="mmeta"></div><pre class="mbody" id="mbody"></pre></div>
</div>
<script>
 const H=(s)=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const fmtB=(n)=>n>=1e6?(n/1e6).toFixed(1)+'MB':n>=1e3?(n/1e3).toFixed(0)+'KB':n+'B';
 const Q=(id)=>document.getElementById(id);
 Q('source').onchange=(e)=>{const v=e.target.value;Q('ghbox').style.display=v==='local'?'none':'';Q('localbox').style.display=v==='github'?'none':'';};
 const FIELDS=['source','query','repos','minlevel','maxrepos','maxfiles','maxmb','maxkb','skip'];
 function saveSettings(){const o={};FIELDS.forEach(id=>{const el=Q(id);o[id]=el.type==='checkbox'?el.checked:el.value;});try{localStorage.setItem('shahd.learn',JSON.stringify(o));}catch(e){}}
 function restoreSettings(){try{const o=JSON.parse(localStorage.getItem('shahd.learn')||'{}');FIELDS.forEach(id=>{if(o[id]===undefined)return;const el=Q(id);if(el.type==='checkbox')el.checked=!!o[id];else el.value=o[id];});Q('source').dispatchEvent(new Event('change'));}catch(e){}}
 async function loadSystem(){
  try{const s=await (await fetch('/api/system')).json();
   const gpu=(s.gpu&&s.gpu!=='none detected')?s.gpu:'none';
   const r=(k,v)=>'<div class="srow"><span>'+k+'</span><b>'+v+'</b></div>';
   Q('sys').innerHTML=
    r('Compute',s.gpuUsed?'GPU':'CPU · '+H(s.computeBackend))+
    r('CPU',H(s.cpuModel)+' × '+s.cpuCount)+
    r('Memory',s.memGb+' GB')+
    r('GPU',H(gpu)+(gpu==='none'||s.gpuUsed?'':' · detected, not used yet'))+
    r('Go FFI kernels',s.goFfiAvailable?'available':'TS fallback')+
    r('Model',(s.modelParams).toLocaleString()+' params · '+H(s.modelConfig))+
    r('Runtime',H(s.runtime)+' · '+H(s.platform)+'/'+H(s.arch));
  }catch(e){Q('sys').textContent='system info unavailable';}
 }
 async function loadStats(){
  const s=await (await fetch('/api/stats')).json();
  Q('cards').innerHTML=
   '<div class="card"><b>'+s.Total+'</b><span>documents</span></div>'+
   '<div class="card"><b class="tier-Filtered">'+s.ByTier.Filtered+'</b><span>trainable</span></div>'+
   '<div class="card"><b class="tier-Raw">'+s.ByTier.Raw+'</b><span>raw</span></div>'+
   '<div class="card"><b class="tier-Rejected">'+s.ByTier.Rejected+'</b><span>rejected</span></div>'+
   '<div class="card"><b>'+fmtB(s.FilteredBytes)+'</b><span>trainable bytes</span></div>';
  const kv=(o)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,14).map(([k,v])=>H(k)+':'+v).join(' · ');
  Q('langs').innerHTML='<b>langs</b> '+kv(s.ByLang);
  Q('lics').innerHTML='<b>licenses</b> '+kv(s.ByLicense);
 }
 async function loadRepos(){
  const r=await (await fetch('/api/repos')).json();
  Q('repos-list').innerHTML=r.length?r.map(x=>
   '<div class="acc"><div class="h" onclick="openRepo(this,'+JSON.stringify(H(x.Source)).replace(/"/g,'&quot;')+')"><span>'+H(x.Source)+'</span><span class="r">'+x.Files+' files · '+fmtB(x.Bytes)+'</span></div><div class="b"></div></div>'
  ).join(''):'<div style="color:var(--mut)">nothing learned yet.</div>';
 }
 async function openRepo(h,src){
  const acc=h.parentElement,body=acc.querySelector('.b');
  if(acc.classList.contains('open')){acc.classList.remove('open');return;}
  acc.classList.add('open');
  if(body.dataset.loaded)return; body.dataset.loaded='1';
  const d=await (await fetch('/api/documents?source='+encodeURIComponent(src)+'&limit=2000')).json();
  body.innerHTML='<table>'+d.map(f=>'<tr onclick="openFile('+JSON.stringify(f.id).replace(/"/g,'&quot;')+','+JSON.stringify(H(f.path||f.provenance)).replace(/"/g,'&quot;')+')"><td class="tier-'+f.tier+'">'+H(f.path||f.provenance)+'</td><td class="mut">'+H(f.lang)+' · '+fmtB(f.bytes)+'</td></tr>').join('')+'</table>';
 }
 async function openFile(id,path){
  const m=Q('modal');Q('mtitle').textContent=path;Q('mmeta').textContent='';Q('mbody').textContent='loading…';m.style.display='flex';
  try{const f=await (await fetch('/api/file?id='+encodeURIComponent(id))).json();
   if(f.error){Q('mbody').textContent='error: '+f.error;return;}
   Q('mmeta').textContent=[f.lang,f.tier,f.origin,f.license,fmtB(f.bytes),f.provenance].join(' · ');
   Q('mbody').textContent=f.content;
  }catch(e){Q('mbody').textContent='failed to load file';}
 }
 function closeModal(){Q('modal').style.display='none';}
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
 function setBar(frac,text){Q('pfill').style.width=Math.max(0,Math.min(1,frac))*100+'%';Q('pstat').textContent=text;}
 function learn(){
  saveSettings();
  const go=Q('go');go.disabled=true;
  const log=Q('log');log.innerHTML='';setBar(0,'starting…');
  const ts=()=>new Date().toTimeString().slice(0,8);
  const line=(t,c)=>{const d=document.createElement('div');if(c)d.className=c;d.innerHTML='<span class="t">'+ts()+'</span>  '+H(t);log.appendChild(d);log.scrollTop=log.scrollHeight;};
  const maxRepos=+Q('maxrepos').value||1;
  const body={Source:Q('source').value,Query:Q('query').value,Repos:Q('repos').value.split(',').map(s=>s.trim()).filter(Boolean),MinLevel:Q('minlevel').value,MaxRepos:maxRepos,MaxFilesPerRepo:+Q('maxfiles').value,MaxBytesPerRepo:(+Q('maxmb').value)*1e6,MaxContentBytes:(+Q('maxkb').value)*1e3,SkipLearned:Q('skip').checked};
  let seen=0,ingested=0,files=0,bytes=0;
  fetch('/api/learn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).then(res=>{
   if(res.error){line('error: '+res.error,'err');setBar(0,'error');go.disabled=false;return;}
   const es=new EventSource('/api/learn/stream');
   es.onmessage=(m)=>{const e=JSON.parse(m.data);
    if(e.kind==='start'){line('▶ learning from '+e.source+' ('+(e.query||'own repos')+')');setBar(.02,'0 / '+maxRepos+' repos');}
    else if(e.kind==='repo'){seen++;if(e.ingested){ingested++;files+=e.files;bytes+=e.bytes;}
     line((e.ingested?'✓ ':'· ')+e.repo+'  ['+e.level+', '+e.files+' files, '+fmtB(e.bytes)+']'+(e.ingested?' INGESTED':' skipped'+(e.reason?' ('+e.reason+')':'')),e.ingested?'ok':'skip');
     setBar(seen/maxRepos,seen+' / '+maxRepos+' repos · '+ingested+' ingested · '+files+' files · '+fmtB(bytes));}
    else if(e.kind==='done'){setBar(1,'done · '+ingested+' repos · '+e.ingested+' files ingested · '+fmtB(bytes));line('done — '+e.ingested+' files ingested from '+ingested+' repos','ok');es.close();go.disabled=false;loadStats();loadRepos();}
    else if(e.kind==='error'){line('error: '+e.message,'err');setBar(seen/maxRepos,'error');es.close();go.disabled=false;}
   };
   es.onerror=()=>{es.close();go.disabled=false;};
  });
 }
 restoreSettings();loadSystem();loadStats();loadRepos();
</script></body></html>`;
