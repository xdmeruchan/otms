import { CONFIG } from './config.js';

const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ld = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const clean = (s) => s.replace(/[^\p{L}\p{N}\s.-]/gu, '').trim().slice(0, 40); // keep search text safe for PostgREST filters
const LOGO = '<svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true"><path d="M2 6l8 14 6-16 6 14 6-10 8 4" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TN = { reg: 'Regular day', rest: 'Rest day / special day', hol: 'Regular holiday' };
const PS = 10;

let me = null, cfg = null, view = 'dash', pg = 1, q = '', st = '', rf = '', seq = 0, timer = 0;
let th = 'system';
try { th = localStorage.getItem('otms-th') || 'system'; } catch (e) { /* storage blocked */ }
const applyTh = () => { document.documentElement.dataset.theme = th === 'system' ? '' : th; };
applyTh();

const hourly = (sal) => Math.round(sal / cfg.work_days / cfg.hours_per_day * 100) / 100;
const hrsOf = (a, b) => {
  const t = (x) => { const [h, m] = x.split(':'); return +h * 60 + +m; };
  let d = t(b) - t(a); if (d <= 0) d += 1440;
  return Math.round(d / 60 * 100) / 100;
};
const mult = (ty) => ({ reg: cfg.mult_reg, rest: cfg.mult_rest, hol: cfg.mult_hol })[ty];
const sum = (a, k) => a.reduce((s, r) => s + Number(r[k]), 0);
const fail = (e) => {
  const el = $('#tbl') || $('#v');
  if (el) el.innerHTML = `<p class="err" role="alert">Something went wrong: ${esc(e.message || e)}</p>`;
};

// ---------------- auth ----------------
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return login();
  const p = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  const c = await sb.from('settings').select('*').single();
  if (p.error || c.error || !p.data.active) {
    await sb.auth.signOut();
    return login('Your account is not active. Contact an administrator.');
  }
  me = p.data; cfg = c.data; view = 'dash'; pg = 1; q = st = rf = '';
  shell();
}
function login(msg = '') {
  me = null;
  app.innerHTML = `<div class="lg"><form id="lf" class="panel"><div class="brand">${LOGO}<div><b>OTMS</b><small>Overtime Monitoring System</small></div></div><h2>User login</h2><p class="mut">Enter your Employee ID and password.</p><label>Employee ID<input name="id" autocomplete="username" required></label><label>Password<input name="pw" type="password" autocomplete="current-password" required></label><p class="err" id="err" role="alert">${esc(msg)}</p><button class="btn p" style="width:100%">Sign in</button></form></div>`;
}

// ---------------- shell + views ----------------
const NAV = [['dash', 'Dashboard', 'admin supervisor user'], ['ot', 'Overtime', 'admin supervisor user'],
  ['users', 'Users', 'admin'], ['rates', 'Rates & rules', 'admin']];
