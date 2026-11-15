-- AlterTable
ALTER TABLE "User" ADD COLUMN "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "emailVerified" TIMESTAMP(3),
ADD COLUMN "emailVerificationToken" TEXT,
ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerificationToken_key" ON "User"("emailVerificationToken");
