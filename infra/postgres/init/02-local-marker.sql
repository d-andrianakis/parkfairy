-- Marks these databases as local development copies. The demo seed (pnpm db:seed) refuses
-- to run unless it sees this marker, which a tunnel or a copied URL cannot fake. Also run by
-- `pnpm db:up` for volumes created before this file existed; safe to run repeatedly.
ALTER DATABASE parkfairy SET parkfairy.environment = 'local';
ALTER DATABASE parkfairy_test SET parkfairy.environment = 'local';
