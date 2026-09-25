import { createClient } from '@supabase/supabase-js';
import { createVerdentAuth } from '@verdent/auth-js';

const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const envKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

// Em preview/publicação Verdent usamos o proxy same-origin; local usa env.
const useProxy = !envUrl || !envKey;

export const supabase = createClient(
  useProxy ? window.location.origin : envUrl!,
  useProxy ? 'verdent-baas-proxy' : envKey!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export const auth = createVerdentAuth({
  supabase,
  ...(import.meta.env.VITE_VERDENT_OAUTH_INITIATE_URL
    ? {
        oauth: { authorizeUrl: import.meta.env.VITE_VERDENT_OAUTH_INITIATE_URL as string },
      }
    : {}),
});

if (import.meta.env.DEV) {
  (window as unknown as { __sb: typeof supabase }).__sb = supabase;
}
