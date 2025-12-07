/**
 * Platform-agnostic action description.
 * Handlers return these, and adapters convert them to platform-specific API calls.
 */

export type ActionKind =
  | 'send_message'
  | 'recall_message'
  | 'edit_message'
  | 'react_to_message'
  | 'remove_reaction'
  | 'kick_member'
  | 'mute_member'
  | 'unmute_member'
  | 'edit_announcement'
  | 'set_group_name'
  | 'set_user_role'
  | 'forward_message'
  | 'invite_to_call';

export interface Action {
  kind: ActionKind;
  payload: Record<string, unknown>;
}

// ====== Helper factory functions for type safety ======

export interface MessageSegment {
  type: string;
  data: unknown;
}

export function sendMessage(params: {
  channelId: string;
  content: MessageSegment[];
  replyTo?: string;
}): Action {
  return {
    kind: 'send_message',
    payload: params,
  };
}

export function recallMessage(params: { messageId: string; channelId: string }): Action {
  return {
    kind: 'recall_message',
    payload: params,
  };
}

export function editMessage(params: {
  messageId: string;
  channelId: string;
  content: MessageSegment[];
}): Action {
  return {
    kind: 'edit_message',
    payload: params,
  };
}

export function reactToMessage(params: {
  messageId: string;
  channelId: string;
  emoji: string;
}): Action {
  return {
    kind: 'react_to_message',
    payload: params,
  };
}

export function removeReaction(params: {
  messageId: string;
  channelId: string;
  emoji: string;
}): Action {
  return {
    kind: 'remove_reaction',
    payload: params,
  };
}

export function kickMember(params: { groupId: string; userId: string; reason?: string }): Action {
  return {
    kind: 'kick_member',
    payload: params,
  };
}

export function muteMember(params: { groupId: string; userId: string; duration?: number }): Action {
  return {
    kind: 'mute_member',
    payload: params,
  };
}

export function unmuteMember(params: { groupId: string; userId: string }): Action {
  return {
    kind: 'unmute_member',
    payload: params,
  };
}

export function editAnnouncement(params: { groupId: string; announcement: string }): Action {
  return {
    kind: 'edit_announcement',
    payload: params,
  };
}

export function setGroupName(params: { groupId: string; name: string }): Action {
  return {
    kind: 'set_group_name',
    payload: params,
  };
}

export function setUserRole(params: {
  groupId: string;
  userId: string;
  role: 'admin' | 'member';
}): Action {
  return {
    kind: 'set_user_role',
    payload: params,
  };
}

export function forwardMessage(params: { messageId: string; targetChannelId: string }): Action {
  return {
    kind: 'forward_message',
    payload: params,
  };
}

export function inviteToCall(params: { channelId: string; userIds: string[] }): Action {
  return {
    kind: 'invite_to_call',
    payload: params,
  };
}
