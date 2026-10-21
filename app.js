const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');
const { pool, ensureDb } = require('./db');

const isProd = process.env.NODE_ENV === 'production';
const SECRET = require('./config').sessionSecret;
const COOKIE = 'medicita.sid';
const MAX_AGE = 30 * 60 * 1000;
const ESTADOS = ['Pendiente', 'Confirmada', 'Atendida', 'Cancelada'];
const ROLES = ['admin', 'medico', 'paciente'];

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Envoltorio para manejar errores en handlers async.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Sesión sin estado: JWT firmado en cookie httpOnly (Vercel no conserva memoria entre invocaciones).
function setSession(res, uid) {
  const token = jwt.sign({ uid }, SECRET, { expiresIn: Math.floor(MAX_AGE / 1000) });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: MAX_AGE, path: '/' });
}
const clearSession = res => res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' });

async function current(req) {
  const t = req.cookies && req.cookies[COOKIE];
  if (!t) return null;
  let uid;
  try { uid = jwt.verify(t, SECRET).uid; } catch (e) { return null; }
  const [rows] = await pool().execute('SELECT * FROM users WHERE id=?', [uid]);
  return rows[0] || null;
}
const publicUser = u => u && ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, esp: u.esp || '' });

async function stateFor(u) {
  const [users] = await pool().query('SELECT id,nombre,email,rol,esp FROM users ORDER BY nombre');
  let [citas] = await pool().query('SELECT id,fecha,hora,pacienteId,medicoId,motivo,estado FROM citas ORDER BY fecha,hora');
  if (u.rol === 'paciente') citas = citas.filter(c => c.pacienteId === u.id);
  return { users, citas };
}

// Todas las rutas /api aseguran que las tablas existan.
app.use('/api', wrap(async (req, res, next) => { await ensureDb(); next(); }));

const auth = wrap(async (req, res, next) => {
  const u = await current(req);
  if (!u) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  req.user = u;
  setSession(res, u.id); // renueva la expiración (equivale a rolling: true)
  next();
});

app.get('/api/health', wrap(async (req, res) => { await pool().query('SELECT 1'); res.json({ ok: true }); }));

app.post('/api/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || '');
  const [rows] = await pool().execute('SELECT * FROM users WHERE email=?', [email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  setSession(res, u.id);
  res.json({ user: publicUser(u), state: await stateFor(u) });
}));

