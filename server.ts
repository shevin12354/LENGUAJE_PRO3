import dotenv from 'dotenv';
// En pruebas se usa .env.test (BD separada); en el resto, .env
dotenv.config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_TEST = process.env.NODE_ENV === 'test';

export const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

/* ==========================================================================
 * HARDENING: el secreto JWT viene del .env, nunca del código
 * ========================================================================== */
const JWT_SECRET: string = (() => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('Falta JWT_SECRET en el archivo .env (o .env.test en pruebas).');
  return s;
})();

/* ==========================================================================
 * OBSERVABILIDAD: logger a consola + archivo (backend/logs/app.log)
 * ========================================================================== */
const BACKEND_DIR = path.resolve(__dirname, 'backend');
if (!fs.existsSync(BACKEND_DIR)) {
  fs.mkdirSync(BACKEND_DIR, { recursive: true });
}

const LOG_DIR = path.resolve(BACKEND_DIR, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream = IS_TEST ? null : fs.createWriteStream(path.join(LOG_DIR, 'app.log'), { flags: 'a' });

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, err?: unknown) {
  const stack = err instanceof Error ? `\n${err.stack}` : err ? `\n${String(err)}` : '';
  const line = `${new Date().toISOString()} [${level}] ${msg}${stack}`;
  if (level === 'ERROR') console.error(line);
  else if (!IS_TEST) console.log(line);
  logStream?.write(line + '\n');
}

/** Registra el error completo (con stacktrace) en el log y responde algo genérico al cliente */
function fallo(res: Response, err: unknown, contexto: string) {
  log('ERROR', contexto, err);
  return res.status(500).json({ success: false, error: 'Ocurrió un error interno en el servidor.' });
}

/* ==========================================================================
 * HARDENING: CORS con lista blanca de orígenes (viene del .env)
 * ========================================================================== */
const ORIGENES_PERMITIDOS = (process.env.ALLOWED_ORIGIN || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ORIGENES_PERMITIDOS.includes(origin)),
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

app.use(express.json());

// OBSERVABILIDAD: cada petición -> "GET /api/phones 200 45ms"
if (!IS_TEST) {
  app.use(morgan(':method :url :status :response-time[0]ms', {
    stream: { write: (m: string) => log('INFO', m.trim()) }
  }));
}

const LIMITE_CELULARES = 0;

// API externa: DummyJSON, categoría smartphones
const API_URL = process.env.PHONES_API_URL || 'https://dummyjson.com/products/category/smartphones?limit=0';

type FuenteDatos = 'sin cargar' | 'api' | 'respaldo';
type PhoneData = { brand: string; phone_name: string; image: string; price: number | null; stock: number | null };
type AuthPayload = { id: number; username: string; role: 'admin' | 'user' };
type AuthedRequest = Request & { auth?: AuthPayload };

let fuenteDatos: FuenteDatos = 'sin cargar';
let sequelize: Sequelize | null = null;
let PhoneModel: any = null;
let UserModel: any = null;
let AuditModel: any = null;

const FUENTE_PATH = path.resolve(BACKEND_DIR, 'fuente-datos.json');

function guardarFuente(fuente: FuenteDatos) {
  fuenteDatos = fuente;
  try {
    fs.writeFileSync(FUENTE_PATH, JSON.stringify({ fuenteDatos: fuente }));
  } catch { /* no crítico */ }
}

function cargarFuente() {
  try {
    const guardado = JSON.parse(fs.readFileSync(FUENTE_PATH, 'utf-8'));
    if (guardado.fuenteDatos === 'api' || guardado.fuenteDatos === 'respaldo') {
      fuenteDatos = guardado.fuenteDatos;
    }
  } catch { /* primera ejecución */ }
}

