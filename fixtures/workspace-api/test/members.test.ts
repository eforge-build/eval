import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearAll,
  createWorkspace,
  getMembers,
  getMember,
  addMember,
  removeMember,
} from '../src/store.js';

describe('Workspace Store: members', () => {
  beforeEach(() => {
    clearAll();
  });

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
