-- An owner can block a price without deleting it. A blocked price is skipped
-- when pricing a slot; existing rows stay active.
ALTER TABLE "pricing_rules" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
