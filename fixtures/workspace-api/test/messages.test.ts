import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearAll,
  createWorkspace,
  createChannel,
  createMessage,
  getMessagesByChannel,
  getMessageById,
  updateMessage,
  deleteMessage,
} from '../src/store.js';

describe('Workspace Store: messages', () => {
  beforeEach(() => {
    clearAll();
  });

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
