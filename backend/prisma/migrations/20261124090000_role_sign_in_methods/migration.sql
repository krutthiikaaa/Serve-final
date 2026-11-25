-- Role-specific sign-in methods.
--
--   Students       Google only (verified @srmap.edu.in)
--   Staff, admins  email + password only
--
-- Additive and non-destructive: no row is updated or deleted.
--   * AuthSession gains "authMethod" ('google' | 'password'), recorded when a
--     session is created. Sessions that existed before this migration keep
--     NULL; they were all created by Google sign-in. The backend accepts NULL
--     for student accounts only, so staff and admins must sign in again with
--     their password.
--   * AuthUser.email no longer has to be @srmap.edu.in: staff may use a
--     personal address. The Google rule (verified @srmap.edu.in) and the admin
--     rule (@srmap.edu.in) are enforced by the backend on every sign-in and
--     every request (src/lib/auth.ts, src/lib/session.ts).

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN "authMethod" TEXT;

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_authMethod_check"
  CHECK ("authMethod" IS NULL OR "authMethod" IN ('google', 'password'));

-- Any lower-cased, well-formed address (the previous constraint allowed only
-- @srmap.edu.in).
ALTER TABLE "AuthUser" DROP CONSTRAINT "AuthUser_email_srm_domain_check";

ALTER TABLE "AuthUser" ADD CONSTRAINT "AuthUser_email_format_check"
  CHECK ("email" = lower("email") AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
