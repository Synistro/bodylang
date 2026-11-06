import { describe, expect, it } from "vitest";
import { requestProblem } from "./requestGuard";

const json = { host: "localhost:5183", "content-type": "application/json" };

describe("who may call the API", () => {
  it("lets this page through", () => {
    expect(requestProblem("POST", { ...json, origin: "http://localhost:5183" })).toBeNull();
    expect(requestProblem("PUT", { ...json, origin: "http://localhost:5183" })).toBeNull();
  });

  it("lets a tool with no Origin through, since only browsers send one", () => {
    expect(requestProblem("POST", json)).toBeNull();
  });

  it("turns away another site, whatever it sends", () => {
    expect(requestProblem("POST", { ...json, origin: "https://example.com" })?.status).toBe(403);
    expect(requestProblem("POST", { ...json, origin: "null" })?.status).toBe(403);
    expect(requestProblem("POST", { ...json, origin: "http://localhost:9999" })?.status).toBe(403);
  });

  it("turns away what a web page can send with no preflight", () => {
    expect(requestProblem("POST", { host: json.host, "content-type": "text/plain" })?.status).toBe(415);
    expect(requestProblem("POST", { host: json.host })?.status).toBe(415);
  });

  it("leaves reading alone", () => {
    expect(requestProblem("GET", { host: json.host })).toBeNull();
    expect(requestProblem("HEAD", { host: json.host })).toBeNull();
  });
});
