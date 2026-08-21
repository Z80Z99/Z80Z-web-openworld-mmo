import { describe, it, expect } from "vitest";
import { SERVER_VERSION, startServer } from "./index.js";

describe("server", () => {
  it("exports version", () => {
    expect(SERVER_VERSION).toBe("0.0.1");
  });

  it("starts server with shared dependency", () => {
    const result = startServer();
    expect(result).toContain("Server v0.0.1");
    expect(result).toContain("shared v0.0.1");
  });
});