const CATALOGO_RESPALDO: PhoneData[] = [
  { brand: 'Apple', phone_name: 'iPhone 15 Pro', image: 'https://fdn2.gsmarena.com/vv/bigpic/apple-iphone-15-pro.jpg', price: 999, stock: 12 },
  { brand: 'Apple', phone_name: 'iPhone 15', image: 'https://fdn2.gsmarena.com/vv/bigpic/apple-iphone-15.jpg', price: 799, stock: 20 },
  { brand: 'Samsung', phone_name: 'Samsung Galaxy S24 Ultra', image: 'https://fdn2.gsmarena.com/vv/bigpic/samsung-galaxy-s24-ultra-5g-sm-s928.jpg', price: 1199, stock: 8 },
  { brand: 'Samsung', phone_name: 'Samsung Galaxy S24', image: 'https://fdn2.gsmarena.com/vv/bigpic/samsung-galaxy-s24-5g-sm-s921.jpg', price: 799, stock: 15 },
  { brand: 'Xiaomi', phone_name: 'Xiaomi 14', image: 'https://fdn2.gsmarena.com/vv/bigpic/xiaomi-14.jpg', price: 699, stock: 10 },
  { brand: 'Xiaomi', phone_name: 'Xiaomi Redmi Note 13 Pro+', image: 'https://fdn2.gsmarena.com/vv/bigpic/xiaomi-redmi-note-13-pro-plus.jpg', price: 399, stock: 25 },
  { brand: 'Google', phone_name: 'Google Pixel 8', image: 'https://fdn2.gsmarena.com/vv/bigpic/google-pixel-8.jpg', price: 699, stock: 9 },
  { brand: 'Motorola', phone_name: 'Motorola Edge 50 Ultra', image: 'https://fdn2.gsmarena.com/vv/bigpic/motorola-edge-50-ultra.jpg', price: 799, stock: 6 },
  { brand: 'OnePlus', phone_name: 'OnePlus 12', image: 'https://fdn2.gsmarena.com/vv/bigpic/oneplus-12.jpg', price: 799, stock: 7 },
  { brand: 'Nothing', phone_name: 'Nothing Phone (2)', image: 'https://fdn2.gsmarena.com/vv/bigpic/nothing-phone2.jpg', price: 599, stock: 11 }
];

const mensajeError = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ==========================================================================
 * PATRÓN DE INYECCIÓN DE DEPENDENCIAS (Rúbrica - Reto 2 Parte 2)
 * ========================================================================== */
export class PhoneApiService {
  constructor(private fetchFn: typeof fetch = global.fetch) {}

