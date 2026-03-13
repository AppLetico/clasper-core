import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SignJWT } from "jose";
import { buildApp } from "./server.js";

const secret = "test-secret";

async function buildToken() {
  const encoder = new TextEncoder();
  return await new SignJWT({
    type: "agent",
    user_id: "user-1",
    agent_role: "tester"
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(encoder.encode(secret));
}

describe("mission-control-lite server", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    process.env.AGENT_JWT_SECRET = secret;
    app = buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists tasks with valid agent token", async () => {
    const token = await buildToken();
    const response = await app.inject({
      method: "GET",
      url: "/api/mission-control/tasks",
      headers: {
        "x-agent-token": token
      }
    });

    expect(response.statusCode).toBe(200);
  });

  it("executes echo tool", async () => {
    const token = await buildToken();
    const response = await app.inject({
      method: "POST",
      url: "/api/tools/echo",
      headers: {
        "x-agent-token": token
      },
      payload: {
        arguments: { message: "hello" }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().message).toBe("hello");
  });
});
