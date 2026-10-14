import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { WebSocketServer } from 'ws';

const { Pool } = pg;
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is required');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false } });
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map((v) => v.trim()) || true }));
app.use(express.json({ limit: '32kb' }));

const cleanUsername = (value) => String(value || '').trim().toLowerCase();
const publicUser = (row) => ({ id: row.id, username: row.username, displayName: row.display_name, money: row.money, reputation: row.reputation, selectedBike: row.selected_bike, stats: row.stats });
const tokenFor = (user) => jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
const auth = async (req, res, next) => {
  try {
    const raw = req.headers.authorization || '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'INVALID_TOKEN' }); }
};
const code = () => crypto.randomBytes(4).toString('hex').toUpperCase();

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'asian-drag-bike-backend' }); }
  catch { res.status(503).json({ ok: false }); }
});

app.post('/api/auth/register', async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || username).trim().slice(0, 32);
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'USERNAME_INVALID' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'PASSWORD_INVALID' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query('INSERT INTO users(username,password_hash) VALUES($1,$2) RETURNING id,username', [username, hash]);
    const user = result.rows[0];
    const profile = await pool.query('INSERT INTO player_profiles(user_id,display_name) VALUES($1,$2) RETURNING *', [user.id, displayName]);
    res.status(201).json({ token: tokenFor(user), user: publicUser({ ...user, ...profile.rows[0] }) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'USERNAME_TAKEN' });
    console.error(error); res.status(500).json({ error: 'REGISTER_FAILED' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || '');
  const result = await pool.query('SELECT u.id,u.username,u.password_hash,p.* FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.username=$1', [username]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'LOGIN_FAILED' });
  await pool.query('UPDATE users SET last_seen_at=now() WHERE id=$1', [user.id]);
  res.json({ token: tokenFor(user), user: publicUser(user) });
});

app.get('/api/me', auth, async (req, res) => {
  const result = await pool.query('SELECT u.id,u.username,p.* FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.id=$1', [req.user.sub]);
  if (!result.rows[0]) return res.status(404).json({ error: 'USER_NOT_FOUND' });
  res.json({ user: publicUser(result.rows[0]) });
});

app.post('/api/matches', auth, async (req, res) => {
  const distance = [150, 201, 250, 300].includes(Number(req.body.distance)) ? Number(req.body.distance) : 201;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const roomCode = code();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const match = await client.query('INSERT INTO matches(room_code,distance,created_by) VALUES($1,$2,$3) RETURNING id,room_code,distance,status', [roomCode, distance, req.user.sub]);
        await client.query('INSERT INTO match_players(match_id,user_id,slot) VALUES($1,$2,1)', [match.rows[0].id, req.user.sub]);
        await client.query('COMMIT'); return res.status(201).json({ match: { ...match.rows[0], slot: 1 } });
      } catch (error) { await client.query('ROLLBACK'); if (error.code !== '23505') throw error; }
      finally { client.release(); }
    } catch (error) { if (attempt === 4) { console.error(error); return res.status(500).json({ error: 'MATCH_CREATE_FAILED' }); } }
  }
});

app.post('/api/matches/:roomCode/join', auth, async (req, res) => {
  const room = String(req.params.roomCode || '').toUpperCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const match = await client.query('SELECT * FROM matches WHERE room_code=$1 FOR UPDATE', [room]);
    if (!match.rows[0] || match.rows[0].status !== 'waiting') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'ROOM_UNAVAILABLE' }); }
    const players = await client.query('SELECT slot FROM match_players WHERE match_id=$1', [match.rows[0].id]);
    if (players.rows.some((p) => p.slot === 2)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'ROOM_FULL' }); }
    await client.query('INSERT INTO match_players(match_id,user_id,slot) VALUES($1,$2,2) ON CONFLICT DO NOTHING', [match.rows[0].id, req.user.sub]);
    await client.query('COMMIT');
    res.json({ match: { ...match.rows[0], slot: 2 } });
  } catch (error) { await client.query('ROLLBACK'); console.error(error); res.status(500).json({ error: 'MATCH_JOIN_FAILED' }); }
  finally { client.release(); }
});

app.get('/api/matches/:roomCode', auth, async (req, res) => {
  const result = await pool.query('SELECT m.id,m.room_code,m.status,m.distance,m.created_at,mp.user_id,mp.slot,mp.ready FROM matches m JOIN match_players mp ON mp.match_id=m.id WHERE m.room_code=$1 ORDER BY mp.slot', [String(req.params.roomCode).toUpperCase()]);
  if (!result.rows[0]) return res.status(404).json({ error: 'ROOM_NOT_FOUND' });
  res.json({ match: { id: result.rows[0].id, roomCode: result.rows[0].room_code, status: result.rows[0].status, distance: result.rows[0].distance, players: result.rows.map(({ user_id, slot, ready }) => ({ userId: user_id, slot, ready })) } });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const sockets = new Map();
const send = (ws, data) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data)); };
const broadcast = (room, data) => (sockets.get(room) || new Set()).forEach((ws) => send(ws, data));

wss.on('connection', (ws, { userId, room }) => {
  if (!sockets.has(room)) sockets.set(room, new Set());
  sockets.get(room).add(ws);
  send(ws, { type: 'connected', room });
  broadcast(room, { type: 'player-count', count: sockets.get(room).size });
  ws.on('message', async (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'ready') {
        await pool.query('UPDATE match_players SET ready=true WHERE match_id=(SELECT id FROM matches WHERE room_code=$1) AND user_id=$2', [room, userId]);
        broadcast(room, { type: 'ready', userId });
      } else if (message.type === 'start') {
        const result = await pool.query("UPDATE matches SET status='racing',started_at=now() WHERE room_code=$1 AND status='waiting' RETURNING id", [room]);
        if (result.rowCount) broadcast(room, { type: 'race-start', at: Date.now() + 1500 });
      } else if (message.type === 'progress') {
        const x = Math.max(0, Math.min(1, Number(message.x) || 0));
        broadcast(room, { type: 'opponent-progress', userId, x });
      } else if (message.type === 'finish') {
        const time = Number(message.time);
        if (!Number.isFinite(time) || time < 0 || time > 120) return;
        await pool.query('UPDATE match_players SET finish_time=$1,foul=$2 WHERE match_id=(SELECT id FROM matches WHERE room_code=$3) AND user_id=$4', [time, !!message.foul, room, userId]);
        broadcast(room, { type: 'player-finish', userId, time, foul: !!message.foul });
      }
    } catch { send(ws, { type: 'error', error: 'INVALID_MESSAGE' }); }
  });
  ws.on('close', () => { const set = sockets.get(room); if (!set) return; set.delete(ws); if (!set.size) sockets.delete(room); else broadcast(room, { type: 'player-count', count: set.size }); });
});

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname !== '/ws') return socket.destroy();
  try {
    const token = url.searchParams.get('token');
    const room = String(url.searchParams.get('room') || '').toUpperCase();
    const payload = jwt.verify(token, JWT_SECRET);
    if (!room) throw new Error('room required');
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, { userId: payload.sub, room }));
  } catch { socket.destroy(); }
});

async function boot() {
  await pool.query(await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  server.listen(PORT, () => console.log(`Asian Drag Bike backend listening on :${PORT}`));
}
boot().catch((error) => { console.error('Database initialization failed', error); process.exit(1); });
