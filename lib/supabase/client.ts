import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 *
 * Use this in Client Components ("use client") and in event handlers.
 * For Server Components, Server Actions and Route Handlers use
 * lib/supabase/server.ts instead — it reads the session from cookies.
 *
 * createBrowserClient is a singleton, so importing `supabase` in many
 * components reuses the same connection and auth session.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Newer Supabase projects hand out a publishable key (sb_publishable_...)
// instead of the legacy anon key. Either one works here.
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Add it to .env.local (Supabase dashboard → Project Settings → API) and restart "npm run dev".`,
    );
  }

  return value;
}

export const supabase = createBrowserClient(
  requireEnv(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv(supabaseKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
);

/*
 * Example usage in a Client Component:
 *
 *   "use client";
 *   import { supabase } from "@/lib/supabase/client";
 *
 *   const { data, error } = await supabase
 *     .from("games")
 *     .select("*")
 *     .eq("is_published", true)
 *     .order("created_at", { ascending: false });
 */
