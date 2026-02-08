export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  timeoutMs?: number; // default 30_000; ask_user = 300_000
}