  async obtenerTelefonos(urlApi: string, limite: number): Promise<{ source: 'api' | 'fallback'; data: PhoneData[] }> {
    const url = new URL(urlApi);
    url.searchParams.set('limit', String(limite));
    const intentos = 2;

    for (let i = 1; i <= intentos; i++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await this.fetchFn(url.toString(), { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status} (${response.statusText})`);

        const json: any = await response.json();
        if (!json || !Array.isArray(json.products) || json.products.length === 0) {
          throw new Error('La respuesta no contiene la lista "products" esperada.');
        }

        const productos: any[] = limite > 0 ? json.products.slice(0, limite) : json.products;

        const data: PhoneData[] = productos.map((p: any) => ({
          brand: p.brand || String(p.title || '').split(' ')[0] || 'Genérica',
          phone_name: p.title || 'Teléfono sin nombre',
          image: p.thumbnail || (Array.isArray(p.images) ? p.images[0] : '') || '',
          price: typeof p.price === 'number' ? p.price : null,
          stock: Number.isInteger(p.stock) ? p.stock : null
        }));

        return { source: 'api', data };
      } catch (err: any) {
        if (i < intentos) {
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          log('WARN', `[ALERTA DE CONEXIÓN] No se pudo comunicar con la API externa (${urlApi}). Razón: ${err.message || err}. Activando catálogo de RESPALDO local.`);
          return {
            source: 'fallback',
            data: limite > 0 ? CATALOGO_RESPALDO.slice(0, limite) : CATALOGO_RESPALDO
          };
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    return { source: 'fallback', data: limite > 0 ? CATALOGO_RESPALDO.slice(0, limite) : CATALOGO_RESPALDO };
  }
}

const phoneService = new PhoneApiService();

/* ------------------------------ Base de datos (MySQL - XAMPP) ------------------------------ */
function inicializarSequelize() {
  // HARDENING: credenciales desde variables de entorno
  sequelize = new Sequelize(
    process.env.DB_NAME || 'celulares_db',
    process.env.DB_USER || 'root',
    process.env.DB_PASS || '',
    {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      dialect: 'mysql',
      logging: false
    }
  );

  // 1. Tabla de Celulares (esta es la que se vacía y repuebla)
  PhoneModel = sequelize.define('Phone', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    brand: { type: DataTypes.STRING, allowNull: false },
    phone_name: { type: DataTypes.STRING, allowNull: false },
    image: { type: DataTypes.TEXT, allowNull: true },
    price: { type: DataTypes.FLOAT, allowNull: true },
    stock: { type: DataTypes.INTEGER, allowNull: true }
  }, {
    tableName: 'phones',
    timestamps: true
  });

  // 2. Tabla de Usuarios y Roles (permanente)
  UserModel = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.ENUM('admin', 'user'), defaultValue: 'user', allowNull: false }
  }, {
    tableName: 'users',
    timestamps: true
  });

  // 3. Tabla de Auditoría (permanente)
  AuditModel = sequelize.define('Audit', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    action: { type: DataTypes.STRING, allowNull: false },
    username: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, allowNull: false },
    details: { type: DataTypes.TEXT, allowNull: true },
    ipAddress: { type: DataTypes.STRING, allowNull: true }
  }, {
    tableName: 'audits',
    timestamps: true
  });

  return { sequelize, PhoneModel, UserModel, AuditModel };
}

async function asegurarConexion() {
  if (!sequelize || !PhoneModel || !UserModel || !AuditModel) {
    inicializarSequelize();
    await sequelize!.sync();
  }
}

async function poblarBaseDeDatos(limite?: number) {
  const lim = (typeof limite === 'number' && limite > 0) ? limite : LIMITE_CELULARES;
  try {
    const result = await phoneService.obtenerTelefonos(API_URL, lim);
    guardarFuente(result.source === 'api' ? 'api' : 'respaldo');
    if (result.data.length > 0) {
      await PhoneModel.bulkCreate(result.data);
    }
    return { count: result.data.length, source: result.source };
  } catch (e: any) {
    log('WARN', `[FALLO CRÍTICO] Error al poblar: ${e.message}. Activando respaldo local de emergencia.`);
    guardarFuente('respaldo');
    const data = lim > 0 ? CATALOGO_RESPALDO.slice(0, lim) : CATALOGO_RESPALDO;
    if (data.length > 0) await PhoneModel.bulkCreate(data);
    return { count: data.length, source: 'fallback' as const };
  }
}

/* ------------------------------- Auditoría ------------------------------- */
// HARDENING: el usuario/rol sale del token verificado, no de headers que el cliente puede falsificar
async function auditar(action: string, req: Request, details: string, fallbackUser?: { username: string; role: string }) {
  try {
    const a = (req as AuthedRequest).auth;
    const username = fallbackUser?.username || a?.username || 'Anonimo';
    const role = fallbackUser?.role || a?.role || 'invitado';
    const ipAddress = req.ip || req.socket.remoteAddress || '127.0.0.1';

    await AuditModel.create({ action, username, role, details, ipAddress });
  } catch (err) {
    log('ERROR', 'Error registrando auditoría', err);
  }
}

/* ------------------------------- Autenticación JWT ------------------------------- */
function autenticar(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try {
    (req as AuthedRequest).auth = jwt.verify(token, JWT_SECRET) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Sesión inválida o expirada. Inicia sesión.' });
  }
}

function requerirAdmin(req: Request, res: Response, next: NextFunction) {
  autenticar(req, res, () => {
    if ((req as AuthedRequest).auth?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Acceso denegado (Código 403 Forbidden): Solo un Administrador puede realizar esta acción.'
      });
    }
    next();
  });
}

/* ------------------------------- Validación ------------------------------- */
function validarTelefono(body: any, parcial = false) {
  const errores: string[] = [];
  const datos: Record<string, string | number | null> = {};
  const entrada = body || {};

  for (const campo of ['brand', 'phone_name']) {
    const valor = entrada[campo];
    if (valor === undefined) {
      if (!parcial) errores.push(`"${campo}" es obligatorio.`);
      continue;
    }
    if (typeof valor !== 'string' || !valor.trim()) {
      errores.push(`"${campo}" debe ser un texto no vacío.`);
    } else if (valor.trim().length > 100) {
      errores.push(`"${campo}" no puede superar 100 caracteres.`);
    } else {
      datos[campo] = valor.trim();
    }
  }

  if (entrada.image !== undefined) {
    if (entrada.image === null || entrada.image === '') {
      datos.image = null;
    } else if (typeof entrada.image !== 'string' || !/^https?:\/\/\S+$/i.test(entrada.image.trim())) {
      errores.push('"image" debe ser una URL válida que empiece por http:// o https://.');
    } else {
      datos.image = entrada.image.trim();
    }
  }

  for (const campo of ['price', 'stock']) {
    const valor = entrada[campo];
    if (valor === undefined) continue;
    if (valor === null || valor === '') { datos[campo] = null; continue; }
    const num = Number(valor);
    const entero = campo === 'stock';
    if (!Number.isFinite(num) || num < 0 || (entero && !Number.isInteger(num))) {
      errores.push(`"${campo}" debe ser un número ${entero ? 'entero ' : ''}mayor o igual a 0.`);
    } else {
      datos[campo] = num;
    }
  }

  return { errores, datos };
}

function leerId(valor: string): number | null {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/* ---------------- Comunicación Bidireccional con API Externa (Reto 2 - Parte 3) ---------------- */
async function notificarApiExterna(phoneData: any) {
  const webhookUrl = 'https://httpbin.org/post';
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        evento: 'REGISTRO_CREADO_EN_BD',
        origen: 'Uniremington - Lenguaje de Programacion III',
        timestamp: new Date().toISOString(),
        data: phoneData
      })
    });
    const resultadoJson = await response.json();
    return { success: true, status: response.status, response: resultadoJson };
  } catch (error) {
    log('WARN', `Falló la notificación a la API externa: ${mensajeError(error)}`);
    return { success: false, error: 'No se pudo contactar la API externa.' };
  }
}

/* ------------------------------- Endpoints ------------------------------- */

// OBSERVABILIDAD: endpoint de salud (público, sin datos sensibles)
app.get('/health', async (_req: Request, res: Response) => {
  let db = 'connected';
  try {
    await asegurarConexion();
    await sequelize!.authenticate();
  } catch (err) {
    db = 'disconnected';
    log('ERROR', 'Health check: la base de datos no responde', err);
  }
  res.status(db === 'connected' ? 200 : 503).json({
    status: db === 'connected' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(process.uptime())}s`,
    database: db
  });
});

