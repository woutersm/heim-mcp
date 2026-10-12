import type { TObject } from "typebox";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: TObject;
  annotations?: ToolAnnotations;
  /** Other names a model uses for an argument: alias → argument. */
  argAliases?: Record<string, string>;
  /** Other words for an enum value, per argument: argument → (alias → value). */
  valueAliases?: Record<string, Record<string, string>>;
}

export interface ToolBackend {
  tools(): readonly ToolDef[];
  /** `args` are already clean; returns the text the model reads. */
  call(name: string, args: Record<string, unknown>): string | Promise<string>;
}

/** A mistake the model can fix; its message is the sentence the model reads. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
