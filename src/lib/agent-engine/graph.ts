import { AIMessage, type BaseMessage, ToolMessage } from "@langchain/core/messages";
import { Annotation, END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import type { ToolContext } from "../tools/builtin-tools";
import { type RuntimeTool, runTool } from "../tools/registry";
import { REASON_PARAMETER, toJsonSchema } from "../tools/tool-schema";
import { type ModelToolSpec, type ToolCallingModel, messageText } from "./model-chain";
import { cleanModelError, recordModelFailure } from "../model-health";

/**
 * Module 2 FE-2: the multi-step reasoning chain, orchestrated with LangGraph (SRS CON-4).
 *
 *        ┌──────────── tool calls ────────────┐
 *   START → agent ──(answer / limit / budget)──→ END
 *        └───────── tools ◄──────────────────┘
 *
 * agent: the chat model with the tools bound (the agent's model first, then the
 *        managed fallback chain). On the last allowed step the tools are removed,
 *        so the model has to answer with what it has.
 * tools: runs each requested call through the registry (validation, confirmation,
 *        execution, action log) and returns the results to the model.
 */

export type TraceEntry =
  | { type: "thought"; step: number; text: string }
  | {
      type: "tool";
      step: number;
      toolKey: string;
      toolName: string;
      input: unknown;
      output: unknown;
      status: string;
      reason: string | null;
      executionId: string | null;
    }
  | { type: "model_error"; step: number; model: string; error: string };

export type GraphResult = {
  answer: string | null;
  steps: number;
  toolCalls: number;
  modelUsed: string | null;
  tokens: number;
  trace: TraceEntry[];
  failure: string | null;
  hitStepLimit: boolean;
  awaitingConfirmation: boolean;
  /** Tools whose last call failed while running (not bad input) and never recovered. */
  unrecoveredFailures: Array<{ toolKey: string; error: string }>;
};

const GraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  steps: Annotation<number>({ reducer: (_current, next) => next, default: () => 0 }),
  failure: Annotation<string | null>({ reducer: (_current, next) => next, default: () => null }),
});

export function toModelTools(tools: RuntimeTool[]): ModelToolSpec[] {
  return tools.map((tool) => ({
    name: tool.key,
    description: `${tool.description}${tool.requiresConfirmation ? " (The customer must confirm before it runs.)" : ""}`.slice(0, 1000),
    parameters: toJsonSchema(tool.parameters),
  }));
}

function isUnsupportedToolChoice(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /tool[_ ]choice/i.test(text);
}

