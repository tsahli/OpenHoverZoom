export interface FetchDocumentRequest {
  type: "fetch-document";
  requestId: string;
  url: string;
}

export interface CancelFetchRequest {
  type: "cancel-fetch";
  requestId: string;
}

export type BackgroundRequest = FetchDocumentRequest | CancelFetchRequest;

export interface FetchDocumentSuccess {
  success: true;
  requestId: string;
  finalUrl: string;
  contentType: string;
  status: number;
  body?: string;
}

export type FetchErrorCode =
  | "aborted"
  | "duplicate-request"
  | "invalid-url"
  | "network-error"
  | "response-too-large"
  | "timeout"
  | "too-many-redirects"
  | "unsupported-content-type";

export interface FetchDocumentFailure {
  success: false;
  requestId: string;
  error: FetchErrorCode;
}

export type FetchDocumentResponse = FetchDocumentSuccess | FetchDocumentFailure;

const REQUEST_ID = /^[a-z0-9_-]{8,80}$/iu;

export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  if (!isRecord(value) || !validRequestId(value.requestId)) return false;
  if (value.type === "cancel-fetch") return true;
  return (
    value.type === "fetch-document" &&
    typeof value.url === "string" &&
    value.url.length > 0 &&
    value.url.length <= 8192
  );
}

export function isFetchDocumentResponse(value: unknown): value is FetchDocumentResponse {
  if (!isRecord(value) || !validRequestId(value.requestId) || typeof value.success !== "boolean") {
    return false;
  }
  if (!value.success) {
    return (
      typeof value.error === "string" &&
      FETCH_ERROR_CODES.has(value.error as FetchErrorCode)
    );
  }
  return (
    typeof value.finalUrl === "string" &&
    value.finalUrl.length <= 8192 &&
    typeof value.contentType === "string" &&
    value.contentType.length <= 256 &&
    typeof value.status === "number" &&
    Number.isSafeInteger(value.status) &&
    value.status >= 100 &&
    value.status <= 599 &&
    (value.body === undefined || (typeof value.body === "string" && value.body.length <= 1_500_000))
  );
}

const FETCH_ERROR_CODES = new Set<FetchErrorCode>([
  "aborted",
  "duplicate-request",
  "invalid-url",
  "network-error",
  "response-too-large",
  "timeout",
  "too-many-redirects",
  "unsupported-content-type",
]);

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
