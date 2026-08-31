-- =============================================================================
-- 0017 — The report bytes live in the database
--
-- A download that cannot work, found by reading the code rather than by a
-- customer failing to download their own report.
--
-- The worker renders the HTML and prints it to PDF, then writes the bytes to
-- `VIBEFYCODE_REPORT_DIR` — a directory inside its own container on Render. The
-- console serves the download from Vercel, and calls the same storage class to
-- read that path back. Those are two machines. They share this database and
-- nothing else, so every download would have answered:
--
--     410 — The stored report could not be read.
--
-- Worse, Render's disk is ephemeral: a deploy would have discarded every report
-- ever generated, including ones a customer had already been told they could
-- keep.
--
-- The fix is the one the brief already chose for everything else: one database.
-- Not a bucket, not a signed URL with an expiry to reason about, not a second
-- set of credentials in the worker. A report is a few hundred kilobytes, it is
-- written once and read rarely, and putting it here means it inherits the
-- row-level security, the retention sweep and the backups that already exist.
--
-- `storage_path` stays. It is no longer where the bytes are, but it is still
-- what the file was called when it was rendered, and a report is a record —
-- the fewer facts about it we discard, the better.
-- =============================================================================

alter table public.reports add column content bytea;

comment on column public.reports.content is
  'The rendered report itself. The worker and the console run on different '
  'machines and share only this database, so the bytes travel in the row rather '
  'than on a disk one of them cannot see.';

comment on column public.reports.storage_path is
  'What the rendered file was called. Provenance, not a location — the bytes '
  'are in `content`.';

-- Old rows keep a null `content`: their bytes were written to a container disk
-- that no longer exists, and inventing a placeholder would be worse than the
-- console saying plainly that the file is gone and the report can be
-- regenerated. Not a constraint, for that reason.
