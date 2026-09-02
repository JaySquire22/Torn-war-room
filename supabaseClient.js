import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  // Fails loudly at build/runtime rather than silently breaking storage -
  // easier to diagnose than mysteriously empty data.
  throw new Error(
    "Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY " +
      "(in a local .env file for dev, or in your host's environment variables for deployment)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
