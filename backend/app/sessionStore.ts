import type { Session, SessionMessage, UserMessage } from "../domain/sessionTypes";
import type { PendingAction } from "./types/pendingAction";
import { createSession, addMessage } from "./sessionManager";

/**
 * In-memory session store.
 * Sessions survive process restart only in the sense that they're re-created
 * on the next request. Lifecycle is tied to the Node.js process.
 */
class SessionStore {
  private readonly sessions = new Map<string, Session>();
  // sessionId -> Set<pendingActionId>
  private readonly pendingActions = new Map<string, Set<string>>();

  getOrCreate(sessionId?: string): { session: Session; isNew: boolean } {
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing) return { session: existing, isNew: false };
    }
    const session = createSession();
    this.sessions.set(session.id, session);
    return { session, isNew: true };
  }

  addMessage(sessionId: string, message: SessionMessage): Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    const updated = addMessage(session, message);
    this.sessions.set(sessionId, updated);
    return updated;
  }

  getMessages(sessionId: string): SessionMessage[] {
    return this.sessions.get(sessionId)?.messages ?? [];
  }

  bindPendingAction(sessionId: string, pendingActionId: string): void {
    let set = this.pendingActions.get(sessionId);
    if (!set) {
      set = new Set();
      this.pendingActions.set(sessionId, set);
    }
    set.add(pendingActionId);
  }

  validatePendingAction(sessionId: string, pendingActionId: string): boolean {
    const set = this.pendingActions.get(sessionId);
    return set?.has(pendingActionId) ?? false;
  }

  removePendingAction(sessionId: string, pendingActionId: string): void {
    this.pendingActions.get(sessionId)?.delete(pendingActionId);
  }
}

export const sessionStore = new SessionStore();
