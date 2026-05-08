/**
 * TerminatingTool — Tools that signal the agent should stop looping.
 *
 * `ask`: Ask the user a clarifying question and pause execution.
 * `complete`: Signal that the task is finished successfully.
 *
 * When either tool is called and succeeds, the coordinator loop terminates
 * instead of calling the LLM again.
 */

import { Tool } from "../Tool.js";
import { toolMetadata, methodMetadata, openapiSchema } from "../decorators.js";

@toolMetadata(
  "Terminating",
  "Tools for ending the agent loop. Use `ask` when you need clarification from the user. Use `complete` when you have finished the task.",
  { is_core: true, weight: 10, visible: true }
)
export class TerminatingTool extends Tool {
  @methodMetadata("Ask User", "Ask the user a clarifying question and pause execution until they respond.")
  @openapiSchema({
    type: "function",
    function: {
      name: "ask",
      description: "Ask the user a clarifying question. This stops the agent loop and waits for the user's response.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question to ask the user.",
          },
        },
        required: ["question"],
      },
    },
  })
  async ask(args: { question: string }) {
    return this.successResponse({
      terminating: true,
      type: "ask",
      question: args.question,
    });
  }

  @methodMetadata("Complete Task", "Signal that the task has been completed successfully and stop the agent loop.")
  @openapiSchema({
    type: "function",
    function: {
      name: "complete",
      description: "Signal that the task is complete. This stops the agent loop and returns the final result to the user.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "A brief summary of what was accomplished.",
          },
        },
        required: ["summary"],
      },
    },
  })
  async complete(args: { summary: string }) {
    return this.successResponse({
      terminating: true,
      type: "complete",
      summary: args.summary,
    });
  }
}
