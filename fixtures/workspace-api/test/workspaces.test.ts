import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearAll,
  createWorkspace,
  getAllWorkspaces,
  getWorkspaceById,
  updateWorkspace,
  deleteWorkspace,
  getMembers,
  createChannel,
  getChannelsByWorkspace,
  createMessage,
  getMessagesByChannel,
} from '../src/store.js';

describe('Workspace Store: workspaces', () => {
  beforeEach(() => {
    clearAll();
  });

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
