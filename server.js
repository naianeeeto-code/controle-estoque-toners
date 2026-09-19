import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL não configurada.');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1602';
const ADMIN_LOGIN_PASSWORD = process.env.ADMIN_LOGIN_PASSWORD || '1234';
const ADMIN_USER = 'admin';
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

const emptyState = { toners: [], movimentacoes: [], impressoras: [] };
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS technicians (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      technician_id TEXT NOT NULL,
      technician_name TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    );
  `);
  await pool.query(
    `INSERT INTO app_state(id,state) VALUES (1,$1::jsonb) ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(emptyState)]
  );
}

function newId() { return crypto.randomBytes(12).toString('hex'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function getCookieOptions(maxAge) {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge, path: '/' };
}

async function getState() {
  const { rows } = await pool.query('SELECT state FROM app_state WHERE id=1');
  if (!rows.length || !rows[0].state) return structuredClone(emptyState);
  const state = rows[0].state;
  if (!Array.isArray(state.toners)) state.toners = [];
  if (!Array.isArray(state.movimentacoes)) state.movimentacoes = [];
  if (!Array.isArray(state.impressoras)) state.impressoras = [];
  return state;
}
async function saveState(state) {
  if (!state || !Array.isArray(state.toners) || !Array.isArray(state.movimentacoes)) throw new Error('Estado inválido');
  if (!Array.isArray(state.impressoras)) state.impressoras = [];
  state.movimentacoes = state.movimentacoes.slice(0, 5);
  await pool.query('UPDATE app_state SET state=$1::jsonb, updated_at=NOW() WHERE id=1', [JSON.stringify(state)]);
}

async function findSession(req) {
  const token = req.cookies.session;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const { rows } = await pool.query(
    'SELECT technician_id, technician_name, expires_at FROM sessions WHERE token_hash=$1',
    [tokenHash]
  );
  const row = rows[0];
  if (!row || Number(row.expires_at) < Date.now()) {
    if (row) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash]);
    return null;
  }
  return { id: row.technician_id, name: row.technician_name };
}
async function auth(req, res, next) {
  try {
    const user = await findSession(req);
    if (!user) return res.status(401).json({ error: 'Não autenticado' });
    req.user = user;
    next();
  } catch (e) { next(e); }
}

app.get('/health', async (req, res, next) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, database: 'postgresql' }); }
  catch (e) { next(e); }
});

app.get('/api/me', async (req, res, next) => {
  try {
    const user = await findSession(req);
    if (!user) return res.status(401).json({ authenticated: false });
    res.json({ authenticated: true, user });
  } catch (e) { next(e); }
});

app.post('/api/login', async (req, res, next) => {
  try {
    const { name, password, stayLogged } = req.body || {};
    const n = String(name || '').trim();
    const p = String(password || '');
    let user = null;
    if (n.toLowerCase() === ADMIN_USER && p === ADMIN_LOGIN_PASSWORD) {
      user = { id: 'admin', name: ADMIN_USER };
    } else {
      const { rows } = await pool.query('SELECT id,name,password_hash FROM technicians WHERE LOWER(name)=LOWER($1)', [n]);
      const row = rows[0];
      if (row && await bcrypt.compare(p, row.password_hash)) user = { id: row.id, name: row.name };
    }
    if (!user) return res.status(401).json({ error: 'Nome ou senha incorretos.' });
    const token = crypto.randomBytes(32).toString('hex');
    const ttl = (stayLogged ? 30 : 1) * 24 * 60 * 60 * 1000;
    await pool.query('INSERT INTO sessions(token_hash,technician_id,technician_name,expires_at) VALUES ($1,$2,$3,$4)',
      [hashToken(token), user.id, user.name, Date.now() + ttl]);
    res.cookie('session', token, getCookieOptions(ttl));
    res.json({ ok: true, user });
  } catch (e) { next(e); }
});

app.post('/api/logout', auth, async (req, res, next) => {
  try {
    const token = req.cookies.session;
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(token)]);
    res.clearCookie('session', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/technicians', auth, async (req, res, next) => {
  try {
    const { name, password, adminPassword } = req.body || {};
    if (String(adminPassword || '') !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Senha de administrador incorreta.' });
    const n = String(name || '').trim();
    const p = String(password || '');
    if (!n) return res.status(400).json({ error: 'Informe o nome do técnico.' });
    if (n.toLowerCase() === 'admin') return res.status(400).json({ error: 'Esse nome é reservado para o administrador.' });
    if (!/^\d{4}$/.test(p)) return res.status(400).json({ error: 'A senha deve ter exatamente 4 dígitos.' });
    const passwordHash = await bcrypt.hash(p, 12);
    await pool.query('INSERT INTO technicians(id,name,password_hash) VALUES ($1,$2,$3)', [newId(), n, passwordHash]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Já existe um técnico com esse nome.' });
    next(e);
  }
});

app.get('/api/state', auth, async (req, res, next) => {
  try { res.json(await getState()); } catch (e) { next(e); }
});
app.put('/api/state', auth, async (req, res, next) => {
  try { await saveState(req.body); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

await initDb();
app.listen(PORT, () => console.log(`Servidor do estoque rodando na porta ${PORT}`));
