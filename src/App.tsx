import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Smartphone, Database, RefreshCw, Trash2, Search, LayoutGrid, Table as TableIcon,
  Terminal, Play, Plus, Pencil, X, CheckCircle2, AlertCircle, Layers, Zap,
  LogOut, Lock, History
} from 'lucide-react';

/* ----------------------------- Tipos ----------------------------- */
interface Phone {
  id: number;
  brand: string;
  phone_name: string;
  image: string | null;
  price: number | null;
  stock: number | null;
}

interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

interface DbStatus {
  fuenteDatos?: string;
  baseDeDatos: { motor?: string; archivo?: string; tamanoLegible?: string };
  tablas: { nombre: string; totalRegistros: number; columnas: string[] }[];
  totalTablas: number;
  totalRegistros: number;
}

interface DbTables {
  tablas: string[];
  detalleTablas: Record<
    string,
    {
      totalRegistros: number;
      columnas: { campo: string; tipo: string; clavePrimaria: boolean }[];
      registros: Record<string, unknown>[];
    }
  >;
}

interface TestResult {
  method: string;
  path: string;
  status: number;
  ms: number;
  body: string;
}

interface AuditLog {
  id: number;
  action: string;
  username: string;
  role: string;
  details: string;
  createdAt: string;
}

type Tab = 'catalog' | 'db-tables' | 'api-tester' | 'audits';
type PhoneForm = { brand: string; phone_name: string; image: string; price: string; stock: string };
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/* --------------------------- Componentes --------------------------- */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-100">{title}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PhoneImage({ src, alt, className }: { src: string | null; alt: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="text-slate-600 flex flex-col items-center gap-1">
        <Smartphone className="w-10 h-10" />
        <span className="text-[10px]">Sin imagen</span>
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} loading="lazy" onError={() => setFailed(true)} />;
}

function StatCard({ icon, label, value, hint }: { icon: ReactNode; label: string; value: ReactNode; hint: string }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-3.5 py-2.5 min-w-0">
      <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">{icon}<span>{label}</span></div>
      <div className="font-mono text-sm font-semibold text-slate-200 truncate">{value}</div>
      <div className="text-[11px] text-slate-400 truncate">{hint}</div>
    </div>
  );
}

