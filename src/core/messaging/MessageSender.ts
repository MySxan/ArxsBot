/**
 * Unified message sending interface.
 * All platform adapters should implement this to send messages.
 */
export interface MessageSender {
  /**
   * Send plain text message to a group/channel.
   * @param groupId - Target group/channel ID
   * @param text - Message text content
   * @param replyTo - Optional: message ID to reply to
   */
  sendText(groupId: string, text: string, replyTo?: string): Promise<void>;

  // Future extensions:
  // sendImage(groupId: string, imageUrl: string): Promise<void>;
  // sendSticker(groupId: string, stickerId: string): Promise<void>;
  // recallMessage(messageId: string): Promise<void>;
}
