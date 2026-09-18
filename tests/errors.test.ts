import { describe, expect, test } from "bun:test";
import { classifyError, DarkopsError, errorEnvelope, EXIT_CODES } from "../src/util/errors";

describe("classifyError", () => {
  test("passes a DarkopsError through unchanged", () => {
    const error = new DarkopsError("RUN_MISSING", "no run");
    expect(classifyError(error)).toBe(error);
  });

  test("maps auth statuses to AUTH", () => {
    const classified = classifyError({ status: 401, message: "bad key" });
    expect(classified.code).toBe("AUTH");
    expect(classified.exitCode).toBe(EXIT_CODES.AUTH);
  });

  test("maps other API statuses to API", () => {
    const classified = classifyError({ status: 500, message: "boom" });
    expect(classified.code).toBe("API");
    expect(classified.exitCode).toBe(EXIT_CODES.API);
  });

  test("falls back to INTERNAL", () => {
    expect(classifyError(new Error("boom")).code).toBe("INTERNAL");
  });
});

describe("errorEnvelope", () => {
  test("carries code, message, and hint", () => {
    expect(errorEnvelope(new DarkopsError("AUTH", "missing", "set the key"))).toEqual({
      error: { code: "AUTH", message: "missing", hint: "set the key" },
    });
  });

  test("omits an absent hint", () => {
    expect(errorEnvelope(new DarkopsError("API", "boom"))).toEqual({
      error: { code: "API", message: "boom" },
    });
  });
});