/* ------------------------------ App Principal ------------------------------- */
export default function App() {
  // Estado de Sesión y Usuario (HARDENING: ahora la sesión incluye un token JWT)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'));
  const [user, setUser] = useState<AuthUser | null>(() => {
    const saved = localStorage.getItem('auth_user');
    if (!saved || !localStorage.getItem('auth_token')) return null;
    try { return JSON.parse(saved); } catch { return null; }
  });
  // HARDENING: sin credenciales precargadas en el formulario
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Estados del Catálogo y Sistema
  const [phones, setPhones] = useState<Phone[]>([]);
  const [totalDb, setTotalDb] = useState(0);
  const [limitInput, setLimitInput] = useState('');
  const [limit, setLimit] = useState<number | 'all'>('all');
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [dbTables, setDbTables] = useState<DbTables | null>(null);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const [tab, setTab] = useState<Tab>('catalog');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('Todas');

  // Formulario Crear / Editar
  const [editing, setEditing] = useState<Phone | 'new' | null>(null);
  const [form, setForm] = useState<PhoneForm>({ brand: '', phone_name: '', image: '', price: '', stock: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [toDelete, setToDelete] = useState<Phone | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Reset BD
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetLimit, setResetLimit] = useState('');
  const resetLimitValido = resetLimit === '' || (Number.isInteger(Number(resetLimit)) && Number(resetLimit) >= 0 && Number(resetLimit) <= 1000);
  const [resetting, setResetting] = useState(false);

  // Probador de API (Endpoints)
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const esAdmin = user?.role === 'admin';

  const notify = (text: string, ok = true) => {
    setToast({ text, ok });
    window.setTimeout(() => setToast(null), 4000);
  };

  const cerrarSesionLocal = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('auth_user');
    localStorage.removeItem('auth_token');
  }, []);

  /* ------------------- Cliente de API ------------------- */
  const api = useCallback(async <T = any>(path: string, init?: RequestInit): Promise<T> => {
    let res: Response;
    try {
      // HARDENING: se envía el token JWT; ya no se mandan headers x-user-* falsificables
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };
      res = await fetch(path, {
        ...init,
        headers: { ...headers, ...init?.headers }
      });
    } catch {
      throw new Error('No se pudo conectar con el backend. ¿Está encendido el servidor?');
    }

    const data = await res.json().catch(() => null);
    if (!data) throw new Error(`El backend no respondió con JSON (HTTP ${res.status}).`);

    // Token vencido o inválido: se cierra la sesión local
    if (res.status === 401 && token) {
      cerrarSesionLocal();
    }

    if (!res.ok || data.success === false) {
      const detalle = Array.isArray(data.details) ? ` ${data.details.join(' ')}` : '';
      throw new Error((data.error ?? `Error HTTP ${res.status}`) + detalle);
    }
    return data as T;
  }, [token, cerrarSesionLocal]);

  /** Carga catálogo y, solo si es administrador, estado, tablas y auditorías */
  const loadData = useCallback(async (skeleton = true) => {
    if (skeleton) setLoading(true);
    try {
      setError('');
      const phonesRes = await api<{ data: Phone[]; total: number }>(
        limit === 'all' ? '/api/phones' : `/api/phones?limit=${limit}`
      );
      setPhones(phonesRes.data ?? []);
      setTotalDb(phonesRes.total ?? 0);

      if (user?.role === 'admin') {
        const [statusRes, tablesRes, auditsRes] = await Promise.all([
          api<DbStatus>('/api/status'),
          api<DbTables>('/api/db-tables'),
          api<{ data: AuditLog[] }>('/api/audits')
        ]);
        setStatus(statusRes);
        setDbTables(tablesRes);
        setAudits(auditsRes.data ?? []);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, limit, user]);

  useEffect(() => {
    if (user) loadData();
  }, [user, loadData]);

  // Si el usuario cambia el input de límite
  useEffect(() => {
    const t = window.setTimeout(() => {
      const n = Number(limitInput);
      setLimit(limitInput.trim() === '' || !Number.isInteger(n) || n < 1 ? 'all' : Math.min(n, 1000));
    }, 500);
    return () => window.clearTimeout(t);
  }, [limitInput]);

  const brands = ['Todas', ...Array.from(new Set(phones.map((p) => p.brand))).filter(Boolean).sort()];

  useEffect(() => {
    if (!brands.includes(selectedBrand)) setSelectedBrand('Todas');
  }, [brands, selectedBrand]);

  const term = searchTerm.trim().toLowerCase();
  const filteredPhones = phones.filter(
    (p) =>
      (selectedBrand === 'Todas' || p.brand === selectedBrand) &&
      (p.phone_name.toLowerCase().includes(term) || p.brand.toLowerCase().includes(term))
  );

  /* ------------------- Manejo de Login y Logout ------------------- */
  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Credenciales incorrectas');
      }

      setToken(data.token);
      setUser(data.user);
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('auth_user', JSON.stringify(data.user));
      setLoginPassword('');
      notify(`Bienvenido ${data.user.username} (${data.user.role === 'admin' ? 'Administrador' : 'Cliente'})`);
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    cerrarSesionLocal();
    setTab('catalog');
    notify('Sesión cerrada');
  };

  /* ------------------------ Crear / Editar ------------------------ */
  const openCreate = () => {
    setForm({ brand: selectedBrand !== 'Todas' ? selectedBrand : '', phone_name: '', image: '', price: '', stock: '' });
    setFormError('');
    setEditing('new');
  };

  const openEdit = (p: Phone) => {
    setForm({ brand: p.brand, phone_name: p.phone_name, image: p.image ?? '', price: p.price?.toString() ?? '', stock: p.stock?.toString() ?? '' });
    setFormError('');
    setEditing(p);
  };

  const closeForm = useCallback(() => setEditing(null), []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setFormError('');
    try {
      const body = JSON.stringify({
        brand: form.brand.trim(),
        phone_name: form.phone_name.trim(),
        image: form.image.trim(),
        price: form.price.trim(),
        stock: form.stock.trim()
      });
      if (editing === 'new') {
        await api('/api/phones', { method: 'POST', body });
        notify('Celular agregado correctamente (Código 201 Created).');
      } else {
        await api(`/api/phones/${editing.id}`, { method: 'PUT', body });
        notify('Celular actualizado correctamente (Código 200 OK).');
      }
      setEditing(null);
      await loadData(false);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /* ----------------------------- Eliminar ----------------------------- */
  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/api/phones/${toDelete.id}`, { method: 'DELETE' });
      notify(`"${toDelete.phone_name}" eliminado (Código 200 OK).`);
      setToDelete(null);
      await loadData(false);
    } catch (err) {
      notify((err as Error).message, false);
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  /* ------------------------------ Reset ------------------------------ */
  const handleReset = async () => {
    setConfirmReset(false);
    setResetting(true);
    try {
      const data = await api<{ registrosCreados: number }>('/api/reset-db', {
        method: 'POST',
        body: JSON.stringify({ limit: resetLimit === '' ? 0 : Number(resetLimit) })
      });
      notify(`Base de datos recreada con ${data.registrosCreados} celulares.`);
      await loadData();
    } catch (err) {
      notify((err as Error).message, false);
    } finally {
      setResetting(false);
    }
  };

  /* ------------------------- Probador de API (Endpoints) ------------------------- */
  const runTest = async (method: string, path: string) => {
    setTesting(true);
    const t0 = performance.now();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };
      const res = await fetch(path, { method, headers });
      const text = await res.text();
      let body = text;
      try { body = JSON.stringify(JSON.parse(text), null, 2); } catch { /* no era JSON */ }
      setTestResult({ method, path, status: res.status, ms: Math.round(performance.now() - t0), body });
      if (method === 'POST') await loadData(false);
    } catch (err) {
      setTestResult({ method, path, status: 0, ms: 0, body: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const tabClass = (t: Tab) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
      tab === t ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
    }`;

  const iconBtn =
    'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition';

  const endpoints = [
    { method: 'GET', path: '/health', desc: 'Salud del sistema (público)', color: 'emerald' },
    { method: 'GET', path: '/api/phones', desc: 'Catálogo de celulares', color: 'blue' },
    { method: 'GET', path: '/api/status', desc: 'Estado de MySQL y tablas', color: 'emerald' },
    { method: 'GET', path: '/api/db-tables', desc: 'Todas las tablas y filas', color: 'cyan' },
    { method: 'GET', path: '/api/audits', desc: 'Historial de auditoría', color: 'amber' }
  ];


  /* ------------------- SI NO HA INICIADO SESIÓN: PANTALLA LOGIN LIMPIA ------------------- */
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-500 mx-auto flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Lock className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-xl font-extrabold text-white tracking-tight">Iniciar Sesión</h2>
            <p className="text-xs text-slate-400">Ingresa tus credenciales para acceder</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1.5">Usuario</label>
              <input
                type="text"
                required
                autoFocus
                placeholder="Nombre de usuario"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1.5">Contraseña</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
              />
            </div>

            {loginError && (
              <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/60 p-2.5 rounded-xl">
                {loginError}
              </p>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition shadow-lg shadow-indigo-600/30 disabled:opacity-50 mt-2"
            >
              {loginLoading ? 'Verificando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* ------------------- APLICACIÓN PRINCIPAL ------------------- */
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Encabezado */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Smartphone className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                Catálogo de Celulares <span className="text-slate-400 font-normal text-sm">| Express + Sequelize + MySQL</span>
              </h1>
              <p className="text-[11px] text-slate-400">Uniremington • Lenguaje de Programación III</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Pestañas de Navegación */}
            <nav className="flex items-center gap-1.5 bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
              <button onClick={() => setTab('catalog')} className={tabClass('catalog')}>
                <LayoutGrid className="w-3.5 h-3.5" /> Catálogo ({phones.length})
              </button>

              {esAdmin && (
                <>
                  <button onClick={() => setTab('db-tables')} className={tabClass('db-tables')}>
                    <Database className="w-3.5 h-3.5 text-cyan-400" /> Tablas BD
                  </button>
                  <button onClick={() => setTab('api-tester')} className={tabClass('api-tester')}>
                    <Terminal className="w-3.5 h-3.5" /> Endpoints
                  </button>
                  <button onClick={() => setTab('audits')} className={tabClass('audits')}>
                    <History className="w-3.5 h-3.5 text-amber-400" /> Auditoría ({audits.length})
                  </button>
                </>
              )}
            </nav>

            {/* Indicador de Usuario y Cerrar Sesión */}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <div className="text-right">
                <div className="text-xs font-bold text-slate-200">{user.username}</div>
                <div className={`text-[10px] font-semibold uppercase ${esAdmin ? 'text-amber-400' : 'text-cyan-400'}`}>
                  {esAdmin ? '🛡️ Administrador' : '👤 Cliente'}
                </div>
              </div>
              <button
                onClick={handleLogout}
                title="Cerrar sesión"
                className="p-2 rounded-xl bg-slate-800 hover:bg-red-950/50 hover:text-red-400 text-slate-400 border border-slate-700 transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Panel Superior Dinámico: Técnico para Admin / Tienda Comercial para Cliente */}
        <section className="bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/40 rounded-2xl p-5 border border-slate-800 shadow-xl">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">

            {esAdmin ? (
              /* ================== VISTA EXCLUSIVA ADMINISTRADOR ================== */
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full lg:w-auto">
                <StatCard
                  icon={<Database className="w-3.5 h-3.5 text-cyan-400" />}
                  label="Base de datos"
                  value="celulares_db (MySQL)"
                  hint="XAMPP / InnoDB"
                />
                <StatCard
                  icon={<Layers className="w-3.5 h-3.5 text-indigo-400" />}
                  label="Tablas"
                  value={status ? status.tablas.map((t) => t.nombre).join(', ') || '—' : 'phones, users, audits'}
                  hint={`${status?.totalTablas ?? 3} tablas activas`}
                />
                <StatCard
                  icon={<Smartphone className="w-3.5 h-3.5 text-purple-400" />}
                  label="Registros"
                  value={<span className="text-xl font-extrabold text-indigo-400">{phones.length}</span>}
                  hint="Modelo: Phone"
                />
                <StatCard
                  icon={<Zap className="w-3.5 h-3.5 text-amber-400" />}
                  label="Fuente de datos"
                  value={status?.fuenteDatos === 'api' ? 'API: dummyjson.com' : 'Consumo / Respaldo'}
                  hint="Conexión activa"
                />
              </div>
            ) : (
              /* ================== VISTA COMERCIAL PARA EL CLIENTE ================== */
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-cyan-400 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/20">
                  <Smartphone className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Disponibilidad Inmediata
                    </span>
                    <span className="text-slate-500 text-xs">• Precios en USD</span>
                  </div>
                  <h2 className="text-base font-extrabold text-white mt-0.5">
                    ¡Bienvenido a nuestro catálogo oficial de celulares!
                  </h2>
                  <p className="text-xs text-slate-400">
                    Explora los últimos lanzamientos, compara marcas y consulta stock disponible con garantía de fábrica.
                  </p>
                </div>
              </div>
            )}

            {/* Botones de acción */}
            <div className="flex flex-wrap items-center gap-3 justify-end shrink-0">
              <button
                onClick={() => loadData()}
                disabled={loading || resetting}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar catálogo
              </button>

              {/* Botones administrativos (SOLO ADMIN) */}
              {esAdmin && (
                <>
                  <button
                    onClick={() => setConfirmReset(true)}
                    disabled={resetting}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-white text-xs font-bold border border-rose-500/40 transition disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    {resetting ? 'Reiniciando...' : 'Reiniciar base de datos'}
                  </button>
                  <button
                    onClick={openCreate}
                    disabled={resetting}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" /> Agregar celular
                  </button>
                </>
              )}
            </div>

          </div>
        </section>

        {error && (
          <div role="alert" className="flex items-start gap-2 p-4 rounded-xl border border-red-800/80 bg-red-950/40 text-red-200 text-xs">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
            <button onClick={() => loadData()} className="underline font-semibold">Reintentar</button>
          </div>
        )}

        {/* ---------------------------- PESTAÑA: CATÁLOGO ---------------------------- */}
        {tab === 'catalog' && (
          <div className="space-y-5">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800/80">
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  aria-label="Buscar celular"
                  placeholder="Buscar modelo o marca..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 md:pb-0">
                {brands.map((b) => (
                  <button
                    key={b}
                    onClick={() => setSelectedBrand(b)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                      selectedBrand === b
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800/70 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/40'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
                Mostrar
                <input
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={limitInput}
                  onChange={(e) => setLimitInput(e.target.value)}
                  placeholder="Todos"
                  aria-label="Cantidad de celulares a mostrar"
                  className="w-20 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                <span className="text-slate-500">({phones.length} de {totalDb})</span>
              </label>

              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0">
                {([['grid', LayoutGrid, 'Vista cuadrícula'], ['table', TableIcon, 'Vista tabla']] as const).map(([mode, Icon, label]) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    title={label}
                    aria-label={label}
                    className={`p-1.5 rounded-lg transition ${viewMode === mode ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 animate-pulse space-y-3">
                    <div className="h-44 bg-slate-800/60 rounded-xl" />
                    <div className="h-4 bg-slate-800/80 rounded w-1/3" />
                    <div className="h-5 bg-slate-800 rounded w-4/5" />
                  </div>
                ))}
              </div>
            ) : filteredPhones.length === 0 ? (
              <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800/80 p-8 space-y-4">
                <Smartphone className="w-10 h-10 mx-auto text-slate-500" />
                <h3 className="text-base font-bold text-slate-200">
                  {phones.length === 0 ? 'No hay celulares registrados' : 'Ningún celular coincide con los filtros'}
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  {phones.length === 0
                    ? 'Agrega uno nuevo o reinicia la base de datos para cargar el catálogo.'
                    : 'Prueba con otra búsqueda o selecciona otra marca.'}
                </p>
                {phones.length === 0 && esAdmin && (
                  <button onClick={openCreate} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">
                    Agregar celular
                  </button>
                )}
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredPhones.map((p) => (
                  <article
                    key={p.id}
                    className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/80 hover:border-indigo-500/40 rounded-2xl p-4 flex flex-col justify-between transition shadow-md"
                  >
                    <div>
                      <div className="w-full h-48 bg-slate-950/80 rounded-xl mb-3 flex items-center justify-center overflow-hidden border border-slate-800/60 relative">
                        <PhoneImage src={p.image} alt={p.phone_name} className="max-h-40 max-w-full object-contain p-2" />
                        <span className="absolute top-2.5 left-2.5 text-[10px] font-mono font-bold bg-slate-900/90 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700/60">
                          #{p.id}
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-md border border-indigo-500/20">
                        {p.brand}
                      </span>
                      <h4 className="text-sm font-bold text-slate-100 mt-2 line-clamp-2">{p.phone_name}</h4>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-base font-extrabold text-emerald-400">
                          {p.price != null ? usd.format(p.price) : 'Sin precio'}
                        </span>
                        <span className={`text-[11px] font-semibold ${p.stock === 0 ? 'text-red-400' : 'text-slate-400'}`}>
                          {p.stock == null ? '' : p.stock === 0 ? 'Agotado' : `${p.stock} disponibles`}
                        </span>
                      </div>
                    </div>

                    {/* Botones de acción: SOLO VISIBLES PARA EL ADMINISTRADOR */}
                    {esAdmin && (
                      <div className="mt-4 pt-3 border-t border-slate-800/60 flex gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className={`${iconBtn} flex-1 justify-center bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200`}
                        >
                          <Pencil className="w-3.5 h-3.5" /> Editar
                        </button>
                        <button
                          onClick={() => setToDelete(p)}
                          className={`${iconBtn} flex-1 justify-center bg-transparent hover:bg-red-950/50 border-red-900/60 text-red-300`}
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Eliminar
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden shadow-lg overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/80 text-slate-400 text-[11px] border-b border-slate-800 font-semibold">
                    <tr>
                      <th className="py-3 px-4">ID</th>
                      <th className="py-3 px-4">Foto</th>
                      <th className="py-3 px-4">Marca</th>
                      <th className="py-3 px-4">Modelo</th>
                      <th className="py-3 px-4">Precio</th>
                      <th className="py-3 px-4">Stock</th>
                      <th className="py-3 px-4">URL de imagen</th>
                      {esAdmin && <th className="py-3 px-4 text-right">Acciones (Admin)</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredPhones.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 px-4 font-mono font-bold text-indigo-400">#{p.id}</td>
                        <td className="py-3 px-4">
                          <div className="w-10 h-10 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-center overflow-hidden">
                            <PhoneImage src={p.image} alt={p.phone_name} className="w-full h-full object-contain p-0.5" />
                          </div>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-100">{p.brand}</td>
                        <td className="py-3 px-4 text-slate-200">{p.phone_name}</td>
                        <td className="py-3 px-4 text-emerald-400 font-semibold">{p.price != null ? usd.format(p.price) : '—'}</td>
                        <td className="py-3 px-4">{p.stock ?? '—'}</td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-400 truncate max-w-xs">{p.image || '—'}</td>
                        {esAdmin && (
                          <td className="py-3 px-4">
                            <div className="flex justify-end gap-2">
                              <button onClick={() => openEdit(p)} className={`${iconBtn} bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200`}>
                                <Pencil className="w-3.5 h-3.5" /> Editar
                              </button>
                              <button onClick={() => setToDelete(p)} className={`${iconBtn} hover:bg-red-950/50 border-red-900/60 text-red-300`}>
                                <Trash2 className="w-3.5 h-3.5" /> Eliminar
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ------------------------- PESTAÑA: TABLAS BD ------------------------- */}
        {tab === 'db-tables' && esAdmin && (
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 space-y-5 shadow-xl">
            <div className="border-b border-slate-800/80 pb-4">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Database className="w-5 h-5 text-cyan-400" /> Tablas en MySQL (XAMPP - celulares_db)
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Datos de <code className="text-indigo-300">GET /api/db-tables</code>. Visualización de todas las tablas y esquemas reales.
              </p>
            </div>

            {dbTables && dbTables.tablas.length > 0 ? (
              dbTables.tablas.map((table) => {
                const detail = dbTables.detalleTablas[table];
                return (
                  <div key={table} className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
                    <div className="bg-slate-900/90 px-4 py-3 border-b border-slate-800 flex flex-wrap items-center gap-3">
                      <span className="text-xs font-mono font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded">
                        {table}
                      </span>
                      <span className="text-xs text-slate-400">{detail.totalRegistros} filas</span>
                    </div>
                    <div className="px-4 py-2.5 border-b border-slate-800/60 flex flex-wrap gap-2 text-[11px] font-mono">
                      {detail.columnas.map((c) => (
                        <span
                          key={c.campo}
                          className={`px-2 py-0.5 rounded border ${
                            c.clavePrimaria ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-slate-800/80 border-slate-700/60 text-slate-300'
                          }`}
                        >
                          {c.campo} <span className="text-slate-500">({c.tipo})</span>
                          {c.clavePrimaria && ' [PK]'}
                        </span>
                      ))}
                    </div>
                    <div className="overflow-auto max-h-80">
                      <table className="w-full text-left text-xs text-slate-300">
                        <thead className="bg-slate-950 text-slate-400 text-[11px] sticky top-0 border-b border-slate-800">
                          <tr>{detail.columnas.map((c) => <th key={c.campo} className="py-2.5 px-3">{c.campo}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                          {detail.registros.map((row, i) => (
                            <tr key={i} className="hover:bg-slate-800/30">
                              {detail.columnas.map((c) => (
                                <td key={c.campo} className="py-2 px-3 truncate max-w-xs">
                                  {row[c.campo] == null ? <span className="text-slate-600 italic">NULL</span> : String(row[c.campo])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="p-8 text-center text-xs text-slate-400">No se detectaron tablas en la base de datos.</p>
            )}
          </div>
        )}

        {/* --------------------------- PESTAÑA: ENDPOINTS --------------------------- */}
        {tab === 'api-tester' && esAdmin && (
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 space-y-4">
            <div>
              <h3 className="text-base font-bold">Probador de endpoints</h3>
              <p className="text-xs text-slate-400 mt-1">Ejecuta peticiones reales contra el backend y revisa el JSON y el código HTTP 200 en vivo.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {endpoints.map((ep) => (
                <button
                  key={ep.path}
                  onClick={() => runTest(ep.method, ep.path)}
                  disabled={testing}
                  className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition disabled:opacity-60"
                >
                  <div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700">{ep.method}</span>
                    <div className="font-mono text-xs font-semibold mt-1.5">{ep.path}</div>
                    <div className="text-[11px] text-slate-400">{ep.desc}</div>
                  </div>
                  <Play className="w-4 h-4 text-slate-500" />
                </button>
              ))}
              <button
                onClick={() => setConfirmReset(true)}
                disabled={testing || resetting}
                className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition disabled:opacity-60"
              >
                <div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-rose-400 border border-slate-700">POST</span>
                  <div className="font-mono text-xs font-semibold mt-1.5">/api/reset-db</div>
                  <div className="text-[11px] text-slate-400">Autodestruir y repoblar BD</div>
                </div>
                <Play className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs pb-2 border-b border-slate-800/80">
                <span className="font-mono font-medium">Respuesta</span>
                {testing && <span className="text-indigo-400 animate-pulse">Consultando backend...</span>}
                {testResult && !testing && (
                  <>
                    <span className="font-mono text-[10px] bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20">
                      {testResult.method} {testResult.path}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded border font-bold ${
                        testResult.status >= 200 && testResult.status < 300
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400 border-red-500/20'
                      }`}
                    >
                      {testResult.status || 'Sin conexión'} • {testResult.ms} ms
                    </span>
                  </>
                )}
              </div>
              <pre className="font-mono text-[11px] text-slate-300 overflow-auto max-h-96 bg-slate-900/40 p-3 rounded-lg border border-slate-800/60">
                <code>{testResult?.body ?? '// Pulsa un endpoint para ejecutar la petición.'}</code>
              </pre>
            </div>
          </div>
        )}

        {/* --------------------------- PESTAÑA: AUDITORÍA --------------------------- */}
        {tab === 'audits' && esAdmin && (
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 space-y-4 shadow-xl">
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                <History className="w-5 h-5 text-amber-400" /> Registro de Auditoría
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Historial de movimientos: quién entró, qué rol usó, si creó, editó, eliminó o reseteó.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Fecha y Hora</th>
                    <th className="py-2.5 px-3">Acción</th>
                    <th className="py-2.5 px-3">Usuario</th>
                    <th className="py-2.5 px-3">Rol</th>
                    <th className="py-2.5 px-3">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-mono text-[11px]">
                  {audits.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 text-slate-400">{new Date(a.createdAt).toLocaleString()}</td>
                      <td className="py-2.5 px-3 font-bold text-amber-300">{a.action}</td>
                      <td className="py-2.5 px-3 text-slate-200">{a.username}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${a.role === 'admin' ? 'bg-amber-500/20 text-amber-300' : 'bg-cyan-500/20 text-cyan-300'}`}>
                          {a.role}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">{a.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ----------------------- MODAL CREAR / EDITAR ----------------------- */}
      {editing && esAdmin && (
        <Modal title={editing === 'new' ? 'Agregar celular' : `Editar celular #${editing.id}`} onClose={closeForm}>
          <form onSubmit={handleSave} className="space-y-4">
            <label className="block text-xs font-semibold text-slate-300 space-y-1.5">
              Marca
              <input
                required
                autoFocus
                maxLength={100}
                list="marcas"
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                placeholder="Samsung"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-normal text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              <datalist id="marcas">{brands.filter((b) => b !== 'Todas').map((b) => <option key={b} value={b} />)}</datalist>
            </label>

            <label className="block text-xs font-semibold text-slate-300 space-y-1.5">
              Nombre del modelo
              <input
                required
                maxLength={100}
                value={form.phone_name}
                onChange={(e) => setForm({ ...form, phone_name: e.target.value })}
                placeholder="Samsung Galaxy S24"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-normal text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </label>

            <label className="block text-xs font-semibold text-slate-300 space-y-1.5">
              URL de la imagen (opcional)
              <input
                type="url"
                value={form.image}
                onChange={(e) => setForm({ ...form, image: e.target.value })}
                placeholder="https://..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-normal text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-slate-300 space-y-1.5">
                Precio (USD)
                <input
                  type="number" min="0" step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="499.99"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-normal text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-300 space-y-1.5">
                Stock
                <input
                  type="number" min="0" step="1"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  placeholder="10"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-normal text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </label>
            </div>

            {form.image.trim() && (
              <div className="h-28 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-center overflow-hidden">
                <PhoneImage key={form.image} src={form.image.trim()} alt="Vista previa" className="max-h-24 object-contain" />
              </div>
            )}

            {formError && (
              <p role="alert" className="text-xs text-red-300 bg-red-950/40 border border-red-900/60 rounded-lg px-3 py-2">{formError}</p>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={closeForm} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold disabled:opacity-60"
              >
                {saving ? 'Guardando...' : editing === 'new' ? 'Agregar celular' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* --------------------------- MODAL ELIMINAR --------------------------- */}
      {toDelete && esAdmin && (
        <Modal title="Eliminar celular" onClose={() => setToDelete(null)}>
          <p className="text-xs text-slate-300 leading-relaxed">
            Se eliminará <strong className="text-slate-100">{toDelete.phone_name}</strong> de la base de datos. Esta acción no se puede deshacer.
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setToDelete(null)} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold">
              Cancelar
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold disabled:opacity-60"
            >
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}

      {/* ---------------------------- MODAL RESET ---------------------------- */}
      {confirmReset && esAdmin && (
        <Modal title="Reiniciar la base de datos" onClose={() => setConfirmReset(false)}>
          <p className="text-xs text-slate-300 leading-relaxed">
            Se vaciará la tabla <code className="text-indigo-300">phones (celulares)</code> y se volverá a crear con el catálogo de la API.
            <br /><br />
            <span className="text-emerald-400 font-bold">Nota de seguridad:</span> Los usuarios y registros de auditoría se conservarán intactos.
          </p>
          <label className="flex items-center justify-between gap-3 text-xs text-slate-300">
            Celulares a cargar desde la API
            <input
              type="number"
              min={0}
              max={1000}
              step={1}
              value={resetLimit}
              onChange={(e) => setResetLimit(e.target.value)}
              placeholder="Todos"
              className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </label>
          {!resetLimitValido && (
            <p role="alert" className="text-xs text-red-300">Escribe un número entero entre 0 y 1000, o deja el campo vacío para cargar todos.</p>
          )}
          <div className="flex justify-end gap-3">
            <button onClick={() => setConfirmReset(false)} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold">
              Cancelar
            </button>
            <button onClick={handleReset} disabled={!resetLimitValido} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold disabled:opacity-50">
              Sí, reiniciar
            </button>
          </div>
        </Modal>
      )}

      {/* Toast Notificación */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-[60] flex items-center gap-2 px-4 py-3 rounded-xl border text-xs font-semibold shadow-2xl ${
            toast.ok ? 'bg-emerald-950 border-emerald-800 text-emerald-200' : 'bg-red-950 border-red-800 text-red-200'
          }`}
        >
          {toast.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-red-400" />}
          {toast.text}
        </div>
      )}

      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 mt-auto text-center text-xs text-slate-500">
        Proyecto Fullstack Lenguaje de Programación III • Uniremington • Express.js + Sequelize + MySQL (XAMPP)
      </footer>
    </div>
  );
}