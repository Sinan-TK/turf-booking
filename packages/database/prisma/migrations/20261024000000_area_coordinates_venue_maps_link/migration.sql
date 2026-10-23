-- Town centres (for the customer site's location picker) and an optional
-- Google Maps link per venue (what its Directions button opens).
-- Hand-written: `prisma migrate diff` also proposes dropping the `during`
-- columns that back the no-double-booking constraints, which must stay.

ALTER TABLE "areas" ADD COLUMN "lat" DECIMAL(9,6);
ALTER TABLE "areas" ADD COLUMN "lng" DECIMAL(9,6);
ALTER TABLE "venues" ADD COLUMN "googleMapsUrl" TEXT;

-- The Malappuram towns that already exist get their centre (idempotent: only where still empty).
UPDATE "areas" a
SET "lat" = t.lat, "lng" = t.lng
FROM (VALUES
  ('Kottakkal', 11.001000, 76.001000),
  ('Manjeri', 11.121000, 76.121000),
  ('Perinthalmanna', 10.978000, 76.226000),
  ('Tirur', 10.917000, 75.926000),
  ('Ponnani', 10.767000, 75.926000),
  ('Kondotty', 11.146000, 75.961000),
  ('Tanur', 10.975000, 75.870000),
  ('Nilambur', 11.277000, 76.224000),
  ('Valanchery', 10.895000, 76.072000),
  ('Edappal', 10.786000, 76.010000)
) AS t(name, lat, lng)
JOIN "districts" d ON d."name" = 'Malappuram'
WHERE a."districtId" = d."id" AND a."name" = t.name AND a."lat" IS NULL;
