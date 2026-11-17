-- Token streaming: time until the first word of an AI reply reached the customer.
ALTER TABLE "AiInteraction" ADD COLUMN "firstTokenMs" INTEGER;
