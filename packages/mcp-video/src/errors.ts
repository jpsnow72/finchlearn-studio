/**
 * errors.ts — the one error type every video-tool failure travels as.
 * Codes mirror the FinchLearn MCP server's McpToolError codes
 * (packages/mcp-server/src/types/mcp.ts in the OCF repo) plus
 * plan_required, the code its dispatch path returns for the Keeper
 * gate (lib/planGate.ts there). The MCP-server module built on this
 * package converts throws into clean tool errors, never stack traces.
 */

export type VideoToolErrorCode =
  | "not_found"
  | "invalid"
  | "forbidden"
  | "plan_required"
  | "internal";

export class VideoToolError extends Error {
  constructor(
    message: string,
    public readonly code: VideoToolErrorCode = "invalid",
  ) {
    super(message);
    this.name = "VideoToolError";
  }
}

/** The project (or scene/line within it) is not visible to the caller. */
export function notFound(what: string): VideoToolError {
  return new VideoToolError(`${what} was not found, or is not accessible to you.`, "not_found");
}

export function invalid(message: string): VideoToolError {
  return new VideoToolError(message, "invalid");
}
