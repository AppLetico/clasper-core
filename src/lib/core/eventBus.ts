/**
 * Internal EventBus
 *
 * Lightweight typed event emitter for real-time event distribution.
 * Powers the SSE endpoint and can be consumed by any in-process listener.
 *
 * Events are emitted after writes (traces, decisions, audit, policies)
 * and carry tenant/workspace scoping for secure fan-out.
 */

import { EventEmitter } from "node:events";
import { v7 as uuidv7 } from "uuid";

// ============================================================================
// Event Types
// ============================================================================

export type ClasperEventType =
  | "trace.created"
  | "trace.completed"
  | "decision.created"
  | "decision.resolved"
  | "policy.created"
  | "policy.updated"
  | "policy.deleted"
  | "audit.entry"
  | "budget.threshold";

/**
 * Every event carries a consistent envelope for filtering and fan-out.
 */
export interface ClasperEvent {
  /** Unique event ID (uuidv7 — time-ordered for Last-Event-ID reconnection) */
  id: string;
  /** Event type */
  type: ClasperEventType;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Tenant scope */
  tenantId: string;
  /** Workspace scope (optional, not all events are workspace-scoped) */
  workspaceId?: string;
  /** Event-specific payload */
  payload: Record<string, unknown>;
}

// ============================================================================
// EventBus Class
// ============================================================================

const INTERNAL_EVENT = "clasper:event";

export class EventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    // Allow many SSE connections to subscribe without warnings
    this.emitter.setMaxListeners(0);
  }

  /**
   * Emit a typed event to all subscribers.
   */
  emit(
    type: ClasperEventType,
    data: {
      tenantId: string;
      workspaceId?: string;
      payload: Record<string, unknown>;
    }
  ): ClasperEvent {
    const event: ClasperEvent = {
      id: uuidv7(),
      type,
      timestamp: new Date().toISOString(),
      tenantId: data.tenantId,
      workspaceId: data.workspaceId,
      payload: data.payload,
    };

    this.emitter.emit(INTERNAL_EVENT, event);
    return event;
  }

  /**
   * Subscribe to all events. Caller is responsible for filtering.
   * Returns an unsubscribe function.
   */
  subscribe(listener: (event: ClasperEvent) => void): () => void {
    this.emitter.on(INTERNAL_EVENT, listener);
    return () => {
      this.emitter.off(INTERNAL_EVENT, listener);
    };
  }

  /**
   * Get the current number of listeners (for connection limiting).
   */
  listenerCount(): number {
    return this.emitter.listenerCount(INTERNAL_EVENT);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: EventBus | null = null;

/**
 * Get or create the global EventBus instance.
 */
export function getEventBus(): EventBus {
  if (!instance) {
    instance = new EventBus();
  }
  return instance;
}

/**
 * Reset the EventBus instance (for testing).
 */
export function resetEventBus(): void {
  instance = null;
}
