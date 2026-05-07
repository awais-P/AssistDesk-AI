export const chatbotColorOptions = [
  "#4f8cff",
  "#22c55e",
  "#8b5cf6",
  "#f97316",
  "#ec4899",
  "#2dd4bf",
] as const;

export const defaultChatbotWelcomeMessage =
  "Hello, how can I help you today?";

export function buildEmbedSnippet(widgetId: string) {
  return `<script>
  window.assistDeskWidget = { widgetId: "${widgetId}" };
</script>
<script src="https://assistdesk.ai/widget.js" async></script>`;
}
