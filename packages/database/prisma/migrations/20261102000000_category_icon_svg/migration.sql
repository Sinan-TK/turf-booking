-- An admin can paste a custom SVG as a facility icon (checked by the API before it is stored). Empty = use iconKey.
ALTER TABLE "venue_categories" ADD COLUMN "iconSvg" TEXT;
