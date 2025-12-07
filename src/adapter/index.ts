import type { Dispatcher } from '../core/dispatcher/dispatcher.js';
import { MockClient } from './mock/mockClient.js';

/**
 * Start the mock CLI adapter for local development and debugging.
 * Reads user input from terminal and outputs bot responses to console.
 */
export function startMockAdapter(dispatcher: Dispatcher): void {
  const mockClient = new MockClient(dispatcher);
  mockClient.start();
}
