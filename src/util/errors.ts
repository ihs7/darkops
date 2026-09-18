export const CONTRACT_VERSION = 1;

export type ErrorCode = "USAGE" | "AUTH" | "RUN_MISSING" | "API" | "INTERNAL";

export const EXIT_CODES: Record<ErrorCode, number> = {
  USAGE: 2,
  AUTH: 3,
  RUN_MISSING: 4,
  API: 5,
  INTERNAL: 1,
};

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; hint?: string };
}

export class DarkopsError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "DarkopsError";
    this.code = code;
    this.exitCode = EXIT_CODES[code];
    this.hint = hint;
  }
}

export function classifyError(error: unknown): DarkopsError {
  if (error instanceof DarkopsError) return error;

  const status = statusOf(error);
  const message = error instanceof Error ? error.message : String(error);
  if (status === 401 || status === 403) {
    return new DarkopsError(
      "AUTH",
      message,
      "Check TYPESAFE_API_KEY, then run `darkops auth --show`.",
    );
  }
  if (typeof status === "number") return new DarkopsError("API", message);
  return new DarkopsError("INTERNAL", message);
}

export function errorEnvelope(error: DarkopsError): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.hint ? { hint: error.hint } : {}),
    },
  };
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}
