-- Better Auth sign-in identities (Google, verified @srmap.edu.in only).
--
-- Additive and non-destructive:
--   * four new tables for Better Auth: AuthUser, AuthSession, AuthAccount,
--     AuthVerification (identity and sessions only; no roles);
--   * Student / Staff / Admin gain a nullable, unique "authUserId";
--   * "firebaseUid" becomes optional so new accounts need no Firebase UID.
--     Every existing value is kept; no row is updated or deleted.
-- Roles, staff approvals, canteen assignments, orders and payments are not
-- touched. Existing accounts are linked to a sign-in identity later, at their
-- first Google sign-in, by exact verified email (see src/modules/auth).

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "authUserId" TEXT,
ALTER COLUMN "firebaseUid" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "authUserId" TEXT,
ALTER COLUMN "firebaseUid" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "authUserId" TEXT,
ALTER COLUMN "firebaseUid" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AuthUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAccount" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthVerification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthUser_email_key" ON "AuthUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_token_key" ON "AuthSession"("token");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthAccount_userId_idx" ON "AuthAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthAccount_providerId_accountId_key" ON "AuthAccount"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "AuthVerification_identifier_idx" ON "AuthVerification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_authUserId_key" ON "Admin"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_authUserId_key" ON "Staff"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_authUserId_key" ON "Student"("authUserId");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "AuthUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "AuthUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "AuthUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthAccount" ADD CONSTRAINT "AuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Defence in depth: the application only ever writes verified, lower-cased
-- @srmap.edu.in addresses here; the database refuses anything else.
ALTER TABLE "AuthUser" ADD CONSTRAINT "AuthUser_email_srm_domain_check"
  CHECK ("email" = lower("email") AND "email" ~ '^[^@[:space:]]+@srmap\.edu\.in$');

-- One sign-in identity maps to at most ONE role account (Student, Staff or
-- Admin). Unique indexes cover each table; this trigger covers the three
-- together. The transaction-scoped advisory lock serialises concurrent
-- attempts for the same identity, so two simultaneous links cannot both pass.
CREATE FUNCTION "serve_auth_user_single_role"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."authUserId" IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('serve.authUserId:' || NEW."authUserId", 0));
  IF (TG_TABLE_NAME <> 'Student' AND EXISTS (SELECT 1 FROM "Student" WHERE "authUserId" = NEW."authUserId"))
     OR (TG_TABLE_NAME <> 'Staff' AND EXISTS (SELECT 1 FROM "Staff" WHERE "authUserId" = NEW."authUserId"))
     OR (TG_TABLE_NAME <> 'Admin' AND EXISTS (SELECT 1 FROM "Admin" WHERE "authUserId" = NEW."authUserId")) THEN
    RAISE EXCEPTION 'sign-in identity % already belongs to another account', NEW."authUserId"
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'AuthUser_single_role_account';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Student_authUserId_single_role" BEFORE INSERT OR UPDATE OF "authUserId" ON "Student"
  FOR EACH ROW EXECUTE FUNCTION "serve_auth_user_single_role"();
CREATE TRIGGER "Staff_authUserId_single_role" BEFORE INSERT OR UPDATE OF "authUserId" ON "Staff"
  FOR EACH ROW EXECUTE FUNCTION "serve_auth_user_single_role"();
CREATE TRIGGER "Admin_authUserId_single_role" BEFORE INSERT OR UPDATE OF "authUserId" ON "Admin"
  FOR EACH ROW EXECUTE FUNCTION "serve_auth_user_single_role"();
