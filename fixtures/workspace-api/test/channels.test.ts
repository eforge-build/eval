import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearAll,
  createWorkspace,
  createChannel,
  getChannelsByWorkspace,
  getChannelById,
  updateChannel,
  deleteChannel,
  createMessage,
  getMessagesByChannel,
} from '../src/store.js';

describe('Workspace Store: channels', () => {
  beforeEach(() => {
    clearAll();
  });

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
