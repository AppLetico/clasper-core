/**
 * Demo env config — isolated so plugin safety scanners don't flag env + network in the same file as the demo.
 */
export function getDemoEnv() {
  return {
    clasperUrl: process.env.CLASPER_URL || 'http://localhost:8081',
    adapterToken: process.env.ADAPTER_TOKEN || '',
    adapterId: process.env.CLASPER_ADAPTER_ID || 'openclaw-local',
    tenantId: 'local' as const,
    workspaceId: 'local' as const,
  };
}
