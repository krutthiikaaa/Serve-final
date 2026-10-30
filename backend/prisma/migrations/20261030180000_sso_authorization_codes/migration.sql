-- CreateEnum
CREATE TYPE "SsoAudience" AS ENUM ('STAFF', 'ADMIN');

-- CreateTable
CREATE TABLE "SsoAuthorizationCode" (
    "id" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "firebaseUid" TEXT NOT NULL,
    "audience" "SsoAudience" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoAuthorizationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SsoAuthorizationCode_codeHash_key" ON "SsoAuthorizationCode"("codeHash");

-- CreateIndex
CREATE INDEX "SsoAuthorizationCode_expiresAt_idx" ON "SsoAuthorizationCode"("expiresAt");

-- CreateIndex
CREATE INDEX "SsoAuthorizationCode_firebaseUid_idx" ON "SsoAuthorizationCode"("firebaseUid");
