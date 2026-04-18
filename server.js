const express = require('express');
const cors = require('cors');
const https = require('node:https');
const { Buffer } = require('node:buffer');
const { randomUUID } = require('crypto');

const app = express();

app.use(cors());
app.use(express.json());

const SUBMIT_KEY = process.env.SUBMIT_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;

const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_OWNER = process.env.GITHUB_OWNER;
const GH_REPO = process.env.GITHUB_REPO;
const GH_PATH = process.env.GITHUB_DATA_PATH || 'queue.json';
const GH_BRANCH = process.env.GITHUB_BRANCH || 'main';

let ghSha = null;

// ---------------- GITHUB REQUEST ----------------
function ghRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        'User-Agent': 'queue-app',
        Accept: 'application/vnd.github+json'
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({});
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------------- LOAD ----------------
async function loadQueue() {
  const path = `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}?ref=${GH_BRANCH}`;

  try {
    const res = await ghRequest(path);
    ghSha = res.sha;

    const decoded = Buffer.from(res.content, 'base64').toString();

    const parsed = JSON.parse(decoded);

    return Array.isArray(parsed) ? parsed : parsed.queue || [];
  } catch {
    ghSha = null;
    return [];
  }
}

// ---------------- SAVE ----------------
async function saveQueue(queue) {
  const path = `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`;

  const body = {
    message: "update queue",
    content: Buffer.from(JSON.stringify(queue, null, 2)).toString('base64'),
    branch: GH_BRANCH
  };

  if (ghSha) body.sha = ghSha;

  const res = await ghRequest(path, 'PUT', body);

  ghSha = res.content?.sha;
}

// ---------------- SAFE MUTATION ----------------
async function updateQueue(mutator) {
  for (let i = 0; i < 5; i++) {
    const q = await loadQueue();
    const result = mutator(q);

    try {
      await saveQueue(q);
      return result;
    } catch {
      ghSha = null; // retry on conflict
    }
  }

  throw new Error("Failed after retries");
}

// ---------------- ROUTES ----------------

app.get('/', (req, res) => {
  res.status(200).send('OK');
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/submit', async (req, res) => {
  const { key, title, prompt } = req.body;

  if (key !== SUBMIT_KEY) return res.status(401).json({ ok: false });

  const item = {
    id: randomUUID(),
    title,
    prompt,
    done: false,
    createdAt: Date.now()
  };

  await updateQueue(q => {
    q.push(item);
  });

  res.json({ ok: true });
});

app.get('/api/queue', async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ ok: false });

  const q = await loadQueue();

  res.json({ ok: true, queue: q });
});

app.delete('/api/queue/:id', async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ ok: false });

  await updateQueue(q => {
    const i = q.findIndex(x => x.id === req.params.id);
    if (i >= 0) q.splice(i, 1);
  });

  res.json({ ok: true });
});

// ---------------- START ----------------
const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  console.log("Running on port", PORT);
});
