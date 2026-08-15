export type ProviderErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_AUTHENTICATION_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_REQUEST_FAILED"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_EMPTY_RESPONSE";

export class ProviderError extends Error {
  public constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

export function classifyGenerationError(
  error: unknown,
  stage: "context" | "provider",
): { code: string; message: string; retryable: boolean } {
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }

  if (stage === "context") {
    return {
      code: "CONTEXT_ASSEMBLY_FAILED",
      message:
        "I couldn’t prepare the conversation context. Check the local personalisation settings and try again.",
      retryable: false,
    };
  }

  return {
    code: "GENERATION_FAILED",
    message: "The response stopped unexpectedly. You can retry if no reply text was produced.",
    retryable: true,
  };
}
