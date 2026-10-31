-- A facility (Football, Pool...) can have a picture, shown in the customer site's venue-type picker. Holds the storage key (folder facilities/); empty = show its icon.
ALTER TABLE "venue_categories" ADD COLUMN "imageKey" TEXT;
