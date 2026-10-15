-- Required for the exclusion constraint that makes double-booking
-- structurally impossible at the database layer (see ARCHITECTURE.md §6.3).
CREATE EXTENSION IF NOT EXISTS btree_gist;
