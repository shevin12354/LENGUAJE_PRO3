# 📱 Proyecto Fullstack - Catálogo de Celulares
Lenguaje de Programación III - Uniremington

Aplicación Fullstack con **Node.js, Express.js, Sequelize (ORM) y MySQL (XAMPP)** en el backend y **React + TailwindCSS** en el frontend. Consume datos reales de la API externa DummyJSON, aplica Inyección de Dependencias y, en el Reto 3, incorpora **observabilidad, hardening de seguridad y pruebas de integración**.

---

## 📋 Requisitos previos

- Node.js 18 o superior
- XAMPP con el módulo **MySQL** iniciado
- Dos bases de datos vacías creadas en phpMyAdmin (`http://localhost/phpmyadmin` → *Nueva*):
  - `celulares_db` (la aplicación)
  - `celulares_test` (las pruebas automáticas)

Las tablas las crea Sequelize automáticamente.

---

## 🚀 Instalación y ejecución

1. Instala las dependencias:
   ```bash
   npm install
   ```
2. Crea el archivo `.env` en la raíz copiando `.env.example` y completa `JWT_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Inicia el servidor:
   ```bash
   npm run dev
   ```
4. Abre `http://localhost:3000`.

**Usuarios iniciales:** `admin` / `123` (Administrador) y `cliente` / `123` (Cliente). Las contraseñas se guardan cifradas con bcrypt.

### Variables de entorno (`.env`)

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (3000) |
| `NODE_ENV` | `development` |
| `DB_NAME`, `DB_USER`, `DB_PASS`, `DB_HOST`, `DB_PORT` | Conexión a MySQL |
| `JWT_SECRET` | Secreto para firmar los tokens (obligatorio) |
| `ALLOWED_ORIGIN` | Orígenes CORS permitidos, separados por coma |
| `PHONES_API_URL` | API externa de celulares |

---

