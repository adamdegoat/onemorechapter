/* One More Chapter — public front-end config.
   The anon key is SAFE to publish (row-level security restricts it to inserts).
   These are filled in during Supabase setup. Until then, reactions are a no-op
   locally and the page still works. */
window.OMC_CONFIG = {
  SUPABASE_URL: "",      // e.g. https://xxxxxxxx.supabase.co
  SUPABASE_ANON_KEY: ""  // the public "anon" key
};
