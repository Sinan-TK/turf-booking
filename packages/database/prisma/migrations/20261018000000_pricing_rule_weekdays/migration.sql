-- Pricing rules apply to chosen days of the week (and, optionally, a time of day)
-- instead of the fixed WEEKDAY / WEEKEND / HOLIDAY buckets.
--
-- weekdays holds ISO day numbers (1 = Monday .. 7 = Sunday). Existing rules are
-- converted so they price exactly as before: WEEKDAY -> Mon-Fri, WEEKEND ->
-- Sat-Sun. HOLIDAY was never matched by the price lookup, so it stays empty.
-- startWindow / endWindow already exist and are now honoured by the lookup.

ALTER TABLE "pricing_rules" ADD COLUMN "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

UPDATE "pricing_rules"
   SET "weekdays" = CASE "dayType"
         WHEN 'WEEKDAY' THEN ARRAY[1,2,3,4,5]
         WHEN 'WEEKEND' THEN ARRAY[6,7]
         ELSE ARRAY[]::INTEGER[]
       END;

ALTER TABLE "pricing_rules" ALTER COLUMN "dayType" DROP NOT NULL;
