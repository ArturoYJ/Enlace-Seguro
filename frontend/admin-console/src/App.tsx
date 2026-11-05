import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AdminApi, ApiError, apiBaseUrl, type AuditPage, type DateRange, type Metrics, type Profile } from './lib/api';
import { defaultRange, validRange } from './lib/dates';
import './App.css';

const events = ['auth.login.succeeded', 'auth.login.failed', 'authz.denied', 'account.registered', 'analysis.accepted', 'analysis.validation_failed', 'analysis.completed', 'analysis.inconclusive', 'analysis.failed', 'admin.audit.read'];
const statuses: Record<string, string> = { received: 'Recibidos', validation_failed: 'Validación fallida', processing: 'En proceso', completed: 'Completados', inconclusive: 'Sin conclusión', failed: 'Fallidos' };
const verdicts: Record<string, string> = { peligroso: 'Peligroso', sospechoso: 'Sospechoso', sin_amenazas_detectadas: 'Sin amenazas detectadas' };
const dateTime = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };
function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return 'Tu cuenta no tiene acceso de administración.';
  if (error instanceof ApiError && error.status === 429) return 'Demasiados intentos. Espera antes de volver a intentar.';
  if (error instanceof ApiError && error.status === 401) return 'Credenciales inválidas o sesión expirada.';
  return 'No fue posible conectar con el servicio. Intenta de nuevo.';
}
function Shield() { return <svg aria-hidden="true" viewBox="0 0 32 36" fill="none"><path d="M16 2 29 7v9c0 8-5 14-13 18C8 30 3 24 3 16V7L16 2Z" stroke="currentColor" strokeWidth="2.3"/><path d="m10 17 4 4 8-9" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function Brand() { return <div className="brand"><span className="brand-mark"><Shield/></span><span>Enlace<span className="brand-accent">Seguro</span><small>CONSOLA DE ADMINISTRACIÓN</small></span></div>; }

function Login({ api, onLogin }: { api: AdminApi; onLogin: (profile: Profile) => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const profile = await api.login(email, password); setPassword(''); onLogin(profile); }
    catch (cause) { setPassword(''); setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <main className="login-shell"><div className="login-orbit" aria-hidden="true"/><div className="login-layout"><section className="login-intro"><Brand/><div className="intro-copy"><span className="eyebrow"><i/> ACCESO RESTRINGIDO</span><h1>Información clara.<br/><em>Decisiones seguras.</em></h1><p>Un espacio para observar la actividad y dar seguimiento a los eventos de EnlaceSeguro.</p></div><p className="login-foot">OPERACIÓN · ENLACESEGURO</p></section><section className="login-panel"><div className="panel-icon"><Shield/></div><p className="eyebrow">CONSOLA INTERNA</p><h2>Iniciar sesión</h2><p className="muted">Ingresa con una cuenta de administración.</p><form onSubmit={submit}><label>Correo electrónico<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="nombre@ejemplo.com"/></label><label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Tu contraseña"/></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Validando…' : 'Entrar a la consola'}<span aria-hidden="true">→</span></button></form><p className="session-note">La sesión permanece solo en esta pestaña. Al recargar, tendrás que ingresar de nuevo.</p></section></div></main>;
}

function Filters({ range, onApply }: { range: DateRange; onApply: (range: DateRange) => void }) {
  const [draft, setDraft] = useState(range); const [error, setError] = useState('');
  function submit(e: FormEvent) { e.preventDefault(); if (!validRange(draft)) { setError('Selecciona fechas válidas y un inicio anterior al fin.'); return; } setError(''); onApply(draft); }
  return <form className="filter-bar" onSubmit={submit}><div className="filter-heading"><span className="filter-symbol">◷</span><div><strong>Periodo de consulta</strong><small>Hora de Ciudad de México</small></div></div><label>Desde<input type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} required/></label><label>Hasta<input type="date" value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} required/></label><button className="secondary-button">Aplicar</button>{error && <p className="form-error" role="alert">{error}</p>}</form>;
}

