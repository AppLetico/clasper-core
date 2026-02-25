import { describe, expect, it } from 'vitest';
import { inferIntent, mapToolContext } from './intentInference.js';

describe('openclaw intent/context inference', () => {
  it('extracts structured exec context and target paths', () => {
    const context = mapToolContext(
      { name: 'exec', group: 'runtime' },
      {
        command: 'ls -la ./src',
        cwd: '/workspace/project',
      }
    );

    expect(context.exec?.argv0).toBe('ls');
    expect(context.exec?.argv).toEqual(['ls', '-la', './src']);
    expect(context.exec?.cwd).toBe('/workspace/project');
    expect(Array.isArray((context.targets as { paths?: string[] })?.paths)).toBe(true);
    expect(context.side_effects?.writes_possible).toBe(true);
    expect(context.side_effects?.network_possible).toBe(false);
  });

  it('extracts host targets for URL inputs', () => {
    const context = mapToolContext(
      { name: 'web_fetch', group: 'web' },
      { url: 'https://example.com/docs?q=1' }
    );
    expect((context.targets as { hosts?: string[] })?.hosts).toContain('example.com');
    expect(context.external_network).toBe(true);
    expect(context.side_effects?.network_possible).toBe(true);
  });

  it('keeps heuristic intent for destructive shell command', () => {
    const intent = inferIntent(
      { name: 'exec', group: 'runtime' },
      { command: 'rm -rf node_modules' }
    );
    expect(intent).toBe('destructive_command');
  });
});
