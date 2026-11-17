-- Voice channel (M6 FE-6..8, FR-16.6): per-chatbot switch and the measured time to the first audio.
ALTER TABLE "Chatbot" ADD COLUMN "voiceEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiInteraction" ADD COLUMN "firstAudioMs" INTEGER;
