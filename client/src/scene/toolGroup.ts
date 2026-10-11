/** Click tools that exclude each other (Set point, Route): arming one disarms the rest, so one click never does two things. */
export interface ToolGroup {
  /** Registers a tool by name with the function that disarms it (idempotent, and it must not call `armed`).
   * Returns the function the tool calls when it becomes armed. */
  join(name: string, disarm: () => void): () => void;
}

export function createToolGroup(): ToolGroup {
  const tools = new Map<string, () => void>();
  return {
    join(name, disarm) {
      tools.set(name, disarm);
      return () => {
        for (const [other, disarmOther] of tools) if (other !== name) disarmOther();
      };
    },
  };
}
