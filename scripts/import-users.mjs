// Bulk-create accounts from a CSV. Run locally only (uses the service_role key).
//   node --env-file=.env scripts/import-users.mjs users.csv
// CSV header: employee_id,full_name,office,role,supervisor_employee_id,monthly_salary
// (no commas inside fields). Safe to re-run: existing employee IDs are skipped.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EMAIL_DOMAIN = 'otms.example.com' } = process.env;
const file = process.argv[2];
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !file) {
  console.error('Usage: node --env-file=.env scripts/import-users.mjs users.csv'); process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [head, ...lines] = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const cols = head.split(',').map((c) => c.trim());
const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])));

const ROLES = new Set(['admin', 'supervisor', 'user']);
const bad = rows.filter((r) => !/^[0-9A-Za-z-]{3,20}$/.test(r.employee_id) || !ROLES.has(r.role)
  || !r.full_name || !(Number(r.monthly_salary) >= 0));
if (bad.length) { console.error('Invalid rows (check id, role, name, salary):', bad.slice(0, 5)); process.exit(1); }

const ids = new Map(); // employee_id -> uuid
const creds = ['employee_id,temporary_password'];
let made = 0, skipped = 0;

for (const r of rows) {
  const { data: ex } = await sb.from('profiles').select('id').eq('employee_id', r.employee_id).maybeSingle();
  if (ex) { ids.set(r.employee_id, ex.id); skipped++; continue; }
  const password = crypto.randomBytes(9).toString('base64url');           // 12 chars, random
  const { data, error } = await sb.auth.admin.createUser({
    email: `${r.employee_id}@${EMAIL_DOMAIN}`.toLowerCase(), password, email_confirm: true });
  if (error) { console.error(`FAILED ${r.employee_id}: ${error.message}`); continue; }
  const { error: pe } = await sb.from('profiles').insert({
    id: data.user.id, employee_id: r.employee_id, full_name: r.full_name, office: r.office || '',
    role: r.role, monthly_salary: Number(r.monthly_salary) });
  if (pe) { console.error(`PROFILE FAILED ${r.employee_id}: ${pe.message}`); await sb.auth.admin.deleteUser(data.user.id); continue; }
  ids.set(r.employee_id, data.user.id); creds.push(`${r.employee_id},${password}`); made++;
  if (made % 100 === 0) console.log(`created ${made}...`);
}

// second pass: link supervisors
let linked = 0;
for (const r of rows) {
  if (!r.supervisor_employee_id || !ids.has(r.employee_id)) continue;
  const sup = ids.get(r.supervisor_employee_id);
  if (!sup) { console.warn(`No supervisor ${r.supervisor_employee_id} for ${r.employee_id}`); continue; }
  const { error } = await sb.from('profiles').update({ supervisor_id: sup }).eq('employee_id', r.employee_id);
  if (!error) linked++;
}

if (creds.length > 1) fs.writeFileSync('credentials-out.csv', creds.join('\n') + '\n', { mode: 0o600 });
console.log(`Done. created=${made} skipped=${skipped} supervisor links=${linked}`);
if (made) console.log('Temporary passwords saved to credentials-out.csv. Hand them out securely, then delete the file.');