let reiniciando = false;
app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
  if (reiniciando) {
    return res.status(503).json({
      success: false,
      error: 'La base de datos se está reiniciando. Intenta de nuevo en unos segundos.'
    });
  }
  next();
});

/* ----------------- Autenticación ----------------- */
app.post('/api/auth/login', async (req, res) => {
  try {
    await asegurarConexion();
    const { username, password } = req.body ?? {};
    // HARDENING: validar tipos (evita inyección de objetos tipo {"username": {"$ne": ...}})
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ success: false, error: 'Ingresa usuario y contraseña.' });
    }
    if (username.length > 100 || password.length > 200) {
      return res.status(400).json({ success: false, error: 'Usuario o contraseña demasiado largos.' });
    }

    const user = await UserModel.findOne({ where: { username } });
    const ok = user ? await bcrypt.compare(password, user.password) : false;
    if (!user || !ok) {
      await auditar('LOGIN_FALLIDO', req, `Intento fallido de login con usuario: ${username.slice(0, 50)}`);
      return res.status(401).json({ success: false, error: 'Credenciales inválidas.' });
    }

    await auditar('LOGIN_EXITOSO', req, 'Inicio de sesión exitoso', { username: user.username, role: user.role });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.status(200).json({
      success: true,
      message: 'Inicio de sesión exitoso (Código 200 OK)',
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (err) {
    return fallo(res, err, 'POST /api/auth/login');
  }
});

/* ----------------- Auditoría (Solo Admin) ----------------- */
app.get('/api/audits', requerirAdmin, async (_req, res) => {
  try {
    await asegurarConexion();
    const audits = await AuditModel.findAll({ order: [['id', 'DESC']], limit: 100 });
    res.status(200).json({ success: true, total: audits.length, data: audits });
  } catch (err) {
    return fallo(res, err, 'GET /api/audits');
  }
});

/* ----------------- Celulares (Público / Clientes / Admin) ----------------- */

