/**
 * @finch-studio/mcp-video — the Studio service core behind the
 * FinchLearn MCP server's video tools (issues #50 and #66).
 *
 * The MCP server itself lives in jpsnow72/open-course-format
 * (packages/mcp-server); this package is the Studio-side core it
 * calls: the Keeper plan gate (mirrored semantics, injected plan
 * resolver), the project/scene/dialogue/narration/footage/export
 * operations over the shipped Studio seams, and the parameterized
 * template rendering flow. See docs/mcp-contract.md for the contract
 * and MANIFEST.md in the repo root for the wiring map.
 */
export * from "./errors.js";
export * from "./planGate.js";
export * from "./ports.js";
export * from "./templates.js";
export * from "./variables.js";
export * from "./renderRequest.js";
export * from "./service.js";
export * from "./tools.js";
