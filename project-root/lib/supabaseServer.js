
import { createClient } from '@supabase/supabase-js';

export const supabaseServer = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // SERVICE_ROLE key — NEVER expose to frontend
);
