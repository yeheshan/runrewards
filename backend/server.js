require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, PUBLIC_URL, MONGODB_URI, PORT = 3000 } = process.env;
const REDIRECT_URI = `${PUBLIC_URL}/auth/callback`;
const ALLOWED_RETURN = /^(exp|exps|runrewards):\/\//; // only send runners back to our own app

const app = express();
app.use(cors());
let users; // MongoDB collection; one document per runner

app.get('/', (_req, res) => res.send('RunRewards API is running'));

// 1. App opens this in a browser; we forward to Strava's login page.
app.get('/auth/start', (req, res) => {
  const returnUrl = String(req.query.returnUrl || '');
  if (!ALLOWED_RETURN.test(returnUrl)) return res.status(400).send('Invalid returnUrl');
  const params = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state: returnUrl,
  });
  res.redirect(`https://www.strava.com/oauth/authorize?${params}`);
});

// 2. Strava sends the runner back; we swap the code for tokens and store them in MongoDB.
app.get('/auth/callback', async (req, res) => {
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const back = (q) => {
    const url = `${state}${state.includes('?') ? '&' : '?'}${new URLSearchParams(q)}`;
    const failed = !!q.error;
    res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>RunRewards</title></head>
<body style="font-family:sans-serif;text-align:center;padding:48px 24px;color:#12263A">
<h2>${failed ? 'Connection failed' : 'Strava connected'}</h2>
<p>${failed ? 'Tap below and try again from the app.' : 'Tap the button to return to RunRewards.'}</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#E4005B;color:#fff;padding:16px 28px;border-radius:10px;text-decoration:none;font-weight:bold">Open RunRewards</a></p>
<script>window.location.href=${JSON.stringify(url).replace(/</g, '\\u003c')};</script>
</body></html>`);
  };
});

// Looks up the runner from the app's session token.
async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const user = token && (await users.findOne({ sessionToken: token }));
  if (!user) return res.status(401).json({ error: 'Not signed in. Reconnect Strava.' });
  req.user = user;
  next();
}

async function stravaToken(user) {
  if (user.expires_at > Date.now() / 1000 + 60) return user.access_token;
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: user.refresh_token }),
  });
  const n = await r.json();
  if (!n.access_token) throw new Error('Strava refresh failed. Reconnect Strava.');
  await users.updateOne({ _id: user._id }, { $set: { access_token: n.access_token, refresh_token: n.refresh_token, expires_at: n.expires_at } });
  return n.access_token;
}

// 3. Runs since a given time, with the fields the app needs.
app.get('/activities', auth, async (req, res) => {
  try {
    const token = await stravaToken(req.user);
    const headers = { Authorization: `Bearer ${token}` };
    const list = await (await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${Number(req.query.after) || 0}&per_page=50`, { headers })).json();
    if (!Array.isArray(list)) return res.status(502).json({ error: 'Strava error', detail: list });

    const runs = list.filter((a) => ['Run', 'TrailRun', 'VirtualRun'].includes(a.sport_type || a.type));
    const activities = await Promise.all(
      runs.map(async (a) => {
        let calories = null; // calories only exist on the detailed endpoint
        try {
          const d = await (await fetch(`https://www.strava.com/api/v3/activities/${a.id}`, { headers })).json();
          calories = d.calories ?? null;
        } catch (_) {}
        return { id: a.id, name: a.name, date: a.start_date_local, distanceM: a.distance, movingTimeS: a.moving_time, elevationM: a.total_elevation_gain, calories };
      })
    );
    res.json({ activities });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Removes the runner's stored data (useful for "Disconnect").
app.delete('/me', auth, async (req, res) => {
  await users.deleteOne({ _id: req.user._id });
  res.json({ ok: true });
});

(async () => {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  users = client.db('runrewards').collection('users');
  await users.createIndex({ sessionToken: 1 });
  app.listen(PORT, '0.0.0.0', () => console.log(`RunRewards API on port ${PORT}`));
})().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
