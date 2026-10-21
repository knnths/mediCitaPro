# MediCita Pro — Vercel + MySQL (Clever Cloud)

Frontend estático (`public/`) + API Express (`app.js`) que corre como función serverless en Vercel y guarda todo en MySQL de Clever Cloud.

## Qué cambió respecto a la versión SQLite/Render
- `better-sqlite3` → `mysql2` (`db.js`, `schema.sql`).
- `express-session` (memoria) → sesión sin estado con JWT en cookie httpOnly (`jsonwebtoken`), necesaria en serverless.
- Los índices únicos parciales de SQLite se emulan con columnas generadas en MySQL (evita doble reserva de médico/paciente en el mismo horario).
- `api/index.js` + `vercel.json` para Vercel; archivos estáticos movidos a `public/`.
- Se eliminó `render.yaml`.

## Configuración
Todo está en `config.js` (credenciales de MySQL de Clever Cloud y la clave de sesión). No se usan variables de entorno. **Mantén el repositorio privado**, porque ese archivo contiene la contraseña de la base.

## Desplegar en Vercel
1. Sube el proyecto a un repositorio **privado** de GitHub e impórtalo en Vercel (Framework Preset: **Other**, sin build command).
2. Deploy y abre `https://tu-proyecto.vercel.app/api/health` → debe responder `{"ok":true}`. Las tablas se crean solas en la primera petición.

## Local
```
npm install
npm start   # http://localhost:3000
```

## Límite de conexiones en Clever Cloud
El plan gratuito permite pocas conexiones simultáneas (≈5). Cada instancia de Vercel usa 1. Si ves "too many connections", sube de plan.

## Cuentas de ejemplo (solo si la base está vacía)
- Admin: `admin@medicita.sv` / `Admin123`
- Médico: `dra.rivas@medicita.sv` / `Medico123`
- Paciente: `paciente@medicita.sv` / `Paciente123`

**Cámbialas o elimínalas antes de uso real.** No uses datos médicos reales sin revisión de seguridad/privacidad (límite de intentos de login, recuperación de contraseña, auditoría, respaldos).
