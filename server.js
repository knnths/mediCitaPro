// Ejecución local: npm start
const app = require('./app');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MediCita Pro disponible en http://localhost:${PORT}`));