export async function runAgentGraph({
  models,
  messages,
  tools,
  ctx,
  maxSteps,
  forcedTool = null,
  budgetMs = 25_000,
}: {
  models: ToolCallingModel[];
  messages: BaseMessage[];
  tools: RuntimeTool[];
  ctx: ToolContext;
  maxSteps: number;
  forcedTool?: string | null;
  budgetMs?: number;
}): Promise<GraphResult> {
  const deadline = Date.now() + budgetMs;
  const toolsByKey = new Map(tools.map((tool) => [tool.key, tool]));
  const modelTools = toModelTools(tools);
  const trace: TraceEntry[] = [];
  const unrecovered = new Map<string, string>();
  let modelIndex = 0;
  let modelUsed: string | null = null;
  let tokens = 0;
  let toolCalls = 0;
  let awaitingConfirmation = false;
  let hitStepLimit = false;

  const agentNode = async (state: typeof GraphState.State) => {
    const step = state.steps + 1;
    const lastStep = step > maxSteps;
    const offeredTools = lastStep ? [] : modelTools;
    const forced = step === 1 && forcedTool && toolsByKey.has(forcedTool) ? forcedTool : null;
    hitStepLimit = lastStep;

    while (modelIndex < models.length) {
      const remaining = deadline - Date.now();

      if (remaining < 1500) {
        return { failure: "The reasoning time budget ran out.", steps: step };
      }

      const model = models[modelIndex];

      try {
        let message: AIMessage;

        try {
          message = await model.invoke(state.messages, { tools: offeredTools, forcedTool: forced, timeoutMs: Math.min(15_000, remaining) });
        } catch (error) {
          // Some models reject a forced tool_choice: retry once without forcing.
          if (!forced || !isUnsupportedToolChoice(error)) throw error;
          message = await model.invoke(state.messages, { tools: offeredTools, timeoutMs: Math.min(15_000, deadline - Date.now()) });
        }

        modelUsed = model.id;
        tokens += message.usage_metadata?.total_tokens ?? 0;
        const thought = messageText(message);

        if (thought && message.tool_calls?.length) {
          trace.push({ type: "thought", step, text: thought.slice(0, 1000) });
        }

        return { messages: [message], steps: step };
      } catch (error) {
        const text = cleanModelError(error instanceof Error ? error.message : String(error));
        // A retired model (404) is skipped by later chains for a while.
        recordModelFailure(model.id, text);
        trace.push({ type: "model_error", step, model: model.id, error: text.slice(0, 300) });
        console.error(`[agent] ${model.id} failed: ${text.slice(0, 200)}`);
        modelIndex += 1;
      }
    }

    return { failure: models.length ? "Every model failed." : "No AI model is configured.", steps: step };
  };

  const toolsNode = async (state: typeof GraphState.State) => {
    const last = state.messages.at(-1) as AIMessage;
    const thought = messageText(last);
    const results: ToolMessage[] = [];

    // At most 4 calls per step, run in order (later calls may depend on earlier ones).
    for (const call of (last.tool_calls ?? []).slice(0, 4)) {
      const tool = toolsByKey.get(call.name);
      const callId = call.id ?? `${call.name}_${state.steps}`;

      if (!tool) {
        results.push(new ToolMessage({ tool_call_id: callId, name: call.name, content: JSON.stringify({ error: `Unknown tool "${call.name}". Use only the tools listed.` }) }));
        continue;
      }

      const args = (call.args ?? {}) as Record<string, unknown>;
      const withReason = args[REASON_PARAMETER] ? args : { ...args, [REASON_PARAMETER]: thought.slice(0, 300) || undefined };
      const result = await runTool({ tool, rawInput: withReason, ctx: { ...ctx, step: state.steps } });
      toolCalls += 1;

      if (result.status === "PENDING_CONFIRMATION") {
        awaitingConfirmation = true;
      }

      const error = (result.output as { error?: string } | null)?.error;

      if (result.status === "ERROR" && error && !error.startsWith("Invalid input")) {
        unrecovered.set(tool.key, error);
      } else if (result.status === "SUCCESS") {
        unrecovered.delete(tool.key);
      }

      trace.push({
        type: "tool",
        step: state.steps,
        toolKey: tool.key,
        toolName: tool.name,
        input: args,
        output: result.output,
        status: result.status,
        reason: typeof withReason[REASON_PARAMETER] === "string" ? (withReason[REASON_PARAMETER] as string) : null,
        executionId: result.executionId,
      });
      results.push(new ToolMessage({ tool_call_id: callId, name: call.name, content: JSON.stringify(result.output) }));
    }

    return { messages: results };
  };

  const graph = new StateGraph(GraphState)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", (state) => {
      if (state.failure) return END;
      const last = state.messages.at(-1);
      return last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0 && state.steps <= maxSteps ? "tools" : END;
    })
    .addEdge("tools", "agent")
    .compile();

  const final = await graph.invoke({ messages, steps: 0, failure: null }, { recursionLimit: maxSteps * 2 + 6 });
  const last = final.messages.at(-1);
  const answer = last instanceof AIMessage && !(last.tool_calls?.length) ? messageText(last) || null : null;

  return {
    answer,
    steps: final.steps,
    toolCalls,
    modelUsed,
    tokens,
    trace,
    failure: final.failure ?? (answer ? null : "The model did not produce an answer."),
    hitStepLimit,
    awaitingConfirmation,
    unrecoveredFailures: [...unrecovered.entries()].map(([toolKey, error]) => ({ toolKey, error })),
  };
}
