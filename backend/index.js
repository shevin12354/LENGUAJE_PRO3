/**
 * ============================================================================
 * UNIVERSIDAD REMINGTON - INGENIERÍA DE SISTEMAS
 * Materia: Lenguaje de Programación III
 * Proyecto: Backend Fullstack de Gestión y Catálogo de Celulares
 * Stack: Node.js, Express.js, Sequelize ORM y SQLite
 * ============================================================================
 * Requerimientos y Funcionalidades:
 * 1. Stack Tecnológico: Express.js, Sequelize (ORM) y SQLite (archivo celulares.sqlite).
 * 2. Modelo de Datos: Modelo Phone con campos brand, phone_name, image, price y stock.
 * 3. Consumo de API Externa: DummyJSON (categoría smartphones) al iniciar o poblar.
 * 4. Funcionalidad de Reset: Endpoint POST /api/reset-db que cierra la conexión,
 *    elimina físicamente el archivo celulares.sqlite, lo vuelve a crear con
 *    Sequelize.sync({ force: true }) y lo repuebla automáticamente con la API.
 * 5. Endpoint de Lectura: Endpoint GET /api/phones que retorna los registros en JSON.
 * 6. Inspección de Base de Datos y Tablas:
 *    - GET /api/status: Estado físico del archivo, tamaño y resumen de tablas/columnas.
 *    - GET /api/db-tables: Estructura y registros completos de cada tabla SQLite.
 * 7. CRUD Completo de Celulares:
 *    - POST /api/phones: Crear un nuevo celular.
 *    - PUT /api/phones/:id: Actualizar un celular por su ID.
 *    - DELETE /api/phones/:id: Eliminar un celular por su ID.
 * ============================================================================
 */

const express = require('express');
const cors = require('cors');
const { Sequelize, DataTypes, QueryTypes } = require('sequelize');
const fs = require('fs');
const path = require('path');

// Inicialización de la aplicación Express
const app = express();

// Puerto configurable (por defecto 3001 para no chocar con React/Vite en el 3000)
const PORT = process.env.BACKEND_PORT || process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta absoluta al archivo físico de la base de datos SQLite
const DB_PATH = path.resolve(__dirname, 'celulares.sqlite');
// API pública de productos (categoría smartphones): precio, stock, marca e imagen
const API_URL = process.env.PHONES_API_URL || 'https://dummyjson.com/products/category/smartphones?limit=0';
let fuenteDatos = 'sin cargar'; // 'api' | 'respaldo' (se muestra en /api/status)

// Variables globales para la instancia de Sequelize y el Modelo Phone
let sequelize = null;
let Phone = null;

/**
 * ----------------------------------------------------------------------------
 * 1 y 2. CONFIGURACIÓN DE SEQUELIZE Y DEFINICIÓN DEL MODELO PHONE
 * ----------------------------------------------------------------------------
 */
function inicializarSequelize() {
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: DB_PATH,
    logging: false // Cambiar a console.log para ver las consultas SQL en consola
  });

  // Definición del Modelo Phone (Requerimiento 2)
  Phone = sequelize.define('Phone', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    brand: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Marca del celular (ej. Apple, Samsung, Xiaomi)'
    },
    phone_name: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Nombre comercial del modelo (ej. iPhone 15 Pro, Galaxy S24)'
    },
    image: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'URL de la imagen representativa del teléfono'
    },
    price: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Precio de venta (USD)'
    },
    stock: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Unidades disponibles'
    }
  }, {
    tableName: 'phones',
    timestamps: true
  });

  return { sequelize, Phone };
}

/**
 * ----------------------------------------------------------------------------
 * CATÁLOGO DE RESPALDO (FALLBACK)
 * Solo se usa si la API externa no responde tras 3 intentos.
 * ----------------------------------------------------------------------------
 */
