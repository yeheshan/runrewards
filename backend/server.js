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

let logins; // short-lived login tickets

app.get('/', (_req, res) => res.send('RunRewards API is running'));

// 1. App asks for a one-time login ticket
app.get('/auth/init', async (_req, res) => {
  const loginId = crypto.randomBytes(16).toString('hex');
  await logins.insertOne({ _id: loginId, createdAt: new Date() });
  res.json({ loginId });
});

// 2. Browser opens this; we forward to Strava's login page
app.get('/auth/start', async (req, res) => {
  const loginId = String(req.query.loginId || '');
  if (!(await logins.findOne({ _id: loginId }))) return res.status(400).send('Login expired. Go back to the app and try again.');
  const params = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state: loginId,
  });
  res.redirect(`https://www.strava.com/oauth/authorize?${params}`);
});

// 3. Strava sends the runner back here; we store tokens and mark the ticket as done
app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const page = (title, msg) =>
    res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>RunRewards</title></head>
<body style="font-family:sans-serif;text-align:center;padding:48px 24px;color:#12263A"><h2>${title}</h2><p>${msg}</p></body></html>`);
  if (!(await logins.findOne({ _id: String(state || '') }))) return page('Login expired', 'Go back to RunRewards and try again.');
  if (error || !code) return page('Connection cancelled', 'Go back to RunRewards and try again.');
  try {
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, code, grant_type: 'authorization_code' }),
    });
    const t = await r.json();
    if (!t.athlete) return page('Connection failed', 'Go back to RunRewards and try again.');
    const sessionToken = crypto.randomBytes(24).toString('hex');
    await users.updateOne(
      { _id: t.athlete.id },
      {
        $set: {
          name: t.athlete.firstname || 'Runner',
          access_token: t.access_token,
          refresh_token: t.refresh_token,
          expires_at: t.expires_at,
          sessionToken,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
    await logins.updateOne({ _id: state }, { $set: { athleteId: t.athlete.id, name: t.athlete.firstname || 'Runner', token: sessionToken } });
    page('Strava connected', 'You can close this tab and switch back to the RunRewards app.');
  } catch (e) {
    console.error(e);
    page('Server error', 'Go back to RunRewards and try again.');
  }
});

// 4. App checks whether the login has finished
app.get('/auth/claim', async (req, res) => {
  const login = await logins.findOneAndDelete({ _id: String(req.query.loginId || ''), token: { $exists: true } });
  if (!login) return res.json({ pending: true });
  res.json({ athleteId: login.athleteId, name: login.name, token: login.token });
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
   logins = client.db('runrewards').collection('logins');
  await logins.createIndex({ createdAt: 1 }, { expireAfterSeconds: 600 }); // tickets expire after 10 minutes
  app.listen(PORT, '0.0.0.0', () => console.log(`RunRewards API on port ${PORT}`));
})().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
