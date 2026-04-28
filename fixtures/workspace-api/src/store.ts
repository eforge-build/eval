import type {
  Workspace,
  Member,
  MemberRole,
  Channel,
  Message,
  Invitation,
  InvitationStatus,
  Label,
} from './types.js';

// --- State ---

let workspaces: Workspace[] = [];
let members: Member[] = [];
let channels: Channel[] = [];
let messages: Message[] = [];
let invitations: Invitation[] = [];
let labels: Label[] = [];

let nextWorkspaceId = 1;
let nextChannelId = 1;
let nextMessageId = 1;
let nextInvitationId = 1;
let nextLabelId = 1;

// --- Workspaces ---

export function getAllWorkspaces(): Workspace[] {
  return [...workspaces];
}

export function getWorkspaceById(id: string): Workspace | undefined {
  return workspaces.find((w) => w.id === id);
}

export function createWorkspace(name: string, ownerId: string): Workspace {
  const workspace: Workspace = {
    id: String(nextWorkspaceId++),
    name,
    ownerId,
    createdAt: new Date().toISOString(),
  };
  workspaces.push(workspace);
  // Auto-add owner as a member
  addMember(workspace.id, ownerId, 'owner');
  return workspace;
}

export function updateWorkspace(
  id: string,
  updates: Partial<Pick<Workspace, 'name'>>,
): Workspace | undefined {
  const workspace = workspaces.find((w) => w.id === id);
  if (!workspace) return undefined;
  if (updates.name !== undefined) workspace.name = updates.name;
  return { ...workspace };
}

export function deleteWorkspace(id: string): boolean {
  const index = workspaces.findIndex((w) => w.id === id);
  if (index === -1) return false;
  workspaces.splice(index, 1);
  // Cascade: remove members, channels, messages, invitations, and labels
  const channelIds = channels.filter((c) => c.workspaceId === id).map((c) => c.id);
  members = members.filter((m) => m.workspaceId !== id);
  channels = channels.filter((c) => c.workspaceId !== id);
  messages = messages.filter((m) => !channelIds.includes(m.channelId));
  invitations = invitations.filter((inv) => inv.workspaceId !== id);
  labels = labels.filter((l) => l.workspaceId !== id);
  return true;
}

// --- Members ---

export function getMembers(workspaceId: string): Member[] {
  return members.filter((m) => m.workspaceId === workspaceId);
}

export function getMember(workspaceId: string, userId: string): Member | undefined {
  return members.find((m) => m.workspaceId === workspaceId && m.userId === userId);
}

export function addMember(
  workspaceId: string,
  userId: string,
  role: MemberRole = 'member',
): Member {
  const existing = getMember(workspaceId, userId);
  if (existing) return existing;
  const member: Member = {
    workspaceId,
    userId,
    role,
    joinedAt: new Date().toISOString(),
  };
  members.push(member);
  return member;
}

export function removeMember(workspaceId: string, userId: string): boolean {
  const index = members.findIndex(
    (m) => m.workspaceId === workspaceId && m.userId === userId,
  );
  if (index === -1) return false;
  members.splice(index, 1);
  return true;
}

// --- Channels ---

export function getChannelsByWorkspace(workspaceId: string): Channel[] {
  return channels.filter((c) => c.workspaceId === workspaceId);
}

export function getChannelById(id: string): Channel | undefined {
  return channels.find((c) => c.id === id);
}

export function createChannel(
  workspaceId: string,
  name: string,
  topic: string,
  createdById: string,
): Channel {
  const channel: Channel = {
    id: String(nextChannelId++),
    workspaceId,
    name,
    topic,
    createdById,
    createdAt: new Date().toISOString(),
  };
  channels.push(channel);
  return channel;
}

export function updateChannel(
  id: string,
  updates: Partial<Pick<Channel, 'name' | 'topic'>>,
): Channel | undefined {
  const channel = channels.find((c) => c.id === id);
  if (!channel) return undefined;
  if (updates.name !== undefined) channel.name = updates.name;
  if (updates.topic !== undefined) channel.topic = updates.topic;
  return { ...channel };
}

