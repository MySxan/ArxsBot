import type { Platform } from './Event.js';
import type { MessageSegment } from './Message.js';

export enum ActionType {
  SendMessage = 'send.message',
  RecallMessage = 'recall.message',
  EditMessage = 'edit.message',
  ReactToMessage = 'react.message',
  RemoveReaction = 'remove.reaction',
  KickMember = 'kick.member',
  MuteMember = 'mute.member',
  UnmuteMember = 'unmute.member',
  EditAnnouncement = 'edit.announcement',
  SetGroupName = 'set.group.name',
  SetUserRole = 'set.user.role',
}

export interface BaseAction {
  type: ActionType;
  platform: Platform;
}

export interface SendMessageAction extends BaseAction {
  type: ActionType.SendMessage;
  channelId: string;
  content: MessageSegment[];
  replyTo?: string; // message ID to reply to
}

export interface RecallMessageAction extends BaseAction {
  type: ActionType.RecallMessage;
  messageId: string;
  channelId: string;
}

export interface EditMessageAction extends BaseAction {
  type: ActionType.EditMessage;
  messageId: string;
  channelId: string;
  content: MessageSegment[];
}

export interface ReactToMessageAction extends BaseAction {
  type: ActionType.ReactToMessage;
  messageId: string;
  channelId: string;
  emoji: string;
}

export interface RemoveReactionAction extends BaseAction {
  type: ActionType.RemoveReaction;
  messageId: string;
  channelId: string;
  emoji: string;
}

export interface KickMemberAction extends BaseAction {
  type: ActionType.KickMember;
  groupId: string;
  userId: string;
  reason?: string;
}

export interface MuteMemberAction extends BaseAction {
  type: ActionType.MuteMember;
  groupId: string;
  userId: string;
  duration?: number; // seconds, 0 = permanent
}

export interface UnmuteMemberAction extends BaseAction {
  type: ActionType.UnmuteMember;
  groupId: string;
  userId: string;
}

export interface EditAnnouncementAction extends BaseAction {
  type: ActionType.EditAnnouncement;
  groupId: string;
  announcement: string;
}

export interface SetGroupNameAction extends BaseAction {
  type: ActionType.SetGroupName;
  groupId: string;
  name: string;
}

export interface SetUserRoleAction extends BaseAction {
  type: ActionType.SetUserRole;
  groupId: string;
  userId: string;
  role: 'admin' | 'member';
}

export type Action =
  | SendMessageAction
  | RecallMessageAction
  | EditMessageAction
  | ReactToMessageAction
  | RemoveReactionAction
  | KickMemberAction
  | MuteMemberAction
  | UnmuteMemberAction
  | EditAnnouncementAction
  | SetGroupNameAction
  | SetUserRoleAction;