function shell() {
  const r = me.role;
  app.innerHTML = `<div class="app"><aside class="side"><div class="brand">${LOGO}<div><b>OTMS</b><small>Overtime Monitoring System</small></div></div><button class="big" data-a="new">New overtime</button>${NAV.filter((n) => n[2].includes(r)).map((n) => `<button class="nav" data-a="nav" data-v="${n[0]}" ${n[0] === view ? 'aria-current="page"' : ''}>${n[1]}</button>`).join('')}</aside><main class="main"><div class="top"><button class="btn" data-a="theme" id="th"></button><button class="btn" data-a="pw">Password</button><div class="chip"><b>${esc(me.full_name)}</b><br>${r}</div><button class="btn" data-a="out">Sign out</button></div><div class="panel" id="v">${VIEWS[view]()}</div></main></div>`;
  $('#th').textContent = 'Theme: ' + th;
  ({ dash: loadDash, ot: loadOT, users: loadUsers, rates: () => {} })[view]();
}
const VIEWS = {
  dash: () => `<h1>Dashboard</h1><p class="sub">Overtime monitoring reports</p><div class="tb"><label class="mut" style="margin:0">Month <input type="month" id="mo" value="${ld(new Date()).slice(0, 7)}"></label></div><div id="dsh"><p class="mut">Loading…</p></div>`,
  ot: () => `<h1>Overtime</h1><p class="sub">${me.role === 'user' ? 'Your overtime entries' : me.role === 'supervisor' ? 'Entries from your team' : 'All overtime entries'}</p><div class="tb"><input id="q" type="search" placeholder="Search name or ID" aria-label="Search" value="${esc(q)}"><select id="sf" aria-label="Status">${[['', 'All statuses'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].map((o) => `<option value="${o[0]}" ${o[0] === st ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div><div id="tbl"><p class="mut">Loading…</p></div>`,
  users: () => `<h1>Users</h1><p class="sub" id="ucount">Accounts</p><div class="tb"><input id="q" type="search" placeholder="Search name or ID" aria-label="Search" value="${esc(q)}"><select id="rf" aria-label="Role">${['', 'admin', 'supervisor', 'user'].map((o) => `<option value="${o}" ${o === rf ? 'selected' : ''}>${o || 'All roles'}</option>`).join('')}</select></div><div id="tbl"><p class="mut">Loading…</p></div>`,
  rates: () => `<h1>Rates &amp; rules</h1><p class="sub">Overtime pay = hourly rate × multiplier × hours</p><form id="cf" style="max-width:420px"><label>Working days per month<input name="work_days" type="number" step="any" value="${cfg.work_days}"></label><label>Hours per day<input name="hours_per_day" type="number" step="any" value="${cfg.hours_per_day}"></label><label>Multiplier: regular day<input name="mult_reg" type="number" step="any" value="${cfg.mult_reg}"></label><label>Multiplier: rest day / special day<input name="mult_rest" type="number" step="any" value="${cfg.mult_rest}"></label><label>Multiplier: regular holiday<input name="mult_hol" type="number" step="any" value="${cfg.mult_hol}"></label><p class="err" id="err" role="alert"></p><button class="btn p">Save rates</button></form><p class="mut">Hourly rate = monthly salary ÷ working days ÷ hours per day. New rates apply to new entries only; existing entries keep the rate they were filed with. Defaults follow common Philippine private-sector premiums (125%, 169%, 260%). Confirm them against your agency’s rules.</p>`
};
const pager = (n, tot) => `<div class="tb"><button class="btn s" data-a="pg" data-d="-1" ${pg <= 1 ? 'disabled' : ''}>Previous</button><span class="mut">Page ${pg} of ${n} · ${tot} rows</span><button class="btn s" data-a="pg" data-d="1" ${pg >= n ? 'disabled' : ''}>Next</button></div>`;

async function loadDash() {
  const my = ++seq, mo = $('#mo').value;
  let from = null, to = null;
  if (mo) { const [y, m] = mo.split('-').map(Number); from = `${mo}-01`; to = ld(new Date(y, m, 0)); }
  const g = me.role === 'admin' ? 'office' : me.role === 'supervisor' ? 'employee' : 'month';
  const r = await sb.rpc('ot_summary', { p_from: from, p_to: to, p_group: g });
  if (my !== seq) return;
  if (r.error) return fail(r.error);
  const rows = r.data.map((x) => ({ ...x, entries: +x.entries, hours: +x.hours, pay: +x.pay, pending: +x.pending, rejected: +x.rejected }));
  const mx = Math.max(1, ...rows.map((x) => x.pay));
  let side = `<div class="row"><span>Awaiting approval</span><b>${sum(rows, 'pending')} entries</b></div>`;
  if (me.role === 'admin') {
    const cnt = async (role) => (await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', role)).count || 0;
    const [a, s, u] = await Promise.all([cnt('admin'), cnt('supervisor'), cnt('user')]);
    side = `<div class="row"><span>Admins</span><b>${a}</b></div><div class="row"><span>Supervisors</span><b>${s}</b></div><div class="row"><span>Users</span><b>${u}</b></div><div class="row"><span>Total accounts</span><b>${(a + s + u).toLocaleString()}</b></div>`;
  }
  if (my !== seq) return;
  $('#dsh').innerHTML = `<div class="stats"><div class="stat" style="background:var(--c1)"><span>Entries</span><b>${sum(rows, 'entries')}</b></div><div class="stat" style="background:var(--c2)"><span>Approved hours</span><b>${sum(rows, 'hours').toFixed(1)}</b></div><div class="stat" style="background:var(--c3)"><span>Pending</span><b>${sum(rows, 'pending')}</b></div><div class="stat" style="background:var(--c4)"><span>Rejected</span><b>${sum(rows, 'rejected')}</b></div><div class="stat" style="background:var(--c5)"><span>Total OT pay</span><b>${peso(sum(rows, 'pay'))}</b></div></div><div class="cols"><div><h2>Approved OT pay by ${g === 'office' ? 'office' : g === 'employee' ? 'employee' : 'month'}</h2>${rows.length ? rows.slice(0, 12).map((x) => `<div class="bar"><span>${esc(x.grp)}</span><i style="width:${Math.max(3, x.pay / mx * 100)}%"></i><b>${peso(x.pay)}</b></div>`).join('') : '<p class="mut">No overtime in this period. Use New overtime to file one.</p>'}</div><div><h2>${me.role === 'admin' ? 'Accounts' : 'Status'}</h2>${side}</div></div>`;
}

async function loadOT() {
  const my = ++seq, from = (pg - 1) * PS, term = clean(q);
  let b = sb.from('overtime').select(`*,profiles:profiles!overtime_user_id_fkey${term ? '!inner' : ''}(full_name,employee_id)`, { count: 'exact' });
  if (st) b = b.eq('status', st);
  if (term) b = b.or(`full_name.ilike.%${term}%,employee_id.ilike.%${term}%`, { referencedTable: 'profiles' });
  const r = await b.order('work_date', { ascending: false }).order('id', { ascending: false }).range(from, from + PS - 1);
  if (my !== seq) return;
  if (r.error) return fail(r.error);
  const n = Math.max(1, Math.ceil(r.count / PS));
  if (pg > n) { pg = n; return loadOT(); }
  const canDecide = me.role !== 'user';
  const act = (x) => {
    if (x.status !== 'pending') return '';
    let a = '';
    if (canDecide && x.user_id !== me.id) a += `<button class="btn s p" data-a="decide" data-s="approved" data-id="${x.id}">Approve</button> <button class="btn s" data-a="decide" data-s="rejected" data-id="${x.id}">Reject</button>`;
    if (x.user_id === me.id) a += ` <button class="btn s" data-a="cancel" data-id="${x.id}">Cancel</button>`;
    return a;
  };
  const counted = r.data.filter((x) => x.status !== 'rejected');
  $('#tbl').innerHTML = `<div class="tw"><table><thead><tr><th>Employee</th><th>Date</th><th>Day type</th><th>Time</th><th>Hours</th><th>Computation</th><th>Pay</th><th>Status</th><th>Action</th></tr></thead><tbody>${r.data.map((x) => `<tr><td>${esc(x.profiles.full_name)}<br><small class="mut">${esc(x.profiles.employee_id)}</small></td><td>${x.work_date}</td><td>${TN[x.day_type]}</td><td>${x.start_time.slice(0, 5)}–${x.end_time.slice(0, 5)}</td><td>${x.hours}</td><td>${peso(x.hourly_rate)} × ${x.multiplier} × ${x.hours}</td><td><b>${peso(x.pay)}</b></td><td><span class="tag ${x.status}">${x.status}</span></td><td>${act(x)}</td></tr>`).join('') || '<tr><td colspan="9" class="mut">No overtime entries match.</td></tr>'}</tbody></table></div><p><b>This page (excluding rejected): ${sum(counted, 'hours').toFixed(2)} hours · ${peso(sum(counted, 'pay'))}</b></p>${pager(n, r.count)}`;
}

async function loadUsers() {
  const my = ++seq, from = (pg - 1) * 12, term = clean(q);
  let b = sb.from('profiles').select('*', { count: 'exact' });
  if (rf) b = b.eq('role', rf);
  if (term) b = b.or(`full_name.ilike.%${term}%,employee_id.ilike.%${term}%`);
  const r = await b.order('employee_id').range(from, from + 11);
  if (my !== seq) return;
  if (r.error) return fail(r.error);
  const n = Math.max(1, Math.ceil(r.count / 12));
  if (pg > n) { pg = n; return loadUsers(); }
  $('#ucount').textContent = `${r.count.toLocaleString()} accounts match`;
  $('#tbl').innerHTML = `<div class="tw"><table><thead><tr><th>Employee ID</th><th>Name</th><th>Office</th><th>Role</th><th>Monthly salary</th><th>Hourly rate</th></tr></thead><tbody>${r.data.map((u) => `<tr><td>${esc(u.employee_id)}</td><td>${esc(u.full_name)}</td><td>${esc(u.office)}</td><td><select data-role="${u.id}" aria-label="Role of ${esc(u.full_name)}" ${u.id === me.id ? 'disabled' : ''}>${['admin', 'supervisor', 'user'].map((o) => `<option ${o === u.role ? 'selected' : ''}>${o}</option>`).join('')}</select></td><td>${peso(u.monthly_salary)}</td><td>${peso(hourly(u.monthly_salary))}</td></tr>`).join('') || '<tr><td colspan="6" class="mut">No users match.</td></tr>'}</tbody></table></div>${pager(n, r.count)}`;
}

// ---------------- dialogs ----------------
function openNew() {
  const d = $('#dlg');
  d.innerHTML = `<form id="f"><h2>New overtime</h2><label>Date<input type="date" name="date" max="${ld(new Date())}" required></label><label>Day type<select name="ty">${Object.entries(TN).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label><div class="two"><label>Start<input type="time" name="s" value="17:00" required></label><label>End<input type="time" name="e" value="19:00" required></label></div><label>Reason<textarea name="why" rows="2" maxlength="200" required></textarea></label><div class="calc" id="calc"></div><p class="err" id="err" role="alert"></p><div class="tb"><button type="button" class="btn" data-a="close">Cancel</button><button class="btn p">Save entry</button></div></form>`;
  calc(); d.showModal();
}
function calc() {
  const f = $('#f').elements, h = hrsOf(f.s.value || '00:00', f.e.value || '00:00'), rate = hourly(me.monthly_salary), m = mult(f.ty.value);
  $('#calc').innerHTML = `Estimate: ${peso(rate)}/hr × ${m} × ${h} h = <b>${peso(Math.round(rate * m * h * 100) / 100)}</b><br><small>The server computes the final amount when you save.</small>`;
}
function openPw() {
  const d = $('#dlg');
  d.innerHTML = `<form id="pf"><h2>Change password</h2><label>New password (at least 10 characters)<input type="password" name="p1" minlength="10" autocomplete="new-password" required></label><label>Repeat password<input type="password" name="p2" minlength="10" autocomplete="new-password" required></label><p class="err" id="err" role="alert"></p><div class="tb"><button type="button" class="btn" data-a="close">Cancel</button><button class="btn p">Save password</button></div></form>`;
  d.showModal();
}

// ---------------- events ----------------
const reload = () => ({ dash: loadDash, ot: loadOT, users: loadUsers, rates: () => {} })[view]();
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a;
  if (a === 'nav') { view = b.dataset.v; pg = 1; q = rf = ''; st = view === 'ot' && me.role !== 'user' ? 'pending' : ''; shell(); }
  else if (a === 'new') openNew();
  else if (a === 'pw') openPw();
  else if (a === 'close') $('#dlg').close();
  else if (a === 'out') { await sb.auth.signOut(); login(); }
  else if (a === 'theme') { th = { system: 'light', light: 'dark', dark: 'system' }[th]; try { localStorage.setItem('otms-th', th); } catch (x) { /* ignore */ } applyTh(); $('#th').textContent = 'Theme: ' + th; }
  else if (a === 'pg') { pg += +b.dataset.d; reload(); }
  else if (a === 'decide') {
    b.disabled = true;
    const r = await sb.rpc('decide_overtime', { p_id: +b.dataset.id, p_status: b.dataset.s });
    if (r.error) alert(r.error.message);
    loadOT();
  } else if (a === 'cancel') {
    const r = await sb.from('overtime').delete().eq('id', +b.dataset.id);
    if (r.error) alert(r.error.message);
    loadOT();
  }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'q') { q = t.value; pg = 1; clearTimeout(timer); timer = setTimeout(reload, 250); }
  else if (t.id === 'sf') { st = t.value; pg = 1; loadOT(); }
  else if (t.id === 'rf') { rf = t.value; pg = 1; loadUsers(); }
  else if (t.id === 'mo') loadDash();
  else if (t.form && t.form.id === 'f') calc();
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (!t.dataset.role || me.role !== 'admin') return;
  const r = await sb.from('profiles').update({ role: t.value }).eq('id', t.dataset.role);
  if (r.error) alert(r.error.message);
  loadUsers();
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, v = Object.fromEntries(new FormData(f)), err = $('#err'), btn = f.querySelector('button.p, button:not([type])');
  err.style.color = '';
  if (f.id === 'lf') {
    btn.disabled = true;
    const r = await sb.auth.signInWithPassword({ email: `${v.id.trim()}@${CONFIG.EMAIL_DOMAIN}`.toLowerCase(), password: v.pw });
    btn.disabled = false;
    if (r.error) { err.textContent = 'Employee ID or password is incorrect.'; return; }
    boot();
  } else if (f.id === 'f') {
    const h = hrsOf(v.s, v.e); let m = '';
    if (!v.date || v.date > ld(new Date())) m = 'Choose a date that is today or earlier.';
    else if (h <= 0 || h > 12) m = 'Overtime must be between 0 and 12 hours.';
    else if (v.why.trim().length < 3) m = 'Enter a reason (at least 3 characters).';
    if (m) { err.textContent = m; return; }               // keep the entered values on a failed submit
    btn.disabled = true;
    const r = await sb.from('overtime').insert({ user_id: me.id, work_date: v.date, day_type: v.ty, start_time: v.s, end_time: v.e, reason: v.why.trim() });
    btn.disabled = false;
    if (r.error) { err.textContent = r.error.code === '23505' ? 'You already filed overtime for this date and start time.' : r.error.message; return; }
    $('#dlg').close(); view = 'ot'; st = ''; q = ''; pg = 1; shell();
  } else if (f.id === 'pf') {
    if (v.p1 !== v.p2) { err.textContent = 'The passwords do not match.'; return; }
    const r = await sb.auth.updateUser({ password: v.p1 });
    if (r.error) { err.textContent = r.error.message; return; }
    $('#dlg').close();
  } else if (f.id === 'cf') {
    const n = {}; for (const k of ['work_days', 'hours_per_day', 'mult_reg', 'mult_rest', 'mult_hol']) n[k] = parseFloat(v[k]);
    const ok = n.work_days >= 1 && n.work_days <= 31 && n.hours_per_day >= 1 && n.hours_per_day <= 24 && ['mult_reg', 'mult_rest', 'mult_hol'].every((k) => n[k] >= 1 && n[k] <= 5);
    if (!ok) { err.textContent = 'Days must be 1–31, hours 1–24 and multipliers 1–5.'; return; }
    const r = await sb.from('settings').update(n).eq('id', true);
    if (r.error) { err.textContent = r.error.message; return; }
    cfg = { ...cfg, ...n }; err.style.color = 'var(--pri)'; err.textContent = 'Rates saved. They apply to new entries.';
  }
});

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && me) login('You were signed out. Please sign in again.'); });
boot();