function Notice({ load, retry }: { load: Load<unknown>; retry: () => void }) {
  if (load.state === 'loading') return <div className="state-panel" role="status">Consultando información…</div>;
  if (load.state === 'error') return <div className="state-panel" role="alert"><p>{load.message}</p><button className="secondary-button" onClick={retry}>Reintentar</button></div>;
  return null;
}
function Dashboard({ api, range }: { api: AdminApi; range: DateRange }) {
  const [loaded, setLoaded] = useState<{ key: string; result: Load<Metrics> } | null>(null); const [retry, setRetry] = useState(0);
  const key = JSON.stringify([range.startDate, range.endDate, retry]);
  const load: Load<Metrics> = loaded?.key === key ? loaded.result : { state: 'loading' };
  useEffect(() => { const controller = new AbortController(); api.metrics(range, controller.signal).then(value => setLoaded({ key, result: { state: 'ready', value } })).catch(error => { if (!controller.signal.aborted) setLoaded({ key, result: { state: 'error', message: errorMessage(error) } }); }); return () => controller.abort(); }, [api, range, key]);
  if (load.state !== 'ready') return <Notice load={load} retry={() => setRetry(n => n + 1)}/>;
  const { value } = load; const max = Math.max(1, ...Object.values(value.byStatus));
  return <><div className="summary-line"><div><p className="eyebrow">PANORAMA GENERAL</p><h2>Actividad del periodo</h2></div><span className="period-tag">{range.startDate} — {range.endDate}</span></div><div className="metrics-grid"><article className="metric-total"><span className="card-kicker">INTENTOS RECIBIDOS <span>↗</span></span><strong>{value.totalAttempts.toLocaleString('es-MX')}</strong><p>Total registrado en el periodo seleccionado.</p><div className="metric-decoration" aria-hidden="true"><Shield/></div></article><article className="panel metric-status"><div className="panel-heading"><div><p className="eyebrow">PROCESAMIENTO</p><h3>Estado de los análisis</h3></div><span className="panel-number">01</span></div><div className="status-list">{Object.entries(statuses).map(([key, label]) => <div className="status-row" key={key}><span>{label}</span><div className="bar"><i style={{ width: `${((value.byStatus[key] ?? 0) / max) * 100}%` }}/></div><strong>{(value.byStatus[key] ?? 0).toLocaleString('es-MX')}</strong></div>)}</div></article><article className="panel metric-verdict"><div className="panel-heading"><div><p className="eyebrow">RESULTADOS</p><h3>Veredictos</h3></div><span className="panel-number">02</span></div><div className="verdict-list">{Object.entries(verdicts).map(([key, label], index) => <div className="verdict-row" key={key}><span className={`verdict-dot verdict-${index}`}/><span>{label}</span><strong>{(value.byVerdict[key] ?? 0).toLocaleString('es-MX')}</strong></div>)}</div><p className="caption">Sin amenazas detectadas no garantiza que un enlace sea seguro.</p></article></div></>;
}
function Audit({ api, range }: { api: AdminApi; range: DateRange }) {
  const [eventType, setEventType] = useState(''); const [cursor, setCursor] = useState<string | undefined>(); const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [loaded, setLoaded] = useState<{ key: string; result: Load<AuditPage> } | null>(null); const [retry, setRetry] = useState(0);
  const key = JSON.stringify([range.startDate, range.endDate, eventType, cursor, retry]);
  const load: Load<AuditPage> = loaded?.key === key ? loaded.result : { state: 'loading' };
  useEffect(() => { const controller = new AbortController(); api.audit(range, eventType, cursor, controller.signal).then(value => setLoaded({ key, result: { state: 'ready', value } })).catch(error => { if (!controller.signal.aborted) setLoaded({ key, result: { state: 'error', message: errorMessage(error) } }); }); return () => controller.abort(); }, [api, range, eventType, cursor, key]);
  function previousPage() { const stack = [...previous]; setCursor(stack.pop()); setPrevious(stack); }
  function nextPage() { if (load.state === 'ready' && load.value.nextCursor) { setPrevious([...previous, cursor]); setCursor(load.value.nextCursor); } }
  return <><div className="summary-line"><div><p className="eyebrow">REGISTRO DE SEGURIDAD</p><h2>Eventos de auditoría</h2><p className="muted">Actividad registrada dentro del periodo seleccionado.</p></div><label className="event-filter">Tipo de evento<select value={eventType} onChange={e => { setEventType(e.target.value); setCursor(undefined); setPrevious([]); }}><option value="">Todos los eventos</option>{events.map(event => <option key={event} value={event}>{event}</option>)}</select></label></div>{load.state !== 'ready' ? <Notice load={load} retry={() => setRetry(n => n + 1)}/> : <section className="panel audit-panel"><div className="audit-caption"><span id="audit-table-caption">REGISTRO DE EVENTOS</span><span>PÁGINA {previous.length + 1}</span></div>{load.value.items.length === 0 ? <div className="state-panel">No hay eventos para estos filtros.</div> : <div className="table-scroll"><table aria-labelledby="audit-table-caption"><thead><tr><th>Fecha y hora</th><th>Evento</th><th>Resultado</th><th>Actor</th><th>Detalle</th></tr></thead><tbody>{load.value.items.map(event => <tr key={event.id}><td>{dateTime.format(new Date(event.occurredAt))}</td><td><span className="event-name">{event.eventType}</span></td><td>{event.outcome ?? '—'}</td><td>{event.actorId ?? event.actorType ?? '—'}</td><td><details><summary>Ver detalle</summary><dl>{Object.entries({ acción: event.action, recurso: event.resourceType, idRecurso: event.resourceId, idSolicitud: event.requestId, ...event.metadata }).filter(([, value]) => value !== undefined).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></details></td></tr>)}</tbody></table></div>}<div className="pagination"><button className="secondary-button" onClick={previousPage} disabled={!previous.length}>← Anterior</button><button className="secondary-button" onClick={nextPage} disabled={!load.value.hasMore || !load.value.nextCursor}>Siguiente →</button></div></section>}</>;
}
function Console({ api, profile, onLogout }: { api: AdminApi; profile: Profile; onLogout: () => void }) {
  const [view, setView] = useState<'summary' | 'audit'>('summary'); const [range, setRange] = useState(defaultRange);
  return <div className="app-shell"><aside className="sidebar"><Brand/><div className="sidebar-label">ESPACIO DE TRABAJO</div><nav aria-label="Navegación principal"><button aria-current={view === 'summary' ? 'page' : undefined} className={view === 'summary' ? 'nav-active' : ''} onClick={() => setView('summary')}><span>▦</span>Resumen</button><button aria-current={view === 'audit' ? 'page' : undefined} className={view === 'audit' ? 'nav-active' : ''} onClick={() => setView('audit')}><span>≡</span>Auditoría</button></nav><div className="sidebar-bottom"><span className="status-indicator"><i/> CONSOLA ADMINISTRATIVA</span><p>Consulta y seguimiento de actividad.</p></div></aside><main className="workspace"><header className="topbar"><div><span className="breadcrumb">ENLACESEGURO / ADMINISTRACIÓN</span><h1>{view === 'summary' ? 'Resumen' : 'Auditoría'}</h1></div><div className="user-menu"><span className="avatar">A</span><div><strong>Administrador</strong><small>{profile.user.email}</small></div><button onClick={onLogout}>Salir</button></div></header><div className="content"><Filters range={range} onApply={setRange}/>{view === 'summary' ? <Dashboard api={api} range={range}/> : <Audit key={`${range.startDate}:${range.endDate}`} api={api} range={range}/>}<footer>ENLACESEGURO <span>·</span> Consola de administración <span>·</span> America/Mexico_City</footer></div></main></div>;
}
export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null); const [expired, setExpired] = useState(false);
  const api = useMemo(() => { try { return new AdminApi(apiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD), () => { setProfile(null); setExpired(true); }); } catch { return null; } }, []);
  if (!api) return <main className="config-error"><Brand/><h1>Configuración pendiente</h1><p>Configura una URL de API válida en <code>VITE_API_BASE_URL</code>.</p></main>;
  if (!profile) return <>{expired && <div className="expired-notice" role="status">Tu sesión terminó. Inicia sesión nuevamente.</div>}<Login api={api} onLogin={value => { setExpired(false); setProfile(value); }}/></>;
  return <Console api={api} profile={profile} onLogout={() => { setProfile(null); void api.logout(); }}/>;
}
