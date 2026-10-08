-- Reservations rework, step B — a line without its consent cannot be confirmed
-- (RESERVATIONS_REWORK.md §3.5 and §8: "consent required in the app, ticked once at the desk; …
-- a line without consent cannot be confirmed"; docs/features/RESERVATIONS_LINES.md §1.3).
--
-- Every path that makes a line since the rework writes its two consent rows (the refund policy
-- and the declaration) in the same transaction: the family's on the app channel, the desk's and
-- the admin's override on the desk channel, the school's for a grade-10 bulk line, the sheet's
-- for an imported one. The services refuse a confirmation without them, with a sentence; this
-- constraint trigger is the structure behind that refusal, so no path written later can confirm
-- a line nobody consented to. A line converted from before the rework (legacy.converted) was
-- consented to on the school's paper form and is not checked.
--
-- Deferred to the commit: a line made and confirmed in one transaction writes its consents after
-- the line itself. At the commit the row is read again, so a line confirmed and then dropped in
-- the same transaction is judged by what it ends as.

CREATE OR REPLACE FUNCTION registration_confirmed_has_consent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cur_status text;
  cur_legacy jsonb;
  kinds int;
BEGIN
  SELECT r.status, r.legacy INTO cur_status, cur_legacy FROM registration r WHERE r.id = NEW.id;
  IF cur_status IS DISTINCT FROM 'confirmed' THEN
    RETURN NULL;
  END IF;
  IF cur_legacy IS NOT NULL AND cur_legacy ? 'converted' THEN
    RETURN NULL;
  END IF;
  SELECT count(DISTINCT c.kind) INTO kinds FROM registration_consent c WHERE c.registration_id = NEW.id;
  IF kinds < 2 THEN
    RAISE EXCEPTION 'A line cannot be confirmed without its two consents (the refund policy and the declaration): registration %', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_confirmed_has_consent';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS registration_confirmed_has_consent ON registration;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER registration_confirmed_has_consent
  AFTER INSERT OR UPDATE OF status ON registration
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed')
  EXECUTE FUNCTION registration_confirmed_has_consent();
