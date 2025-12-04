import type { Event, EventType } from '../model/Event.js';

export enum PipelineType {
  DirectMessage = 'dm',
  GroupChat = 'group',
  SystemEvent = 'system',
}

export interface PipelineConfig {
  type: PipelineType;
  description: string;
  priority: number; // higher = earlier
}

// Route event types to pipelines
export function determineRoute(event: Event): PipelineType {
  // System events go to system pipeline
  if (
    event.type === 'member.joined' ||
    event.type === 'member.left' ||
    event.type === 'system.notice' ||
    event.type === 'group.invite'
  ) {
    return PipelineType.SystemEvent;
  }

  // Check if it's a group event by checking for group field
  if ('message' in event && event.message && 'channelId' in event.message) {
    const message = event.message;
    // Heuristic: if message has group context, route to group
    if ((message as any).isGroupChat) {
      return PipelineType.GroupChat;
    }
  }

  // Default to DM pipeline for messages without explicit group context
  return PipelineType.DirectMessage;
}

export const PIPELINE_CONFIG: Record<PipelineType, PipelineConfig> = {
  [PipelineType.DirectMessage]: {
    type: PipelineType.DirectMessage,
    description: 'Direct message pipeline',
    priority: 10,
  },
  [PipelineType.GroupChat]: {
    type: PipelineType.GroupChat,
    description: 'Group chat pipeline',
    priority: 15,
  },
  [PipelineType.SystemEvent]: {
    type: PipelineType.SystemEvent,
    description: 'System event pipeline',
    priority: 5,
  },
};
