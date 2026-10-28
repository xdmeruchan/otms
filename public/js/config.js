// The anon key is PUBLIC by design: Row Level Security in the database is what protects the data.
// NEVER put the service_role key in this folder.
export const CONFIG = {
  SUPABASE_URL: 'https://btrkvjlavshssabchhah.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0cmt2amxhdnNoc3NhYmNoaGFoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MzEzNjYwNCwiZXhwIjoyMTA4NzEyNjA0fQ.BPCKV7gYLWEOLUClJE8G1-QqTy8TiMQ89U7hIt7yCss',
  EMAIL_DOMAIN: 'otms.example.com' // employees sign in with Employee ID; it maps to <id>@<domain>
};