export function deleteChannel(id: string): boolean {
  const index = channels.findIndex((c) => c.id === id);
  if (index === -1) return false;
  channels.splice(index, 1);
  // Cascade: remove messages in this channel
  messages = messages.filter((m) => m.channelId !== id);
  return true;
}

// --- Messages ---

export function getMessagesByChannel(channelId: string): Message[] {
  return messages.filter((m) => m.channelId === channelId);
}

export function getMessageById(id: string): Message | undefined {
  return messages.find((m) => m.id === id);
}

export function createMessage(
  channelId: string,
  authorId: string,
  content: string,
): Message {
  const message: Message = {
    id: String(nextMessageId++),
    channelId,
    authorId,
    content,
    createdAt: new Date().toISOString(),
    editedAt: null,
  };
  messages.push(message);
  return message;
}

export function updateMessage(
  id: string,
  updates: Partial<Pick<Message, 'content'>>,
): Message | undefined {
  const message = messages.find((m) => m.id === id);
  if (!message) return undefined;
  if (updates.content !== undefined) {
    message.content = updates.content;
    message.editedAt = new Date().toISOString();
  }
  return { ...message };
}

export function deleteMessage(id: string): boolean {
  const index = messages.findIndex((m) => m.id === id);
  if (index === -1) return false;
  messages.splice(index, 1);
  return true;
}

// --- Invitations ---

export function getInvitationsByWorkspace(workspaceId: string): Invitation[] {
  return invitations.filter((inv) => inv.workspaceId === workspaceId);
}

export function getInvitationById(id: string): Invitation | undefined {
  return invitations.find((inv) => inv.id === id);
}

export function createInvitation(
  workspaceId: string,
  email: string,
  invitedBy: string,
): Invitation {
  const invitation: Invitation = {
    id: String(nextInvitationId++),
    workspaceId,
    email,
    invitedBy,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  invitations.push(invitation);
  return invitation;
}

export function updateInvitationStatus(
  id: string,
  status: InvitationStatus,
): Invitation | undefined {
  const invitation = invitations.find((inv) => inv.id === id);
  if (!invitation) return undefined;
  invitation.status = status;
  return { ...invitation };
}

export function deleteInvitation(id: string): boolean {
  const index = invitations.findIndex((inv) => inv.id === id);
  if (index === -1) return false;
  invitations.splice(index, 1);
  return true;
}

// --- Labels ---

export function getLabelsByWorkspace(workspaceId: string): Label[] {
  return labels.filter((l) => l.workspaceId === workspaceId);
}

export function getLabelById(id: string): Label | undefined {
  return labels.find((l) => l.id === id);
}

export function createLabel(
  workspaceId: string,
  name: string,
  color: string,
): Label {
  const label: Label = {
    id: String(nextLabelId++),
    workspaceId,
    name,
    color,
    createdAt: new Date().toISOString(),
  };
  labels.push(label);
  return label;
}

export function updateLabel(
  id: string,
  updates: Partial<Pick<Label, 'name' | 'color'>>,
): Label | undefined {
  const label = labels.find((l) => l.id === id);
  if (!label) return undefined;
  if (updates.name !== undefined) label.name = updates.name;
  if (updates.color !== undefined) label.color = updates.color;
  return { ...label };
}

export function deleteLabel(id: string): boolean {
  const index = labels.findIndex((l) => l.id === id);
  if (index === -1) return false;
  labels.splice(index, 1);
  return true;
}

// --- Reset ---

export function clearAll(): void {
  workspaces = [];
  members = [];
  channels = [];
  messages = [];
  invitations = [];
  labels = [];
  nextWorkspaceId = 1;
  nextChannelId = 1;
  nextMessageId = 1;
  nextInvitationId = 1;
  nextLabelId = 1;
}
