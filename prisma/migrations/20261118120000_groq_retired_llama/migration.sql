-- Groq retired its Llama models (Nov 2026): agents move to Qwen 3.8 27B, the fastest model
-- Groq still offers (thinking off: first word in ~100-500 ms).
ALTER TABLE "AIAgent" ALTER COLUMN "model" SET DEFAULT 'qwen/qwen3.8-27b';

-- Agents on AssistDesk's managed ("Default") models.
UPDATE "AIAgent"
SET "model" = 'groq/qwen/qwen3.8-27b'
WHERE "model" IN ('groq/llama-3.3-70b-versatile', 'groq/llama-3.1-8b-instant');

-- Agents using their own Groq key.
UPDATE "AIAgent"
SET "model" = 'qwen/qwen3.8-27b'
WHERE "provider" = 'Groq' AND "model" IN ('llama-3.3-70b-versatile', 'llama-3.1-8b-instant');
