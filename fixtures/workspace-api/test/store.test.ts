import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearAll,
  createWorkspace,
  getAllWorkspaces,
  getWorkspaceById,
  updateWorkspace,
  deleteWorkspace,
  getMembers,
  getMember,
  addMember,
  removeMember,
  createChannel,
  getChannelsByWorkspace,
  getChannelById,
  updateChannel,
  deleteChannel,
  createMessage,
  getMessagesByChannel,
  getMessageById,
  updateMessage,
  deleteMessage,
} from '../src/store.js';

describe('Workspace Store', () => {
  beforeEach(() => {
    clearAll();
  });

  // --- Workspaces ---

  describe('workspaces', () => {
    it('creates a workspace and auto-adds owner as member', () => {
      const ws = createWorkspace('Acme', 'user-1');
      expect(ws.name).toBe('Acme');
      expect(ws.ownerId).toBe('user-1');
      expect(ws.id).toBeDefined();

      const members = getMembers(ws.id);
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe('user-1');
      expect(members[0].role).toBe('owner');
    });

    it('lists all workspaces', () => {
      createWorkspace('First', 'user-1');
      createWorkspace('Second', 'user-2');
      expect(getAllWorkspaces()).toHaveLength(2);
    });

    it('gets a workspace by id', () => {
      const ws = createWorkspace('Test', 'user-1');
      const found = getWorkspaceById(ws.id);
      expect(found).toEqual(ws);
    });

    it('returns undefined for missing workspace', () => {
      expect(getWorkspaceById('999')).toBeUndefined();
    });

    it('updates a workspace', () => {
      const ws = createWorkspace('Old Name', 'user-1');
      const updated = updateWorkspace(ws.id, { name: 'New Name' });
      expect(updated?.name).toBe('New Name');
    });

    it('deletes a workspace and cascades to members, channels, messages', () => {
      const ws = createWorkspace('Delete Me', 'user-1');
      const ch = createChannel(ws.id, 'general', 'General chat', 'user-1');
      createMessage(ch.id, 'user-1', 'Hello');

      expect(deleteWorkspace(ws.id)).toBe(true);
      expect(getAllWorkspaces()).toHaveLength(0);
      expect(getMembers(ws.id)).toHaveLength(0);
      expect(getChannelsByWorkspace(ws.id)).toHaveLength(0);
      expect(getMessagesByChannel(ch.id)).toHaveLength(0);
    });

    it('returns false when deleting missing workspace', () => {
      expect(deleteWorkspace('999')).toBe(false);
    });
  });

  // --- Members ---

  describe('members', () => {
    it('adds a member to a workspace', () => {
      const ws = createWorkspace('Team', 'user-1');
      const member = addMember(ws.id, 'user-2');
      expect(member.userId).toBe('user-2');
      expect(member.role).toBe('member');
    });

    it('does not duplicate members', () => {
      const ws = createWorkspace('Team', 'user-1');
      addMember(ws.id, 'user-2');
      addMember(ws.id, 'user-2');
      expect(getMembers(ws.id)).toHaveLength(2); // owner + user-2
    });

    it('gets a specific member', () => {
      const ws = createWorkspace('Team', 'user-1');
      addMember(ws.id, 'user-2');
      const member = getMember(ws.id, 'user-2');
      expect(member?.role).toBe('member');
    });

    it('removes a member', () => {
      const ws = createWorkspace('Team', 'user-1');
      addMember(ws.id, 'user-2');
      expect(removeMember(ws.id, 'user-2')).toBe(true);
      expect(getMembers(ws.id)).toHaveLength(1); // only owner remains
    });

    it('returns false when removing non-existent member', () => {
      const ws = createWorkspace('Team', 'user-1');
      expect(removeMember(ws.id, 'user-99')).toBe(false);
    });
  });

  // --- Channels ---

  describe('channels', () => {
    it('creates a channel in a workspace', () => {
      const ws = createWorkspace('Team', 'user-1');
      const ch = createChannel(ws.id, 'general', 'General discussion', 'user-1');
      expect(ch.name).toBe('general');
      expect(ch.workspaceId).toBe(ws.id);
      expect(ch.topic).toBe('General discussion');
    });

    it('lists channels by workspace', () => {
      const ws = createWorkspace('Team', 'user-1');
      createChannel(ws.id, 'general', '', 'user-1');
      createChannel(ws.id, 'random', '', 'user-1');
      expect(getChannelsByWorkspace(ws.id)).toHaveLength(2);
    });

    it('gets a channel by id', () => {
      const ws = createWorkspace('Team', 'user-1');
      const ch = createChannel(ws.id, 'general', '', 'user-1');
      expect(getChannelById(ch.id)).toEqual(ch);
    });

    it('updates a channel', () => {
      const ws = createWorkspace('Team', 'user-1');
      const ch = createChannel(ws.id, 'general', '', 'user-1');
      const updated = updateChannel(ch.id, { topic: 'New topic' });
      expect(updated?.topic).toBe('New topic');
    });

    it('deletes a channel and its messages', () => {
      const ws = createWorkspace('Team', 'user-1');
      const ch = createChannel(ws.id, 'general', '', 'user-1');
      createMessage(ch.id, 'user-1', 'Hello');

      expect(deleteChannel(ch.id)).toBe(true);
      expect(getChannelsByWorkspace(ws.id)).toHaveLength(0);
      expect(getMessagesByChannel(ch.id)).toHaveLength(0);
    });
  });

  // --- Messages ---

  describe('messages', () => {
    it('creates a message in a channel', () => {
      const ws = createWorkspace('Team', 'user-1');
      const ch = createChannel(ws.id, 'general', '', 'user-1');
      const msg = createMessage(ch.id, 'user-1', 'Hello world');
      expect(msg.content).toBe('Hello world');
      expect(msg.authorId).toBe('user-1');
      expect(msg.channelId).toBe(ch.id);
      expect(msg.editedAt).toBeNull();
    });

    it('lists messages by channel', () => {
      const ws = createWorkspace('Team', 'user-1');
      const ch = createChannel(ws.id, 'general', '', 'user-1');
      createMessage(ch.id, 'user-1', 'First');
      createMessage(ch.id, 'user-2', 'Second');
      expect(getMessagesByChannel(ch.id)).toHaveLength(2);
    });

    it('gets a message by id', () => {
      const ws = createWorkspace('Team', 'user-1');
      const ch = createChannel(ws.id, 'general', '', 'user-1');
      const msg = createMessage(ch.id, 'user-1', 'Test');
      expect(getMessageById(msg.id)).toEqual(msg);
    });

    it('updates a message and sets editedAt', () => {
      const ws = createWorkspace('Team', 'user-1');
      const ch = createChannel(ws.id, 'general', '', 'user-1');
      const msg = createMessage(ch.id, 'user-1', 'Original');
      const updated = updateMessage(msg.id, { content: 'Edited' });
      expect(updated?.content).toBe('Edited');
      expect(updated?.editedAt).not.toBeNull();
    });

    it('deletes a message', () => {
      const ws = createWorkspace('Team', 'user-1');
      const ch = createChannel(ws.id, 'general', '', 'user-1');
      const msg = createMessage(ch.id, 'user-1', 'Delete me');
      expect(deleteMessage(msg.id)).toBe(true);
      expect(getMessagesByChannel(ch.id)).toHaveLength(0);
    });

    it('returns false when deleting missing message', () => {
      expect(deleteMessage('999')).toBe(false);
    });
  });
});
