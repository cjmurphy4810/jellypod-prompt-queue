import express from 'express';
import { readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

const SUBMIT_KEY = process.env.SUBMIT_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;
const FILE = process.env.DATA_FILE || './queue.json';
const PORT = process.env.PORT || 3000;

async function load() {
  try { return JSON.parse(await readFile(FILE, 'utf8')); } catch { return []; }
}
async function save(q) { await writeFile(FILE, JSON.stringify(q, null, 2), 'utf8'); }
function auth(res, provided, expected, scope) {
  if (!expected) return res.status(503).json({ error: `${scope} key not configured` });
  if (provided !== expected) return res.status(401).json({ error: 'Invalid key' });
  return true;
}

const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Jellypod Prompt Queue</title><style>body{font-family:system-ui,Arial,sans-serif;max-width:900px;margin:0 auto;padding:16px;}input,textarea{width:100%;padding:8px;border:1px solid #d0d7de;border-radius:6px;box-sizing:border-box;margin:6px 0;}textarea{min-height:120px;}button{cursor:pointer;border:1px solid #d0d7de;border-radius:6px;padding:8px 12px;margin-right:8px;background:#f3f4f6;}button.primary{background:#2da44e;border-color:#2da44e;color:#fff;}button.warn{background:#bf8700;border-color:#bf8700;color:#fff;}button.danger{background:#cf222e;border-color:#cf222e;color:#fff;}.muted{color:#57606a;font-size:12px;}details{border:1px solid #e1e4e8;border-radius:8px;margin-top:12px;padding:12px;}summary{font-weight:600;cursor:pointer;}.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;margin-left:8px;background:#eef2ff;color:#4338ca;}.pill.done{background:#ecfdf3;color:#116329;}</style></head><body><h1>Jellypod Prompt Queue</h1><div><h2>Submit</h2><input id="submitKey" placeholder="Submit key"/><input id="title" placeholder="Title"/><textarea id="prompt" placeholder="Paste prompt"></textarea><div><button class="primary" onclick="submitPrompt()">Submit</button><span class="muted" id="submitStatus"></span></div></div><hr/><div><h2>Queue (admin)</h2><input id="adminKey" placeholder="Admin key"/><div><button onclick="loadQueue()">Load</button><button onclick="clearAdminKey()">Clear stored admin key</button><span class="muted" id="queueStatus"></span></div><div id="queue"></div></div><script>const submitStatus=document.getElementById('submitStatus');const queueStatus=document.getElementById('queueStatus');const queueDiv=document.getElementById('queue');const adminKeyInput=document.getElementById('adminKey');adminKeyInput.value=localStorage.getItem('adminKey')||'';function set(el,msg){el.textContent=msg;}async function submitPrompt(){const key=document.getElementById('submitKey').value.trim();const title=document.getElementById('title').value.trim();const prompt=document.getElementById('prompt').value.trim();if(!key||!title||!prompt){set(submitStatus,'Key, title, prompt required');return;}try{const resp=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,title,prompt})});const data=await resp.json();if(!resp.ok){set(submitStatus,data.error||'Submit failed');return;}set(submitStatus,'Submitted');document.getElementById('title').value='';document.getElementById('prompt').value='';}catch(e){set(submitStatus,'Error '+e.message);}}function clearAdminKey(){localStorage.removeItem('adminKey');adminKeyInput.value='';queueDiv.innerHTML='';set(queueStatus,'');}async function loadQueue(){const key=adminKeyInput.value.trim();if(!key){set(queueStatus,'Admin key required');return;}localStorage.setItem('adminKey',key);set(queueStatus,'Loading...');try{const resp=await fetch('/api/queue?key='+encodeURIComponent(key));const data=await resp.json();if(!resp.ok){set(queueStatus,data.error||'Load failed');return;}renderQueue(data);}catch(e){set(queueStatus,'Error '+e.message);}}function renderQueue(items){queueDiv.innerHTML='';if(!items.length){queueDiv.innerHTML='<p class="muted">Queue is empty</p>';set(queueStatus,'');return;}set(queueStatus,'Loaded '+items.length);for(const item of items){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=item.title+' (created '+new Date(item.createdAt).toLocaleString()+')';const pill=document.createElement('span');pill.className='pill'+(item.status==='done'?' done':'');pill.textContent=item.status;summary.appendChild(pill);const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=item.prompt;details.appendChild(summary);details.appendChild(pre);const actions=document.createElement('div');const complete=document.createElement('button');complete.className='warn';complete.textContent='Complete';complete.onclick=()=>action(item.id,'complete');const del=document.createElement('button');del.className='danger';del.textContent='Delete';del.onclick=()=>{if(confirm('Delete this record?')) action(item.id,'delete');};const copyTitle=document.createElement('button');copyTitle.textContent='Copy title';copyTitle.onclick=()=>copy(item.title);const copyPrompt=document.createElement('button');copyPrompt.textContent='Copy prompt';copyPrompt.onclick=()=>copy(item.prompt);actions.appendChild(complete);actions.appendChild(del);actions.appendChild(copyTitle);actions.appendChild(copyPrompt);details.appendChild(actions);queueDiv.appendChild(details);}}async function action(id,kind){const key=(adminKeyInput.value||'').trim();if(!key)return;const url=kind==='delete'?'/api/queue/'+encodeURIComponent(id)+'?key='+encodeURIComponent(key):'/api/queue/'+encodeURIComponent(id)+'/complete?key='+encodeURIComponent(key);const resp=await fetch(url,{method:kind==='delete'?'DELETE':'POST'});const data=await resp.json();if(!resp.ok){set(queueStatus,data.error||kind+' failed');return;}loadQueue();}async function copy(text){try{await navigator.clipboard.writeText(text);set(queueStatus,'Copied');}catch{set(queueStatus,'Copy failed');}}</script></body></html>`;

app.get('/', (_, res) => res.type('html').send(html));

app.post('/api/submit', async (req, res) => {
  const { key, title, prompt } = req.body || {};
  if (!auth(res, key, SUBMIT_KEY, 'submit')) return;
  if (!title || !prompt) return res.status(400).json({ error: 'Title and prompt required' });
  const q = await load();
  q.push({ id: randomUUID(), title: title.trim(), prompt: prompt.trim(), status: 'open', createdAt: Date.now() });
  await save(q);
  res.status(201).json({ ok: true });
});

app.get('/api/queue', async (req, res) => {
  if (!auth(res, req.query.key, ADMIN_KEY, 'admin')) return;
  const q = await load();
  res.json(q);
});

app.post('/api/queue/:id/complete', async (req, res) => {
  if (!auth(res, req.query.key, ADMIN_KEY, 'admin')) return;
  const q = await load();
  const i = q.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  q[i].status = 'done';
  q[i].completedAt = Date.now();
  await save(q);
  res.json({ ok: true });
});

app.delete('/api/queue/:id', async (req, res) => {
  if (!auth(res, req.query.key, ADMIN_KEY, 'admin')) return;
  const q = await load();
  const i = q.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  q.splice(i, 1);
  await save(q);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log('Listening on http://localhost:' + PORT));
