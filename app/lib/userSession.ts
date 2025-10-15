//user session to prevent more than one rating by any one user

'use client';

import { v4 as uuidv4 } from 'uuid';

const SESSION_KEY = 'user_session_id';

/**
 * Get or create a user session ID for anonymous tracking
 * Stored in localStorage for persistence across page reloads
 */
export function getUserSessionId(): string {
  if (typeof window === 'undefined') {
    return ''; // Server-side, return empty string
  }

  let sessionId = localStorage.getItem(SESSION_KEY);

  if (!sessionId) {
    sessionId = uuidv4();
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  return sessionId;
}

/**
 * Clear the current user session (useful for testing)
 */
export function clearUserSession(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SESSION_KEY);
  }
}

/**
 * Check if a session ID exists
 */
export function hasUserSession(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return localStorage.getItem(SESSION_KEY) !== null;
}
