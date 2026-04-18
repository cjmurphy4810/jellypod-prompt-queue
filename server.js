const express = require('express');
const cors = require('cors');
const { readFile, writeFile } = require('fs/promises');
const { randomUUID } = require('crypto');

const app = express();

// ✅ CRITICAL: allow GitHub Pages to call this API
app.use(cors({
  origin: 'https://cjmurphy4810.github.io'
}));

app.use(express.json());

const SUBMIT_KEY = process.env.SUBMIT_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;
const FILE = process.env.DATA_FILE || './queue.json';

// ---------- helpers ----------
async function load() {
  try {
    return JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function save(q) {
  await writeFile(FILE, JSON.stringify(q, null, 2), 'utf8');
}

function auth(res, provided, expected, scope) {
  if (!expected) {
    res.status(503).json({ ok: false, error: `${scope} key not configured` });
    return false;
  }
  if (provided !== expected) {
    res.status(401).json({ ok: false, error: 'Invalid key' });
    return false;
  }
  return true;
}

// ---------- health check ----------
app.get('/', (req, res) => {
  res.send('Jellypod backend is running');
});

// ---------- submit ----------
app.post('/api/submit', async (req, res) => {
  const { key, title, prompt } = req.body || {};

  if (!auth(res, key, SUBMIT_KEY, 'submit')) return;

  if (!title || !prompt) {
    return res.status(400).json({ ok: false, error: 'Title and prompt required' });
  }

  const q = await load();

  const item = {
    id: randomUUID(),
    title: title.trim(),
    prompt: prompt.trim(),
    done: false,
    createdAt: Date.now()
  };

  q.push(item);
  await save(q);

  res.json({ ok: true, id: item.id });
});

// ---------- load queue ----------
app.get('/api/queue', async (req, res) => {
  const key = req.query.key;

  if (!auth(res, key, ADMIN_KEY, 'admin')) return;

  const q = await load();

  res.json({ ok: true, queue: q });
});

// ---------- complete ----------
app.post('/api/queue/:id/complete', async (req, res) => {
  const key = req.query.key;

  if (!auth(res, key, ADMIN_KEY, 'admin')) return;

  const q = await load();

  const item = q.find(x => String(x.id) === String(req.params.id));
  if (item) item.done = true;

  await save(q);

  res.json({ ok: true });
});

// ---------- delete ----------
app.delete('/api/queue/:id', async (req, res) => {
  const key = req.query.key;

  if (!auth(res, key, ADMIN_KEY, 'admin')) return;

  let q = await load();
  q = q.filter(x => String(x.id) !== String(req.params.id));

  await save(q);

  res.json({ ok: true });
});

// ---------- start server ----------
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
