const express = require('express');
const cors = require('cors');
const { readFile, writeFile } = require('fs/promises');
const { randomUUID } = require('crypto');
const https = require('node:https');
const { Buffer } = require('node:buffer');

const app = express();

// allow GitHub Pages to call this API
app.use(cors({ origin: 'https://cjmurphy4810.github.io' }));
app.use(express.json());

const SUBMIT_KEY = process.env.SUBMIT_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;

// local persistence (fallback)
const FILE = process.env.DATA_FILE || './queue.json';

// GitHub persistence (preferred)
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_OWNER = process.env.GITHUB_OWNER || 'cjmurphy4810';
const GH_REPO = process.env.GITHUB_REPO || 'jellypod-prompt-queue';
const GH_PATH = process.env.GITHUB_DATA_PATH || 'queue.json';
const GH_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GH_COMMIT_MESSAGE = process.env.GITHUB_COMMIT_MESSAGE || 'Update queue.json';

let ghSha = null;

function githubConfigured() {
  return !!(GH_TOKEN && GH_OWNER && GH_REPO && GH_PATH && GH_BRANCH);
}

class GitHubError extends Error {
  constructor(status, body) {
    super(`GitHub API error: ${status}`);
    this.status = status;
    this.body = body;
  }
}

function githubRequest(path, { method = 'GET', body } = {}) {
  const headers = {
    Authorization: `Bearer ${GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jellypod-prompt-queue',
  };
  if (body) headers['Content-Type'] = 'application/json';

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const text = data || '';
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(text ? JSON.parse(text) : {});
            } catch (err) {
              reject(err);
            }
            return;
          }
          reject(new GitHubError(res.statusCode, text));
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------- persistence helpers ----------
async function load() {
  // GitHub storage enabled?
  if (githubConfigured()) {
    const url = `/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(
      GH_REPO
    )}/contents/${encodeURIComponent(GH_PATH)}?ref=${encodeURIComponent(GH_BRANCH)}`;

    try {
      const json = await githubRequest(url, { method: 'GET' });
      ghSha = json.sha || null;

      const decoded = Buffer.from(json.content || '', 'base64').toString('utf8');
      const queue = JSON.parse(decoded || '[]');
      return Array.isArray(queue) ? queue : [];
    } catch (err) {
      // If GitHub says file doesn't exist, treat as empty queue (create on first save)
      if (err instanceof GitHubError && err.status === 404) {
        ghSha = null;
        return [];
      }
      throw err;
    }
  }

  // fallback to local file storage
  try {
    return JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function save(q) {
  // GitHub storage enabled?
  if (githubConfigured()) {
    const url = `/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(
      GH_REPO
    )}/contents/${encodeURIComponent(GH_PATH)}`;

    const body = {
      message: GH_COMMIT_MESSAGE,
      content: Buffer.from(JSON.stringify(q, null, 2)).toString('base64'),
      branch: GH_BRANCH,
    };
    if (ghSha) body.sha = ghSha;

    const json = await githubRequest(url, { method: 'PUT', body });
    ghSha = json?.content?.sha || null;
    return;
  }

  // fallback local
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

  let q;
  try {
    q = await load();
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Failed to load queue' });
  }

  const item = {
    id: randomUUID(),
    title: String(title).trim(),
    prompt: String(prompt).trim(),
    done: false,
    createdAt: Date.now(),
  };

  q.push(item);

  try {
    await save(q);
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Failed to persist queue' });
  }

  res.json({ ok: true, id: item.id });
});

// ---------- load queue ----------
app.get('/api/queue', async (req, res) => {
  const key = req.query.key;
  if (!auth(res, key, ADMIN_KEY, 'admin')) return;

  let q;
  try {
    q = await load();
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Failed to load queue' });
  }

  res.json({ ok: true, queue: q });
});

// ---------- complete ----------
app.post('/api/queue/:id/complete', async (req, res) => {
  const key = req.query.key;
  if (!auth(res, key, ADMIN_KEY, 'admin')) return;

  let q;
  try {
    q = await load();
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Failed to load queue' });
  }

  const item = q.find((x) => String(x.id) === String(req.params.id));
  if (item) item.done = true;

  try {
    await save(q);
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Failed to persist queue' });
  }

  res.json({ ok: true });
});

// ---------- delete ----------
app.delete('/api/queue/:id', async (req, res) => {
  const key = req.query.key;
  if (!auth(res, key, ADMIN_KEY, 'admin')) return;

  let q;
  try {
    q = await load();
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Failed to load queue' });
  }

  q = q.filter((x) => String(x.id) !== String(req.params.id));

  try {
    await save(q);
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Failed to persist queue' });
  }

  res.json({ ok: true });
});

// ---------- start server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
