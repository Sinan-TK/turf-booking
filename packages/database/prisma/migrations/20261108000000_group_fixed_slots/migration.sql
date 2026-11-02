-- A fixed-slot pooled item now lists slots as time ranges, each with its own count and price, instead of bare start times.
ALTER TABLE "resource_groups" ADD COLUMN "fixedSlots" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Every old departure becomes a 60-minute slot with the whole fleet, priced from the group's one-hour price when it has one.
UPDATE "resource_groups" g
SET "fixedSlots" = COALESCE((
  SELECT jsonb_agg(
    jsonb_build_object(
      'start', t.hm,
      'end', CASE WHEN t.hm::time + interval '60 minutes' > t.hm::time THEN to_char(t.hm::time + interval '60 minutes', 'HH24:MI') ELSE '24:00' END,
      'count', COALESCE(g."totalUnits", 1),
      'price', COALESCE(r."offerPrice", r."normalPrice"),
      'advance', r."bookingPrice"
    ) ORDER BY t.hm
  )
  FROM unnest(g."fixedStartTimes") AS t(hm)
  LEFT JOIN LATERAL (
    SELECT p."normalPrice", p."offerPrice", p."bookingPrice"
    FROM pricing_rules p
    WHERE p."resourceGroupId" = g.id AND p."isActive" AND p."durationMinutes" = 60
    ORDER BY p."effectiveFrom" DESC
    LIMIT 1
  ) r ON true
), '[]'::jsonb)
WHERE g."slotMode" = 'FIXED';

ALTER TABLE "resource_groups" DROP COLUMN "fixedStartTimes";
