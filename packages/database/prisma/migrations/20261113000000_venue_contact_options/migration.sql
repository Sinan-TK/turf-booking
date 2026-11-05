-- Which ways a customer with a confirmed booking can reach the venue: a phone call (as before), and now WhatsApp too.
ALTER TABLE "venues" ADD COLUMN "contactCall" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "venues" ADD COLUMN "contactWhatsapp" BOOLEAN NOT NULL DEFAULT false;
