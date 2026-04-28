export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

export type MemberRole = 'owner' | 'member';

export interface Member {
  workspaceId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string;
}

export interface Channel {
  id: string;
  workspaceId: string;
  name: string;
  topic: string;
  createdById: string;
  createdAt: string;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
}

export type InvitationStatus = 'pending' | 'accepted' | 'expired';

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  invitedBy: string;
  status: InvitationStatus;
  createdAt: string;
}

export interface Label {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  createdAt: string;
}
