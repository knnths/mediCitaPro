// Uso: MYSQL_ADDON_URI=... node scripts/init-db.js   (o con un archivo .env cargado por tu shell)
const { pool, ensureDb } = require('../db');
ensureDb().then(() => { console.log('Base de datos lista.'); return pool().end(); })
  .catch(e => { console.error('Error:', e.message); process.exit(1); });
