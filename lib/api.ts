export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit | undefined, fallbackMessage: string) {
  const response = await fetch(input, init);

  if (!response.ok) {
    const message = await getErrorMessage(response, fallbackMessage);
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

async function getErrorMessage(response: Response, fallbackMessage: string) {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim().length > 0) {
      return body.error;
    }
  } catch {
    // Ignore non-JSON error bodies and fall back to the caller-provided message.
  }

  return fallbackMessage;
}
