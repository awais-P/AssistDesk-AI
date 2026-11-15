-- Email verification (20261115160000) added "isEmailVerified" with default false, and sign-in
-- now requires it, so every account created before that feature was locked out. Accounts that
-- predate it have no pending verification token: mark them verified as of their creation.
-- New sign-ups always carry a token until they verify, so they are not affected.
UPDATE "User"
SET "isEmailVerified" = true,
    "emailVerified" = COALESCE("emailVerified", "createdAt")
WHERE "isEmailVerified" = false
  AND "emailVerified" IS NULL
  AND "emailVerificationToken" IS NULL;
