import Fastify from "fastify";
import { jwtVerify } from "jose";
import crypto from "node:crypto";

type Actor = {
  user_id: string;
  agent_role: string;
};

type Task = {
  id: string;
  user_id: string;
  title: string;
  status: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

type Message = {
  id: string;
  user_id: string;
  task_id: string;
  content: string;
  actor_type?: string;
  agent_role?: string;
  attachments?: Record<string, unknown> | null;
};

type Document = {
  id: string;
  user_id: string;
  task_id: string;
  title: string;
  content: string;
  doc_type?: string;
};

type IdempotencyRecord = {
  requestHash: string;
  response: any;
};

const port = Number(process.env.MC_LITE_PORT || "9001");

const tasks: Task[] = [];
const messages: Message[] = [];
const documents: Document[] = [];

const featureList = [
  "task_list",
  "task_create",
  "message_post",
  "document_post",
  "tool_discover",
  "tool_execute"
];

const toolDefinitions = [
  {
    name: "echo",
    description: "Echo back provided arguments.",
    parameters: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"]
    }
  }
];

const idempotency = {
  tasks: new Map<string, IdempotencyRecord>(),
  messages: new Map<string, IdempotencyRecord>(),
  documents: new Map<string, IdempotencyRecord>()
};

function hashPayload(payload: any) {
  const raw = JSON.stringify(payload ?? {});
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function authenticate(req: any): Promise<Actor> {
  const secret = process.env.AGENT_JWT_SECRET;
  if (!secret) {
    throw new Error("AGENT_JWT_SECRET is required");
  }
  const token = req.headers["x-agent-token"];
  if (!token || typeof token !== "string") {
    throw new Error("Missing X-Agent-Token");
  }
  const result = await jwtVerify(token, new TextEncoder().encode(secret));
  const payload: any = result.payload;
  if (payload?.type !== "agent" || !payload?.user_id || !payload?.agent_role) {
    throw new Error("Invalid agent token");
  }
  return { user_id: payload.user_id, agent_role: payload.agent_role };
}

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/capabilities", async () => ({
    version: "0.1.0",
    contract_version: "v1",
    features: featureList,
    endpoints: [
      "/api/mission-control/tasks",
      "/api/mission-control/messages",
      "/api/mission-control/documents",
      "/api/tools",
      "/api/tools/{tool_name}"
    ]
  }));

  app.get("/api/mission-control/capabilities", async (req, reply) => {
    try {
      await authenticate(req);
    } catch (err) {
      return reply.status(401).send({ error: (err as Error).message });
    }
    return {
      version: "0.1.0",
      contract_version: "v1",
      features_list: featureList,
      features: {
        tasks: true,
        messages: true,
        documents: true,
        notifications_dispatch: false,
        events_sse: false,
        heartbeat: false,
        standup: false,
        tool_requests: false
      }
    };
  });

  app.get("/api/mission-control/tasks", async (req, reply) => {
    let actor: Actor;
    try {
      actor = await authenticate(req);
    } catch (err) {
      return reply.status(401).send({ error: (err as Error).message });
    }
    const limitParam = (req.query as any)?.limit;
    const limit = Math.max(1, Math.min(100, Number(limitParam || 50)));
    const items = tasks.filter((t) => t.user_id === actor.user_id).slice(0, limit);
    return { items };
  });

  app.post("/api/mission-control/tasks", async (req, reply) => {
    let actor: Actor;
    try {
      actor = await authenticate(req);
    } catch (err) {
      return reply.status(401).send({ error: (err as Error).message });
    }
    const body: any = req.body || {};
    if (!body.title) {
      return reply.status(400).send({ error: "title is required" });
    }
    const key = body.idempotency_key as string | undefined;
    if (key) {
      const record = idempotency.tasks.get(key);
      const requestHash = hashPayload(body);
      if (record) {
        if (record.requestHash !== requestHash) {
          return reply.status(409).send({ error: "idempotency_key conflict" });
        }
        return record.response;
      }
    }
    const task: Task = {
      id: crypto.randomUUID(),
      user_id: actor.user_id,
      title: body.title,
      status: body.status || "in_progress",
      description: body.description,
      metadata: body.metadata
    };
    tasks.push(task);
    if (key) {
      idempotency.tasks.set(key, { requestHash: hashPayload(body), response: task });
    }
    return task;
  });

  app.post("/api/mission-control/messages", async (req, reply) => {
    let actor: Actor;
    try {
      actor = await authenticate(req);
    } catch (err) {
      return reply.status(401).send({ error: (err as Error).message });
    }
    const body: any = req.body || {};
    if (!body.task_id || !body.content) {
      return reply.status(400).send({ error: "task_id and content are required" });
    }
    const key = body.idempotency_key as string | undefined;
    if (key) {
      const record = idempotency.messages.get(key);
      const requestHash = hashPayload(body);
      if (record) {
        if (record.requestHash !== requestHash) {
          return reply.status(409).send({ error: "idempotency_key conflict" });
        }
        return record.response;
      }
    }
    const message: Message = {
      id: crypto.randomUUID(),
      user_id: actor.user_id,
      task_id: body.task_id,
      content: body.content,
      actor_type: body.actor_type,
      agent_role: body.agent_role,
      attachments: body.attachments ?? null
    };
    messages.push(message);
    if (key) {
      idempotency.messages.set(key, { requestHash: hashPayload(body), response: message });
    }
    return message;
  });

  app.post("/api/mission-control/documents", async (req, reply) => {
    let actor: Actor;
    try {
      actor = await authenticate(req);
    } catch (err) {
      return reply.status(401).send({ error: (err as Error).message });
    }
    const body: any = req.body || {};
    if (!body.task_id || !body.title || !body.content) {
      return reply.status(400).send({ error: "task_id, title, and content are required" });
    }
    const key = body.idempotency_key as string | undefined;
    if (key) {
      const record = idempotency.documents.get(key);
      const requestHash = hashPayload(body);
      if (record) {
        if (record.requestHash !== requestHash) {
          return reply.status(409).send({ error: "idempotency_key conflict" });
        }
        return record.response;
      }
    }
    const doc: Document = {
      id: crypto.randomUUID(),
      user_id: actor.user_id,
      task_id: body.task_id,
      title: body.title,
      content: body.content,
      doc_type: body.doc_type === "plan" ? "deliverable" : body.doc_type
    };
    documents.push(doc);
    if (key) {
      idempotency.documents.set(key, { requestHash: hashPayload(body), response: doc });
    }
    return doc;
  });

  app.get("/api/tools", async (req, reply) => {
    try {
      await authenticate(req);
    } catch (err) {
      return reply.status(401).send({ error: (err as Error).message });
    }
    return { tools: toolDefinitions };
  });

  app.post("/api/tools/:name", async (req, reply) => {
    try {
      await authenticate(req);
    } catch (err) {
      return reply.status(401).send({ error: (err as Error).message });
    }
    const toolName = (req.params as any)?.name;
    const body: any = req.body || {};
    if (toolName === "echo") {
      return { message: body?.arguments?.message ?? null };
    }
    return reply.status(404).send({ error: "tool not found" });
  });

  return app;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const app = buildApp();
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
