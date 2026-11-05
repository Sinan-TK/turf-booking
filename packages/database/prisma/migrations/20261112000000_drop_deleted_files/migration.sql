-- Removed files are now deleted from the bucket right away, so the list of files waiting for a hand delete is no longer kept.
DROP TABLE IF EXISTS "deleted_files";
DROP TYPE IF EXISTS "DeletedFileSource";
DROP TYPE IF EXISTS "DeletedFileActor";
