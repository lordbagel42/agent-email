-- better-auth admin plugin: adds role/ban fields to the user table.
-- (SQLite ALTER TABLE ADD COLUMN has no IF NOT EXISTS; this is applied once.)
ALTER TABLE "user" ADD COLUMN role TEXT;
ALTER TABLE "user" ADD COLUMN banned INTEGER;
ALTER TABLE "user" ADD COLUMN banReason TEXT;
ALTER TABLE "user" ADD COLUMN banExpires INTEGER;