const CATALOGO_RESPALDO = [
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

/**
 * ----------------------------------------------------------------------------
 * 3. CONSUMO DE API EXTERNA Y POBLACIÓN DE DATOS
 * ----------------------------------------------------------------------------
 */
async function obtenerTelefonosDeApi() {
  console.log(`[API Externa] Consultando catálogo público desde: ${API_URL}...`);
  const intentos = 3;
  for (let i = 1; i <= intentos; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(API_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} (${response.statusText})`);

      const json = await response.json();
      // DummyJSON responde: { products: [ { id, title, brand, price, stock, thumbnail, ... } ], total, ... }
      if (!json || !Array.isArray(json.products) || json.products.length === 0) {
        throw new Error('La respuesta no contiene la lista "products" esperada.');
      }

      const telefonos = json.products.map((p) => ({
        brand: p.brand || String(p.title || '').split(' ')[0] || 'Genérica',
        phone_name: p.title || 'Teléfono sin nombre',
        image: p.thumbnail || (Array.isArray(p.images) ? p.images[0] : '') || '',
        price: typeof p.price === 'number' ? p.price : null,
        stock: Number.isInteger(p.stock) ? p.stock : null
      }));

      fuenteDatos = 'api';
      console.log(`[API Externa] Éxito: ${telefonos.length} teléfonos obtenidos de la API.`);
      return telefonos;
    } catch (error) {
      console.warn(`[API Externa] Intento ${i}/${intentos} falló: ${error.message}`);
      if (i < intentos) await new Promise((r) => setTimeout(r, 1500 * i));
    } finally {
      clearTimeout(timeout);
    }
  }

  fuenteDatos = 'respaldo';
  console.log('[API Fallback] Utilizando catálogo de respaldo local.');
  return CATALOGO_RESPALDO;
}

/**
 * Inserta los teléfonos obtenidos en la base de datos SQLite
 */
async function poblarBaseDeDatos() {
  const telefonos = await obtenerTelefonosDeApi();
  if (telefonos && telefonos.length > 0) {
    await Phone.bulkCreate(telefonos);
    console.log(`[Base de Datos] Se insertaron ${telefonos.length} registros exitosamente en 'celulares.sqlite'.`);
    return telefonos.length;
  }
  return 0;
}

/**
 * Garantiza que la conexión y el modelo estén listos (por si el servidor
 * quedó sin instancia tras un reset fallido).
 */
async function asegurarConexion() {
  if (!sequelize || !Phone) {
    inicializarSequelize();
    await sequelize.sync();
  }
}

/**
 * Elimina físicamente el archivo SQLite (y sus archivos auxiliares).
 * `maxRetries` reintenta si Windows aún tiene el archivo bloqueado (EBUSY/EPERM),
 * lo que reemplaza la pausa fija de 500 ms.
 */
async function eliminarArchivosDb() {
  for (const sufijo of ['', '-journal', '-wal', '-shm']) {
    await fs.promises.rm(DB_PATH + sufijo, { force: true, maxRetries: 10, retryDelay: 200 });
  }
}

/**
 * ----------------------------------------------------------------------------
 * VALIDACIÓN DE DATOS DE ENTRADA (POST / PUT)
 * Evita errores 500 por tipos inválidos y guarda solo texto limpio.
 * ----------------------------------------------------------------------------
 */
function validarTelefono(body, { parcial = false } = {}) {
  const errores = [];
  const datos = {};
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

/** Convierte :id en entero positivo o devuelve null si no es válido. */
function leerId(valor) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * ----------------------------------------------------------------------------
 * ENDPOINTS DE LA API REST
 * ----------------------------------------------------------------------------
 */

// Mientras la BD se destruye y recrea, se rechazan las demás peticiones de /api.
// Sin esto, una petición concurrente re-abría el archivo y el reset podía fallar.
let reiniciando = false;
app.use('/api', (req, res, next) => {
  if (reiniciando) {
    return res.status(503).json({
      success: false,
      error: 'La base de datos se está reiniciando. Intenta de nuevo en unos segundos.'
    });
  }
  next();
});

// Endpoint de prueba inicial
app.get('/', (req, res) => {
  res.json({
    mensaje: 'API REST de Celulares - Uniremington Lenguaje de Programación III',
    estado: 'Servidor activo',
    endpoints: {
      obtenerCelulares: 'GET /api/phones',
      crearCelular: 'POST /api/phones',
      actualizarCelular: 'PUT /api/phones/:id',
      eliminarCelular: 'DELETE /api/phones/:id',
      resetearBaseDeDatos: 'POST /api/reset-db',
      estadoBaseDeDatos: 'GET /api/status',
      tablasBaseDeDatos: 'GET /api/db-tables'
    }
  });
});

/**
 * 5. ENDPOINT DE LECTURA (GET /api/phones)
 * Devuelve todos los registros de celulares almacenados en SQLite en formato JSON.
 */
app.get('/api/phones', async (req, res) => {
  try {
    await asegurarConexion();
    const phones = await Phone.findAll({ order: [['id', 'ASC']] });
    res.json({ success: true, total: phones.length, data: phones });
  } catch (error) {
    console.error('Error al consultar /api/phones:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno al consultar los celulares en la base de datos.',
      details: error.message
    });
  }
});

/**
 * 4. FUNCIONALIDAD DE RESET (POST /api/reset-db)
 * - Cierra la conexión activa de Sequelize (liberando locks del archivo SQLite).
 * - Elimina físicamente el archivo 'celulares.sqlite'.
 * - Vuelve a instanciar y sincronizar Sequelize con { force: true }.
 * - Repuebla automáticamente la base de datos consumiendo la API externa.
 */
app.post('/api/reset-db', async (req, res) => {
  console.log('\n[Reset DB] Iniciando autodestrucción y recreación...');
  reiniciando = true;
  try {
    // Paso 1: Cerrar la conexión actual
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
      Phone = null;
    }

    // Paso 2: Eliminar físicamente el archivo (con reintentos si está bloqueado)
    await eliminarArchivosDb();
    console.log('[Reset DB] Archivo SQLite eliminado físicamente con éxito.');

    // Paso 3: Reinicializar y recrear las tablas con force: true
    inicializarSequelize();
    await sequelize.sync({ force: true });

    // Paso 4: Repoblar automáticamente
    const cantidadInsertados = await poblarBaseDeDatos();

    res.json({
      success: true,
      message: 'Base de datos autodestruida, recreada físicamente y repoblada exitosamente.',
      registrosCreados: cantidadInsertados,
      fuenteDatos
    });
  } catch (error) {
    console.error('[Reset DB Error]:', error);
    res.status(500).json({ success: false, error: 'Error al resetear la base de datos.', details: error.message });
  } finally {
    reiniciando = false;
  }
});

/**
 * ----------------------------------------------------------------------------
 * 6. ENDPOINT DE STATUS DE LA BASE DE DATOS Y RESUMEN DE TABLAS (GET /api/status)
 * Permite verificar el estado del archivo SQLite, conexión y listado de tablas.
 * ----------------------------------------------------------------------------
 */
app.get('/api/status', async (req, res) => {
  try {
    await asegurarConexion();

    const existeArchivo = fs.existsSync(DB_PATH);
    let tamanoBytes = 0;
    if (existeArchivo) {
      const stats = fs.statSync(DB_PATH);
      tamanoBytes = stats.size;
    }

    // Consulta de tablas existentes usando QueryTypes.SELECT
    const tablesInfo = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      { type: QueryTypes.SELECT }
    );

    const tableNames = tablesInfo.map(t => t.name);
    const tablasResumen = [];
    let totalAcumulado = 0;

    for (const tableName of tableNames) {
      const columns = await sequelize.query(`PRAGMA table_info("${tableName}")`, {
        type: QueryTypes.SELECT
      });

      const countResult = await sequelize.query(`SELECT COUNT(*) as count FROM "${tableName}"`, {
        type: QueryTypes.SELECT
      });
      const count = countResult[0] ? countResult[0].count : 0;
      totalAcumulado += count;

      tablasResumen.push({
        nombre: tableName,
        totalRegistros: count,
        columnas: columns.map(c => c.name)
      });
    }

    res.json({
      success: true,
      estado: 'Conectada y operativa',
      baseDeDatos: {
        archivo: path.basename(DB_PATH),
        rutaCompleta: DB_PATH,
        existeFisicamente: existeArchivo,
        tamanoBytes: tamanoBytes,
        tamanoLegible: (tamanoBytes / 1024).toFixed(2) + ' KB'
      },
      tablas: tablasResumen,
      totalTablas: tableNames.length,
      totalRegistros: totalAcumulado,
      motor: 'SQLite3 + Sequelize ORM v6',
      fuenteDatos,
      tiempoServidor: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error en /api/status:', error);
    res.status(500).json({
      success: false,
      error: 'Error al consultar el estado de la base de datos.',
      details: error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 7. ENDPOINT DE CONSULTA DE TABLAS Y SUS REGISTROS (GET /api/db-tables)
 * Devuelve todas las tablas de SQLite con su estructura y filas completas.
 * ----------------------------------------------------------------------------
 */
app.get('/api/db-tables', async (req, res) => {
  try {
    await asegurarConexion();

    // 1. Obtener nombres de las tablas de usuario
    const tablesInfo = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      { type: QueryTypes.SELECT }
    );

    const tableNames = tablesInfo.map(t => t.name);
    const dbView = {};
    const detalleTablas = {};

    // 2. Extraer registros y columnas de cada tabla
    for (const table of tableNames) {
      const columns = await sequelize.query(`PRAGMA table_info("${table}")`, {
        type: QueryTypes.SELECT
      });

      const rows = await sequelize.query(`SELECT * FROM "${table}"`, {
        type: QueryTypes.SELECT
      });

      dbView[table] = rows || [];
      detalleTablas[table] = {
        totalRegistros: rows.length,
        columnas: columns.map(col => ({
          campo: col.name,
          tipo: col.type,
          clavePrimaria: Boolean(col.pk),
          noNulo: Boolean(col.notnull)
        })),
        registros: rows || []
      };
    }

    res.json({
      success: true,
      database: path.basename(DB_PATH),
      tablas: tableNames,
      tables: dbView,
      detalleTablas: detalleTablas,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error al consultar tablas de la base de datos (GET /api/db-tables):', error);
    res.status(500).json({
      success: false,
      error: 'Error interno al consultar las tablas de la base de datos.',
      details: error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 8. CRUD DE CELULARES (POST, PUT, DELETE)
 * ----------------------------------------------------------------------------
 */

// Crear: POST /api/phones
app.post('/api/phones', async (req, res) => {
  try {
    await asegurarConexion();
    const { errores, datos } = validarTelefono(req.body);
    if (errores.length > 0) {
      return res.status(400).json({ success: false, error: 'Validación fallida.', details: errores });
    }

    const nuevoTelefono = await Phone.create(datos);
    res.status(201).json({
      success: true,
      message: 'Teléfono registrado exitosamente en la base de datos.',
      data: nuevoTelefono
    });
  } catch (error) {
    console.error('Error al registrar teléfono (POST /api/phones):', error);
    res.status(500).json({ success: false, error: 'Error interno al registrar el teléfono.', details: error.message });
  }
});

// Actualizar: PUT /api/phones/:id (acepta cambios parciales; permite vaciar la imagen)
app.put('/api/phones/:id', async (req, res) => {
  try {
    await asegurarConexion();
    const id = leerId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, error: 'El id debe ser un número entero positivo.' });
    }

    const { errores, datos } = validarTelefono(req.body, { parcial: true });
    if (errores.length > 0) {
      return res.status(400).json({ success: false, error: 'Validación fallida.', details: errores });
    }
    if (Object.keys(datos).length === 0) {
      return res.status(400).json({ success: false, error: 'No se enviaron campos para actualizar.' });
    }

    const telefono = await Phone.findByPk(id);
    if (!telefono) {
      return res.status(404).json({ success: false, error: `No se encontró el teléfono con id=${id}.` });
    }

    await telefono.update(datos); // una sola actualización (antes eran hasta 3)
    res.json({ success: true, message: 'Teléfono actualizado exitosamente.', data: telefono });
  } catch (error) {
    console.error('Error al actualizar teléfono (PUT /api/phones/:id):', error);
    res.status(500).json({ success: false, error: 'Error interno al actualizar el teléfono.', details: error.message });
  }
});

// Eliminar: DELETE /api/phones/:id
app.delete('/api/phones/:id', async (req, res) => {
  try {
    await asegurarConexion();
    const id = leerId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, error: 'El id debe ser un número entero positivo.' });
    }

    const telefono = await Phone.findByPk(id);
    if (!telefono) {
      return res.status(404).json({ success: false, error: `No se encontró el teléfono con id=${id}.` });
    }

    await telefono.destroy();
    res.json({ success: true, message: `Teléfono con id=${id} eliminado correctamente.`, data: { id } });
  } catch (error) {
    console.error('Error al eliminar teléfono (DELETE /api/phones/:id):', error);
    res.status(500).json({ success: false, error: 'Error interno al eliminar el teléfono.', details: error.message });
  }
});

/**
 * ----------------------------------------------------------------------------
 * MANEJO DE ERRORES: rutas /api inexistentes y JSON mal formado
 * ----------------------------------------------------------------------------
 */
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'El cuerpo de la petición no es un JSON válido.' });
  }
  console.error('Error no controlado:', err);
  res.status(500).json({ success: false, error: 'Error interno del servidor.' });
});

/**
 * ----------------------------------------------------------------------------
 * ARRANQUE DEL SERVIDOR Y VERIFICACIÓN INICIAL
 * ----------------------------------------------------------------------------
 */
async function iniciarServidor() {
  try {
    inicializarSequelize();

    await sequelize.sync();

    const total = await Phone.count();
    if (total === 0) {
      console.log('[Inicio] La base de datos está vacía. Poblando catálogo inicial...');
      await poblarBaseDeDatos();
    } else {
      console.log(`[Inicio] Base de datos conectada. Registros existentes: ${total}`);
    }

    const server = app.listen(PORT, () => {
      console.log('\n============================================================');
      console.log(`🚀 Servidor backend escuchando en: http://localhost:${PORT}`);
      console.log(`📁 Base de datos SQLite: ${DB_PATH}`);
      console.log(`📦 Catálogo:          GET  http://localhost:${PORT}/api/phones`);
      console.log(`📊 Estado BD y Tablas:GET  http://localhost:${PORT}/api/status`);
      console.log(`📋 Tablas y Datos:    GET  http://localhost:${PORT}/api/db-tables`);
      console.log(`⚡ Endpoint Reset:     POST http://localhost:${PORT}/api/reset-db`);
      console.log('============================================================\n');
    });

    server.on('error', (err) => {
      console.error(err.code === 'EADDRINUSE'
        ? `El puerto ${PORT} ya está en uso. Cierra el otro proceso o cambia BACKEND_PORT.`
        : err);
      process.exit(1);
    });

    // Cierre limpio con Ctrl+C: libera el archivo SQLite
    process.on('SIGINT', async () => {
      server.close();
      if (sequelize) await sequelize.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('Error fatal al iniciar el servidor backend:', error);
    process.exit(1);
  }
}

// Ejecutar arranque
iniciarServidor();