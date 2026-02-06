import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';

const TEST_DB_DIR = join(process.cwd(), '.test-db', 'tool-tokens');
process.env.CLASPER_TOOL_TOKEN_SECRET = 'test-secret';

import { initDatabase, closeDatabase } from '../core/db.js';
import { issueToolToken, consumeToolToken, verifyToolToken } from './toolTokens.js';

// Unique path per run to avoid parallel workers / disk I/O conflicts
function getTestDbPath(): string {
  return join(TEST_DB_DIR, `tt-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('Tool tokens', () => {
  let testDbPath: string;

  beforeEach(() => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    closeDatabase();
    testDbPath = getTestDbPath();
    process.env.CLASPER_DB_PATH = testDbPath;
    initDatabase();
  });

  afterEach(() => {
    closeDatabase();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = testDbPath + suffix;
      if (existsSync(p)) {
        try {
          unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    }
    if (existsSync(TEST_DB_DIR)) {
      try {
        rmSync(TEST_DB_DIR, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('issues and consumes tokens', async () => {
    const issued = await issueToolToken({
      tenant_id: 't1',
      workspace_id: 'w1',
      adapter_id: 'a1',
      execution_id: 'e1',
      tool: 'filesystem.write',
      scope: { path: '/tmp/out.txt', bytes: 10 },
    });

    const verified = await verifyToolToken(issued.token);
    expect(verified.payload.tool).toBe('filesystem.write');

    const firstConsume = consumeToolToken(issued.jti);
    const secondConsume = consumeToolToken(issued.jti);

    expect(firstConsume).toBe(true);
    expect(secondConsume).toBe(false);
  });
});
