export class AppError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  public constructor(message: string) {
    super(message, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}