## 📡 Endpoints de la API REST

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/health` | Público | Estado del servicio y de la base de datos |
| POST | `/api/auth/login` | Público | Inicia sesión y devuelve un token JWT |
| GET | `/api/phones` | Público | Catálogo (acepta `?limit=N`) |
| GET | `/api/phones/:id` | Público | Detalle de un celular |
| POST | `/api/phones` | Admin | Crea un celular y notifica a la API externa |
| PUT | `/api/phones/:id` | Admin | Actualiza un celular |
| DELETE | `/api/phones/:id` | Admin | Elimina un celular |
| POST | `/api/phones/:id/notificar` | Admin | Envía el celular a la API externa |
| POST | `/api/reset-db` | Admin | Vacía `phones` y la repuebla desde la API |
| GET | `/api/status` | Admin | Estado de MySQL y tablas |
| GET | `/api/db-tables` | Admin | Esquema y registros de las tablas |
| GET | `/api/audits` | Admin | Historial de auditoría |

Las rutas de Admin requieren el header `Authorization: Bearer <token>`.

---

## 👁️ Reto 3 - Parte 1: Observabilidad

- **Logs de cada petición** con Morgan: método, ruta, código HTTP y tiempo.
  ```
  GET /api/phones 200 33ms
  DELETE /api/phones/1 401 4ms
  ```
- **Errores** registrados con nivel `ERROR` y stacktrace completo (nunca se envía al cliente).
- Los logs se muestran en consola y se guardan en `backend/logs/app.log`.
- **`GET /health`** → `{ "status": "ok", "timestamp": "...", "uptime": "...", "database": "connected" }`. Responde `503` si la base de datos no responde.

---

## 🔒 Reto 3 - Parte 2: Hardening

| # | Vulnerabilidad | Riesgo | Mitigación |
|---|---|---|---|
| 1 | Autenticación falsificable: el rol se leía del header `x-user-role`, que cualquiera puede escribir | Alto | Autenticación con **JWT firmado** (expira en 2 h) y middleware `requerirAdmin` que verifica el token |
| 2 | Credenciales escritas en el código (`root`, contraseña de BD) y contraseñas de usuarios en texto plano | Alto | Variables de entorno en `.env` (fuera del repositorio) y contraseñas con **bcrypt** |
| 3 | CORS abierto a cualquier origen | Medio | **Lista blanca** de orígenes en `ALLOWED_ORIGIN` |

Mitigaciones adicionales: `/api/status`, `/api/db-tables` y `/notificar` ahora exigen administrador; `/api/db-tables` oculta los hashes de contraseña; los errores devuelven un mensaje genérico y el detalle va solo al log; el login valida el tipo de los campos; el formulario de login ya no viene precargado con credenciales.

---

## 🧪 Reto 3 - Parte 3: Pruebas

```bash
npm test
```

Ejecuta **solo las pruebas** (Vitest + Supertest) sobre la base `celulares_test`, sin levantar el servidor. Usa el archivo `.env.test`.

**Pruebas de integración** (`tests/integration.test.ts`):
1. **Create:** `POST /api/phones` devuelve 201 y el dato existe en la BD.
2. **Read:** se guarda un dato en la BD y `GET /api/phones/:id` devuelve exactamente ese dato.
3. **Delete:** se crea un dato, se elimina y `GET` del mismo ID devuelve 404.
4. *(Extra)* Un header `x-user-role` falsificado ya no da acceso (401).
5. *(Extra)* `GET /health` responde `ok`.

**Pruebas unitarias** (`tests/phone-service.test.ts`): estructura JSON, activación del catálogo de respaldo cuando la API falla, y reintento con recuperación.

Archivo `.env.test`:
```dotenv
NODE_ENV=test
DB_NAME=celulares_test
DB_USER=root
DB_PASS=
DB_HOST=localhost
DB_PORT=3306
JWT_SECRET=secreto_solo_para_pruebas
ALLOWED_ORIGIN=http://localhost:3000
```

---

## 🔁 Comportamiento del catálogo

Cada vez que el servidor arranca, y cada vez que el administrador pulsa **Reiniciar base de datos**, la tabla `phones` se vacía y se vuelve a cargar desde la API externa. Si la API no responde, se activa un catálogo de respaldo local. Las tablas `users` y `audits` nunca se tocan.

---

## 📊 Flujo del sistema

```text
 ┌────────────────────────┐
 │  Cliente (Frontend)    │  <-- React / Navegador / Postman
 └───────────┬────────────┘
             │ HTTP + JWT (Authorization: Bearer ...)
             ▼
 ┌────────────────────────┐
 │ Servidor Express.js    │  <-- Logs, CORS, autenticación, validación
 └─────┬────────────┬─────┘
       │ (ORM)      │ (HTTP)
       ▼            ▼
 ┌───────────┐  ┌──────────────────────────────────────┐
 │ Sequelize │  │            APIs Externas             │
 └─────┬─────┘  └──────┬───────────────────────┬───────┘
       │               │ Lectura               │ POST notificación
       │               ▼                       ▼
       │        ┌───────────────┐       ┌──────────────┐
       │        │  DummyJSON    │       │   HttpBin    │
       │        └───────────────┘       └──────────────┘
       ▼
 ┌───────────┐
 │ MySQL DB  │
 └───────────┘
```

---

## 🗄️ Base de datos

- Motor: MySQL (XAMPP) — base `celulares_db`
- `phones`: `id`, `brand`, `phone_name`, `image`, `price`, `stock`, `createdAt`, `updatedAt`
- `users`: `id`, `username`, `password` (hash bcrypt), `role` (`admin` | `user`)
- `audits`: `id`, `action`, `username`, `role`, `details`, `ipAddress`

---

## 🧩 Patrón de Inyección de Dependencias

`PhoneApiService` recibe la función `fetch` por constructor. Esto permite inyectar mocks en las pruebas unitarias sin depender de la red externa. Está documentado en el comentario de `server.ts`.