// Leer todos (acepta ?limit=N para el selector "Mostrar" del frontend)
app.get('/api/phones', async (req, res) => {
  try {
    await asegurarConexion();
    const limite = leerId(String(req.query.limit ?? ''));
    const total = await PhoneModel.count();
    const phones = await PhoneModel.findAll({ order: [['id', 'ASC']], ...(limite ? { limit: Math.min(limite, 1000) } : {}) });
    res.status(200).json({ success: true, total, data: phones });
  } catch (error) {
    return fallo(res, error, 'GET /api/phones');
  }
});

// Leer uno por ID
app.get('/api/phones/:id', async (req, res) => {
  try {
    await asegurarConexion();
    const id = leerId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'El id debe ser un número entero positivo.' });

    const phone = await PhoneModel.findByPk(id);
    if (!phone) return res.status(404).json({ success: false, error: `No se encontró el teléfono con id=${id}.` });

    res.status(200).json({ success: true, data: phone });
  } catch (error) {
    return fallo(res, error, 'GET /api/phones/:id');
  }
});

// Crear (SOLO ADMIN)
app.post('/api/phones', requerirAdmin, async (req, res) => {
  try {
    await asegurarConexion();
    const { errores, datos } = validarTelefono(req.body);
    if (errores.length > 0) {
      return res.status(400).json({ success: false, error: 'Validación fallida.', details: errores });
    }
    const nuevo = await PhoneModel.create(datos);
    const notificacion = await notificarApiExterna(nuevo.toJSON());

    await auditar('CREAR_CELULAR', req, `Creó el celular "${nuevo.phone_name}" (ID #${nuevo.id})`);

    res.status(201).json({
      success: true,
      message: 'Celular creado y sincronizado exitosamente.',
      data: nuevo,
      comunicacionExterna: notificacion
    });
  } catch (error) {
    return fallo(res, error, 'POST /api/phones');
  }
});

// Notificación manual a API externa (ahora SOLO ADMIN)
app.post('/api/phones/:id/notificar', requerirAdmin, async (req, res) => {
  try {
    await asegurarConexion();
    const id = leerId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'El id debe ser un número entero positivo.' });

    const phone = await PhoneModel.findByPk(id);
    if (!phone) return res.status(404).json({ success: false, error: `No se encontró el teléfono con id=${id}.` });

    const notificacion = await notificarApiExterna(phone.toJSON());
    res.status(200).json({ success: true, message: `Datos del teléfono ${id} enviados a la API externa.`, notificacion });
  } catch (error) {
    return fallo(res, error, 'POST /api/phones/:id/notificar');
  }
});

// Actualizar (SOLO ADMIN)
app.put('/api/phones/:id', requerirAdmin, async (req, res) => {
  try {
    await asegurarConexion();
    const id = leerId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'El id debe ser un número entero positivo.' });

    const { errores, datos } = validarTelefono(req.body, true);
    if (errores.length > 0) {
      return res.status(400).json({ success: false, error: 'Validación fallida.', details: errores });
    }
    if (Object.keys(datos).length === 0) {
      return res.status(400).json({ success: false, error: 'No se enviaron campos para actualizar.' });
    }

    const phone = await PhoneModel.findByPk(id);
    if (!phone) return res.status(404).json({ success: false, error: `No se encontró el teléfono con id=${id}.` });

    await phone.update(datos);
    await auditar('ACTUALIZAR_CELULAR', req, `Actualizó datos del celular ID #${id} (${phone.phone_name})`);

    res.status(200).json({ success: true, message: 'Celular actualizado.', data: phone });
  } catch (error) {
    return fallo(res, error, 'PUT /api/phones/:id');
  }
});

// Eliminar (SOLO ADMIN)
app.delete('/api/phones/:id', requerirAdmin, async (req, res) => {
  try {
    await asegurarConexion();
    const id = leerId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'El id debe ser un número entero positivo.' });

    const phone = await PhoneModel.findByPk(id);
    if (!phone) return res.status(404).json({ success: false, error: `No se encontró el teléfono con id=${id}.` });

    const nombre = phone.phone_name;
    await phone.destroy();
    await auditar('ELIMINAR_CELULAR', req, `Eliminó el celular ID #${id} ("${nombre}")`);

    res.status(200).json({ success: true, message: `Teléfono ${id} eliminado.`, data: { id } });
  } catch (error) {
    return fallo(res, error, 'DELETE /api/phones/:id');
  }
});

