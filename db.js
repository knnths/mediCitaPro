const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

function config() {
  return {
    ...require('./config').mysql,
    waitForConnections: true,
    // Clever Cloud limita las conexiones por usuario; en serverless cada instancia abre su propio pool.
    connectionLimit: 1,
    maxIdle: 1,
    idleTimeout: 10000,
    queueLimit: 0,
    charset: 'utf8mb4',
    connectTimeout: 10000,
    timezone: 'Z'
  };
}

// El pool se guarda en globalThis para reutilizarlo entre invocaciones "calientes".
function pool() {
  if (!globalThis.__medicitaPool) globalThis.__medicitaPool = mysql.createPool(config());
  return globalThis.__medicitaPool;
}

async function seed(p) {
  const [[{ n }]] = await p.query('SELECT COUNT(*) n FROM users');
  if (n) return;
  const hashes = {};
  for (const pw of ['Admin123', 'Medico123', 'Paciente123']) hashes[pw] = await bcrypt.hash(pw, 10);
  const users = [
    ['u1','Administración MediCita','admin@medicita.sv','Admin123','admin',''],
    ['m1','Dra. Camila Rivas','dra.rivas@medicita.sv','Medico123','medico','Medicina general'],
    ['m2','Dr. Mauricio Henríquez','dr.henriquez@medicita.sv','Medico123','medico','Pediatría'],
    ['m3','Dra. Lucía Alvarenga','dra.alvarenga@medicita.sv','Medico123','medico','Ginecología'],
    ['m4','Dr. Óscar Menjívar','dr.menjivar@medicita.sv','Medico123','medico','Cardiología'],
    ['p1','Paciente Demo','paciente@medicita.sv','Paciente123','paciente',''],
    ['p2','Ana Martínez','ana.martinez@correo.sv','Paciente123','paciente',''],
    ['p3','Carlos Portillo','carlos.portillo@correo.sv','Paciente123','paciente',''],
    ['p4','Rosa Guzmán','rosa.guzman@correo.sv','Paciente123','paciente',''],
    ['p5','Jorge Cruz','jorge.cruz@correo.sv','Paciente123','paciente','']
  ];
  for (const u of users)
    await p.execute('INSERT IGNORE INTO users (id,nombre,email,password_hash,rol,esp) VALUES (?,?,?,?,?,?)', [u[0], u[1], u[2], hashes[u[3]], u[4], u[5]]);
  const today = new Date();
  const add = n => { const d = new Date(today); d.setDate(d.getDate() + n); if (d.getDay() === 0) d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
  const rows = [
    [-21,'08:30','p1','m1','Control de presión arterial','Atendida'],[-19,'10:00','p2','m2','Vacunación de refuerzo','Atendida'],
    [-17,'14:00','p3','m4','Dolor en el pecho al esfuerzo','Atendida'],[-15,'09:30','p4','m3','Control prenatal, semana 20','Atendida'],
    [-13,'11:00','p5','m1','Chequeo general anual','Atendida'],[-12,'15:30','p1','m4','Electrocardiograma de control','Cancelada'],
    [-10,'08:00','p2','m2','Fiebre persistente en niño de 4 años','Atendida'],[-9,'13:30','p3','m1','Resultados de laboratorio','Atendida'],
    [-7,'10:30','p4','m3','Control prenatal, semana 22','Atendida'],[-6,'16:00','p5','m4','Palpitaciones ocasionales','Atendida'],
    [-4,'09:00','p1','m1','Renovación de receta','Atendida'],[-3,'11:30','p2','m2','Control de crecimiento','Cancelada'],
    [-2,'14:30','p3','m3','Consulta ginecológica de rutina','Atendida'],[-1,'08:30','p5','m1','Dolor de espalda baja','Atendida'],
    [0,'09:00','p1','m1','Seguimiento de presión arterial','Confirmada'],[0,'10:30','p4','m3','Control prenatal, semana 24','Confirmada'],
    [0,'15:00','p3','m4','Revisión de ecocardiograma','Pendiente'],[1,'08:30','p2','m2','Control de peso y talla','Confirmada'],
    [2,'11:00','p5','m1','Chequeo de azúcar en sangre','Pendiente'],[3,'14:00','p1','m4','Prueba de esfuerzo','Pendiente'],
    [5,'09:30','p4','m3','Ultrasonido obstétrico','Confirmada'],[6,'10:00','p3','m1','Certificado médico laboral','Pendiente'],
    [8,'16:30','p2','m2','Vacuna contra influenza','Pendiente'],[10,'08:00','p5','m4','Control de colesterol','Pendiente']
  ];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    await p.execute('INSERT IGNORE INTO citas (id,fecha,hora,pacienteId,medicoId,motivo,estado) VALUES (?,?,?,?,?,?,?)',
      ['c' + (i + 1), add(r[0]), r[1], r[2], r[3], r[4], r[5]]);
  }
}

async function init() {
  const p = pool();
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  for (const stmt of sql.split(/;\s*$/m).map(s => s.trim()).filter(Boolean)) await p.query(stmt);
  await seed(p);
}

// Crea tablas y datos de ejemplo una sola vez por instancia (idempotente).
let ready = null;
function ensureDb() {
  if (!ready) ready = init().catch(e => { ready = null; throw e; });
  return ready;
}

module.exports = { pool, ensureDb };
