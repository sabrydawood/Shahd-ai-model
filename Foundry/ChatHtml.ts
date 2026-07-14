// The "chat with the model" page (M12), served at "/chat". Talks to POST /api/chat (OpenAI-shaped)
// which runs the SAFE GuardedGenerate path over the loaded checkpoint. Deliberately HONEST in the
// banner: this is a tiny from-scratch character-level model trained on a small seed corpus, so its
// output is experimental and often incoherent until it is trained on the Foundry data. Own file so
// Dashboard.ts stays small.

export const ChatHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shahd — Chat</title>
<style>
 :root{--bg:#0e1116;--panel:#161b22;--line:#262c36;--txt:#e6edf3;--mut:#8b949e;--blue:#388bfd;--green:#3fb950;--red:#f85149;--yellow:#d29922}
 *{box-sizing:border-box} html,body{height:100%} body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 system-ui,sans-serif;display:flex;flex-direction:column}
 header{padding:14px 22px;background:var(--panel);border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:12px}
 header h1{margin:0;font-size:17px} header a{margin-left:auto;color:var(--blue);text-decoration:none;font-size:13px}
 .warn{background:#2d2410;border-bottom:1px solid #5a4611;color:var(--yellow);padding:9px 22px;font-size:12.5px}
 .chat{flex:1;overflow:auto;padding:20px;max-width:860px;width:100%;margin:0 auto}
 .msg{margin-bottom:14px;display:flex;gap:10px} .msg .who{flex:0 0 78px;color:var(--mut);font-size:12px;padding-top:3px;text-transform:uppercase;letter-spacing:.04em}
 .msg .txt{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:9px 13px;white-space:pre-wrap;word-break:break-word;font:13px ui-monospace,monospace}
 .msg.user .txt{background:#132033;border-color:#1d3350}
 .msg.err .txt{border-color:var(--red);color:var(--red)}
 .foot{border-top:1px solid var(--line);background:var(--panel);padding:12px 22px}
 .foot .in{max-width:860px;margin:0 auto;display:flex;gap:8px;align-items:flex-end}
 textarea{flex:1;background:#0d1117;color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:13px ui-monospace,monospace;resize:vertical;min-height:44px;max-height:200px}
 .opts{max-width:860px;margin:0 auto 8px;display:flex;gap:16px;color:var(--mut);font-size:12px;align-items:center}
 .opts input{width:70px;background:#0d1117;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:4px 7px;font:inherit}
 button{background:var(--blue);color:#fff;border:0;border-radius:8px;padding:11px 20px;font:600 14px system-ui;cursor:pointer}
 button:disabled{opacity:.5;cursor:not-allowed}
</style></head><body>
<header><h1>Shahd — Chat</h1><span style="color:var(--mut);font-size:12px">experimental · safe-guarded generation</span><a href="/">← back to Data Foundry</a></header>
<div class="warn">⚠ This is a tiny, from-scratch <b>character-level</b> model trained on a small seed corpus. Output is <b>experimental and often incoherent</b> — it will only become useful after training on the Foundry data. This page verifies the end-to-end serving path, not model quality.</div>
<div class="chat" id="chat"></div>
<div class="foot">
 <div class="opts"><label>temp <input id="temp" type="number" step="0.1" value="0.8"></label><label>max tokens <input id="max" type="number" value="160"></label><span id="stat"></span></div>
 <div class="in"><textarea id="box" placeholder="Type a prompt (e.g. &quot;function add(&quot;)  — Enter to send, Shift+Enter for newline"></textarea><button id="send" onclick="send()">Send</button></div>
</div>
<script>
 const H=(s)=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const chat=document.getElementById('chat');
 const history=[];
 function add(role,txt,cls){const d=document.createElement('div');d.className='msg '+(cls||role);d.innerHTML='<div class="who">'+H(role)+'</div><div class="txt">'+H(txt)+'</div>';chat.appendChild(d);chat.scrollTop=chat.scrollHeight;return d.querySelector('.txt');}
 async function send(){
  const box=document.getElementById('box'),send=document.getElementById('send'),stat=document.getElementById('stat');
  const text=box.value.trim();if(!text)return;
  box.value='';send.disabled=true;stat.textContent='generating…';
  add('user',text);history.push({role:'user',content:text});
  const t0=Date.now();
  try{
   const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history,temperature:+document.getElementById('temp').value,max_tokens:+document.getElementById('max').value})});
   const j=await res.json();
   if(j.error){add('error',j.error,'err');}
   else{const c=(j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||'(empty)';add('model',c);history.push({role:'assistant',content:c});}
   stat.textContent=((Date.now()-t0)/1000).toFixed(1)+'s';
  }catch(e){add('error','request failed: '+e.message,'err');stat.textContent='';}
  send.disabled=false;box.focus();
 }
 document.getElementById('box').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
 add('system','Model loaded. Ask anything — remember, output is experimental until the model is trained on the Foundry corpus.');
</script></body></html>`;
