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

  it('infers intent for new tool groups', () => {
    expect(inferIntent({ name: 'browser', group: 'ui' }, { action: 'navigate', url: 'https://example.com' })).toBe('browser_automation');
    expect(inferIntent({ name: 'canvas', group: 'ui' }, {})).toBe('canvas_render');
    expect(inferIntent({ name: 'nodes', group: 'nodes' }, { action: 'run', node: 'office-mac' })).toBe('node_operation');
    expect(inferIntent({ name: 'sessions_spawn', group: 'sessions' }, { task: 'foo' })).toBe('session_operation');
    expect(inferIntent({ name: 'memory_search', group: 'memory' }, { query: 'x' })).toBe('memory_access');
    expect(inferIntent({ name: 'edit', group: 'fs' }, { path: 'foo.ts' })).toBe('edit_file');
    expect(inferIntent({ name: 'bash', group: 'runtime' }, { command: 'echo hi' })).toBe('shell_command');
  });

  it('maps context for browser, nodes, sessions', () => {
    const browserCtx = mapToolContext({ name: 'browser', group: 'ui' }, { action: 'navigate', url: 'https://example.com' });
    expect(browserCtx.url).toBe('https://example.com');

    const nodesCtx = mapToolContext({ name: 'nodes', group: 'nodes' }, { action: 'run', node: 'office-mac', command: ['echo', 'hi'] });
    expect((nodesCtx.targets as { hosts?: string[] })?.hosts).toContain('node:office-mac');
    expect(nodesCtx.exec?.argv0).toBe('echo');
    expect(nodesCtx.exec?.argv).toEqual(['echo', 'hi']);

    const sessCtx = mapToolContext({ name: 'sessions_send', group: 'sessions' }, { sessionKey: 'main', message: 'hi' });
    expect((sessCtx.targets as { hosts?: string[] })?.hosts).toContain('session:main');
  });

  it('extracts channel/recipient for message tool from params and session context', () => {
    const fromParams = mapToolContext(
      { name: 'message', group: 'messaging' },
      { action: 'send', channel: 'whatsapp', target: '+1234567890', message: 'hi' }
    );
    expect(fromParams.channel).toBe('whatsapp');
    expect(fromParams.recipient).toBe('+1234567890');
    expect(fromParams.channel_display).toBe('whatsapp: +1234567890');

    const fromSession = mapToolContext(
      { name: 'message', group: 'messaging' },
      { action: 'send', message: 'hi' },
      { sessionContext: { channel: 'slack', target: 'C0AC28YRQF5' } }
    );
    expect(fromSession.channel).toBe('slack');
    expect(fromSession.recipient).toBe('C0AC28YRQF5');
    expect(fromSession.channel_display).toBe('slack: C0AC28YRQF5');
  });

  it('maps channel_display for gateway tools (whatsapp_login, slack, discord)', () => {
    const whatsapp = mapToolContext({ name: 'whatsapp_login', group: 'messaging' }, {});
    expect(whatsapp.channel).toBe('whatsapp');
    expect(whatsapp.channel_display).toBe('WhatsApp');

    const slack = mapToolContext({ name: 'slack', group: 'messaging' }, {});
    expect(slack.channel).toBe('slack');
    expect(slack.channel_display).toBe('Slack');

    const discord = mapToolContext({ name: 'discord', group: 'messaging' }, {});
    expect(discord.channel).toBe('discord');
    expect(discord.channel_display).toBe('Discord');

    const telegram = mapToolContext({ name: 'telegram_login', group: 'messaging' }, {});
    expect(telegram.channel).toBe('telegram');
    expect(telegram.channel_display).toBe('Telegram');
  });
});