app.post('/api/register', wrap(async (req, res) => {
  const nombre = String(req.body.nombre || '').trim(), email = String(req.body.email || '').trim().toLowerCase();
  const pw = String(req.body.pw || ''), pw2 = String(req.body.pw2 || '');
  if (nombre.length < 3 || nombre.length > 150) return res.status(400).json({ error: 'Escribe tu nombre completo.' });
  if (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Escribe un correo válido.' });
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return res.status(400).json({ error: 'La contraseña necesita al menos 8 caracteres, con letras y números.' });
  if (pw !== pw2) return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
  const [dup] = await pool().execute('SELECT 1 FROM users WHERE email=?', [email]);
  if (dup.length) return res.status(409).json({ error: 'Ese correo ya tiene una cuenta. Inicia sesión.' });
  const id = 'p' + crypto.randomBytes(6).toString('hex');
  try {
    await pool().execute('INSERT INTO users(id,nombre,email,password_hash,rol,esp) VALUES(?,?,?,?,?,?)',
      [id, nombre, email, await bcrypt.hash(pw, 10), 'paciente', '']);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese correo ya tiene una cuenta. Inicia sesión.' });
    throw e;
  }
  const u = { id, nombre, email, rol: 'paciente', esp: '' };
  setSession(res, id);
  res.status(201).json({ user: publicUser(u), state: await stateFor(u) });
}));

app.get('/api/me', wrap(async (req, res) => {
  const u = await current(req);
  if (!u) return res.status(401).json({ user: null });
  setSession(res, u.id);
  res.json({ user: publicUser(u), state: await stateFor(u) });
}));

app.post('/api/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

app.get('/api/state', auth, wrap(async (req, res) => res.json({ state: await stateFor(req.user) })));

app.put('/api/state', auth, wrap(async (req, res) => {
  const actor = req.user, incoming = req.body || {};
  if (!Array.isArray(incoming.users) || !Array.isArray(incoming.citas)) return res.status(400).json({ error: 'Formato de datos inválido.' });
  const [existingUsers] = await pool().query('SELECT id,nombre,email,rol,esp FROM users ORDER BY id');
  const [existingCitas] = await pool().query('SELECT id,fecha,hora,pacienteId,medicoId,motivo,estado FROM citas ORDER BY id');
  const norm = a => JSON.stringify(a.slice().sort((x, y) => String(x.id).localeCompare(String(y.id))));
  const owns = c => c && (actor.rol === 'medico' ? c.medicoId === actor.id : c.pacienteId === actor.id);

  if (actor.rol !== 'admin') {
    if (norm(incoming.users) !== norm(existingUsers)) return res.status(403).json({ error: 'No puedes modificar usuarios.' });
    const oldMap = new Map(existingCitas.map(c => [c.id, c])), newMap = new Map(incoming.citas.map(c => [c.id, c]));
    for (const id of new Set([...oldMap.keys(), ...newMap.keys()])) {
      const a = oldMap.get(id), b = newMap.get(id);
      if (a && !owns(a)) continue;
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      if ((a && !owns(a)) || (b && !owns(b))) return res.status(403).json({ error: 'No puedes modificar citas de otros usuarios.' });
    }
  }
  const users = incoming.users, citas = incoming.citas;
  if (actor.rol === 'admin') {
    for (const u of users) if (!u.id || !u.nombre || !u.email || !ROLES.includes(u.rol)) return res.status(400).json({ error: 'Hay datos de usuario inválidos.' });
    if (!users.some(u => u.rol === 'admin')) return res.status(400).json({ error: 'Debe quedar al menos una cuenta de administración.' });
  }
  const byId = new Map(existingUsers.map(u => [u.id, u]));
  for (const c of citas) {
    if (!c.id || !c.fecha || !c.hora || !c.pacienteId || !c.medicoId || String(c.motivo || '').trim().length < 5 || String(c.motivo).length > 500 || !ESTADOS.includes(c.estado))
      return res.status(400).json({ error: 'Hay datos de cita inválidos.' });
    const m = byId.get(c.medicoId);
    if (!byId.has(c.pacienteId) || !m || m.rol !== 'medico') return res.status(400).json({ error: 'Paciente o médico inválido.' });
  }

  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    if (actor.rol === 'admin') {
      const ids = new Set(users.map(u => u.id));
      for (const old of existingUsers) if (!ids.has(old.id)) await conn.execute('DELETE FROM users WHERE id=?', [old.id]);
      for (const u of users) if (byId.has(u.id))
        await conn.execute('UPDATE users SET nombre=?,email=?,rol=?,esp=? WHERE id=?', [u.nombre, u.email, u.rol, u.esp || '', u.id]);
      await conn.execute('DELETE FROM citas');
    } else {
      const oldIds = existingCitas.filter(owns).map(c => c.id);
      for (const id of oldIds) await conn.execute('DELETE FROM citas WHERE id=?', [id]);
    }
    for (const c of citas) {
      if (actor.rol !== 'admin' && !owns(c)) continue;
      await conn.execute('INSERT INTO citas(id,fecha,hora,pacienteId,medicoId,motivo,estado) VALUES(?,?,?,?,?,?,?)',
        [c.id, c.fecha, c.hora, c.pacienteId, c.medicoId, c.motivo, c.estado]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error(e);
    return res.status(409).json({ error: e.code === 'ER_DUP_ENTRY' ? 'Conflicto al guardar. Actualiza la pantalla y prueba otro horario.' : 'No se pudieron guardar los cambios.' });
  } finally { conn.release(); }
  res.json({ ok: true, state: await stateFor(actor) });
}));

// Estáticos: en Vercel los sirve la CDN desde /public; esto solo se usa en local.
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.status(404).send('No encontrado'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor. Revisa la conexión con la base de datos.' });
});

module.exports = app;
