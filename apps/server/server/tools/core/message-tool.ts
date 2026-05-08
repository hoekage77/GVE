/**
 * MessageTool — Core tool for sending messages to the user.
 *
 * This is always enabled and allows the agent to communicate
 * results, ask clarifying questions, or provide status updates.
 */

import { Tool } from "../Tool.js";
import { toolMetadata, methodMetadata, openapiSchema } from "../decorators.js";

@toolMetadata(
  "Message",
  "Send messages, updates, or questions to the user. Use this to communicate progress, ask for clarification, or present final results.",
  { is_core: true, weight: 5, visible: true }
)
export class MessageTool extends Tool {
  @methodMetadata("Send Message", "Send a text message to the user.")
  @openapiSchema({
    type: "function",
    function: {
      name: "send_message",
      description: "Send a message to the user. Use this to provide results, updates, or ask questions.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message content to display to the user.",
          },
          type: {
            type: "string",
            enum: ["info", "success", "warning", "question"],
            description: "The message type/style.",
            default: "info",
          },
        },
        required: ["message"],
      },
    },
  })
  async sendMessage(args: { message: string; type?: string }) {
    return this.successResponse({
      sent: true,
      message: args.message,
      type: args.type ?? "info",
    });
  }
}
