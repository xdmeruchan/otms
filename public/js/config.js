// The anon key is PUBLIC by design: Row Level Security in the database is what protects the data.
// NEVER put the service_role key in this folder.
export const CONFIG = {
  SUPABASE_URL: 'https://btrkvjlavshssabchhah.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_Q5GETgQ3E6bjy1K8EL7n0Q_xEAOMA4z',
  EMAIL_DOMAIN: 'otms.example.com' // employees sign in with Employee ID; it maps to <id>@<domain>
};