// Reset-DB (SOLO ADMIN - Vacía ÚNICAMENTE celulares, NO toca usuarios ni auditoría)
app.post('/api/reset-db', requerirAdmin, async (req, res) => {
  const limiteEntrada = req.body?.limit ?? req.query.limit;

  let limite: number = LIMITE_CELULARES;
  if (limiteEntrada !== undefined && limiteEntrada !== null && limiteEntrada !== '' && Number(limiteEntrada) > 0) {
    limite = Math.min(Math.floor(Number(limiteEntrada)), 1000);
  }

  const logs: string[] = [];
  reiniciando = true;
  try {
    await asegurarConexion();
    logs.push('1. Limpiando únicamente la tabla "phones" en MySQL (preservando usuarios y auditoría)...');
    await PhoneModel.destroy({ where: {}, truncate: true });
    logs.push('✓ Tabla de celulares vaciada.');

    logs.push(`2. Consumiendo la API externa cargando ${limite > 0 ? `exactamente ${limite}` : 'todos los'} celulares...`);
    const result = await poblarBaseDeDatos(limite);
    logs.push(`✓ ${result.count} teléfonos insertados.`);

    await auditar('RESET_BD', req, `Vació y repobló el catálogo con ${result.count} teléfonos`);

    res.status(200).json({
      success: true,
      message: 'Base de datos reiniciada y repoblada exitosamente en MySQL.',
      registrosCreados: result.count,
      limiteAplicado: limite,
      origenDatos: result.source,
      fuenteDatos,
      logs,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    log('ERROR', 'POST /api/reset-db', error);
    res.status(500).json({ success: false, error: 'Error al resetear base de datos.', logs });
  } finally {
    reiniciando = false;
  }
});

// Status (SOLO ADMIN)
app.get('/api/status', requerirAdmin, async (_req, res) => {
  try {
    await asegurarConexion();
    const tablesInfo: any[] = await sequelize!.query('SHOW TABLES', { type: QueryTypes.SELECT });
    const tableNames = tablesInfo.map((t: any) => Object.values(t)[0]);
    let totalAcumulado = 0;
    const tablasResumen: any[] = [];

    for (const tableName of tableNames) {
      const columns: any[] = await sequelize!.query(`DESCRIBE \`${tableName}\``, { type: QueryTypes.SELECT });
      const countResult: any[] = await sequelize!.query(`SELECT COUNT(*) as count FROM \`${tableName}\``, { type: QueryTypes.SELECT });
      const count = countResult[0] ? (countResult[0] as any).count : 0;
      totalAcumulado += count;
      tablasResumen.push({ nombre: tableName, totalRegistros: count, columnas: columns.map((c: any) => c.Field) });
    }

    res.status(200).json({
      success: true,
      estado: 'Conectada y operativa',
      baseDeDatos: { motor: 'MySQL (XAMPP)', nombre: process.env.DB_NAME || 'celulares_db' },
      tablas: tablasResumen,
      totalTablas: tableNames.length,
      totalRegistros: totalAcumulado,
      apiUrl: API_URL,
      fuenteDatos,
      tiempoServidor: new Date().toISOString()
    });
  } catch (error) {
    return fallo(res, error, 'GET /api/status');
  }
});

// DB-Tables (SOLO ADMIN, y sin exponer los hashes de contraseña)
app.get('/api/db-tables', requerirAdmin, async (_req, res) => {
  try {
    await asegurarConexion();
    const tablesInfo: any[] = await sequelize!.query('SHOW TABLES', { type: QueryTypes.SELECT });
    const tableNames = tablesInfo.map((t: any) => Object.values(t)[0] as string);
    const dbView: Record<string, any[]> = {};
    const detalleTablas: Record<string, any> = {};

    for (const table of tableNames) {
      const columns: any[] = await sequelize!.query(`DESCRIBE \`${table}\``, { type: QueryTypes.SELECT });
      let rows: any[] = await sequelize!.query(`SELECT * FROM \`${table}\``, { type: QueryTypes.SELECT });
      if (table === 'users') {
        rows = rows.map((r) => ({ ...r, password: '[PROTEGIDO]' }));
      }
      dbView[table] = rows;
      detalleTablas[table] = {
        totalRegistros: rows.length,
        columnas: columns.map((col: any) => ({ campo: col.Field, tipo: col.Type, clavePrimaria: col.Key === 'PRI', noNulo: col.Null === 'NO' })),
        registros: rows
      };
    }

    res.status(200).json({ success: true, database: process.env.DB_NAME || 'celulares_db', tablas: tableNames, tables: dbView, detalleTablas, timestamp: new Date().toISOString() });
  } catch (error) {
    return fallo(res, error, 'GET /api/db-tables');
  }
});

app.use('/api', (req: Request, res: Response) => {
  res.status(404).json({ success: false, error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
});

// OBSERVABILIDAD + HARDENING: manejador global (stacktrace al log, mensaje genérico al cliente)
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'JSON inválido.' });
  }
  log('ERROR', `${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ success: false, error: 'Ocurrió un error interno en el servidor.' });
});

/* ------------------------------ Usuarios iniciales ------------------------------ */
// HARDENING: contraseñas con bcrypt (también migra las que estaban en texto plano)
async function sembrarUsuariosIniciales() {
  const iniciales = [
    { username: 'admin', role: 'admin' },
    { username: 'cliente', role: 'user' }
  ];
  const hash = await bcrypt.hash(process.env.SEED_PASSWORD || '123', 10);
  for (const u of iniciales) {
    const existente = await UserModel.findOne({ where: { username: u.username } });
    if (!existente) {
      await UserModel.create({ ...u, password: hash });
    } else if (!String(existente.password).startsWith('$2')) {
      await existente.update({ password: hash });
    }
  }
}

/* ------------------------------ Arranque ------------------------------ */
async function startServer() {
  cargarFuente();
  inicializarSequelize();

  await sequelize!.sync({ alter: true });
  await sembrarUsuariosIniciales();

  // Cada arranque: vacía el catálogo y lo recarga desde la API externa
  log('INFO', '[Inicio] Vaciando catálogo y recargando desde la API externa...');
  await PhoneModel.destroy({ where: {}, truncate: true });
  const result = await poblarBaseDeDatos(LIMITE_CELULARES);
  log('INFO', `[Inicio] Base de datos poblada con ${result.count} registros.`);

  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.use((_req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Servidor Fullstack ejecutándose en http://localhost:${PORT}`);
    console.log(`🗄️  Base de datos: MySQL (${process.env.DB_NAME || 'celulares_db'})`);
    console.log(`❤️  Health check: http://localhost:${PORT}/health`);
    console.log(`📝 Logs en: ${path.join(LOG_DIR, 'app.log')}`);
    console.log(`------------------------------------------------------`);
    console.log('Endpoints disponibles:');
    console.log('- GET    /health                   (Salud del sistema - público)');
    console.log('- POST   /api/auth/login           (Login -> devuelve JWT)');
    console.log('- GET    /api/audits               (Auditoría - Solo Admin)');
    console.log('- GET    /api/phones               (Catálogo)');
    console.log('- GET    /api/phones/:id           (Detalle por ID)');
    console.log('- POST   /api/phones               (Crear - Solo Admin)');
    console.log('- POST   /api/phones/:id/notificar (Notificación manual - Solo Admin)');
    console.log('- PUT    /api/phones/:id           (Actualizar - Solo Admin)');
    console.log('- DELETE /api/phones/:id           (Eliminar - Solo Admin)');
    console.log('- POST   /api/reset-db             (Reset de celulares - Solo Admin)');
    console.log('- GET    /api/status               (Estado de BD - Solo Admin)');
    console.log('- GET    /api/db-tables            (Esquemas y registros - Solo Admin)');
    console.log(`======================================================\n`);
  });
}

// En pruebas (NODE_ENV=test) NO se levanta el servidor: supertest usa `app` directamente
if (!IS_TEST) {
  startServer().catch((err) => { log('ERROR', 'No se pudo iniciar el servidor', err); process.exit(1); });
}

/* Exports para las pruebas de integración */
export { asegurarConexion, sembrarUsuariosIniciales };
export const getModels = () => ({ PhoneModel, UserModel, sequelize });