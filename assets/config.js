/* One More Chapter — public front-end config.
   The anon key is SAFE to publish (row-level security restricts it to inserts).
   These are filled in during Supabase setup. Until then, reactions are a no-op
   locally and the page still works. */
window.OMC_CONFIG = {
  SUPABASE_URL: "https://aopkpgidyaizoozvymco.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Dn9hrpNRUAegONnAspDe0w_n_n7eMZX",
  // Attribution: include ?src= / ?cmp= from the URL in reaction beacons.
  // Keep FALSE until the source/campaign columns exist (see supabase_setup.sql) —
  // posting unknown columns would make Supabase reject the insert. Flip to true
  // after running the migration to light up email-open + A/B reporting.
  TRACK_SOURCE: false
};
