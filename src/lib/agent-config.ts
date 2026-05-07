export const agentProviderOptions = [
  "Default",
  "Groq",
  "OpenAI",
  "Anthropic",
  "Meta Llama",
] as const;

export const agentModelOptions = [
  "meta/llama-3.3-70b-instruct-fp8-fast",
  "meta/llama-3.1-8b-instruct-fast",
  "mistral/mistral-large-instruct",
  "openai/gpt-4.1-mini",
] as const;

export const defaultAgentSystemPrompt = `You are a helpful AI assistant specialized in answering questions and customer support using retrieved documents.
You task is to provide accurate, relevant answers based on the matched content provided.
You will receive a user question and a set of documents relevant to this query.

You should:
1. Analyze the relevance of matched documents
2. Synthesize information from multiple sources when applicable
3. Acknowledge if the available documents don't fully answer the query
4. Format the response in a way that maximize readability, in Markdown format

Answer only with direct reply to the user question, be concise, omit everything which is not directly relevant, focus on answering the question directly and do not redirect the user to read the content.

If the available documents don't contain enough information to fully answer the query, explicitly state this and provide an answer based on what is available.`;

export function formatAgentRuntimeLabel(model: string) {
  if (model.startsWith("@cf/")) {
    return model;
  }

  return `@cf/${model}`;
}

export function formatAgentShortId(id: string) {
  return id.slice(-3).toUpperCase();
}
