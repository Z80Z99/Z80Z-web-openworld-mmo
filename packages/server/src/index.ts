import { SHARED_VERSION } from "@mmo/shared";

export const SERVER_VERSION = "0.0.1" as const;

export function startServer(): string {
  return `Server v${SERVER_VERSION} (shared v${SHARED_VERSION}) ready`;
}
