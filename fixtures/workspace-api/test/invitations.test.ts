import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearAll,
  createWorkspace,
  createInvitation,
  getInvitationsByWorkspace,
  getInvitationById,
  updateInvitationStatus,
  deleteInvitation,
  deleteWorkspace,
} from '../src/store.js';

describe('Workspace Store: invitations', () => {
  beforeEach(() => {
    clearAll();
  });

  it('creates an invitation in a workspace', () => {
    const ws = createWorkspace('Team', 'user-1');
    const inv = createInvitation(ws.id, 'invitee@example.com', 'user-1');
    expect(inv.email).toBe('invitee@example.com');
    expect(inv.invitedBy).toBe('user-1');
    expect(inv.workspaceId).toBe(ws.id);
    expect(inv.status).toBe('pending');
  });

  it('lists invitations by workspace', () => {
    const ws = createWorkspace('Team', 'user-1');
    createInvitation(ws.id, 'a@example.com', 'user-1');
    createInvitation(ws.id, 'b@example.com', 'user-1');
    expect(getInvitationsByWorkspace(ws.id)).toHaveLength(2);
  });

  it('gets an invitation by id', () => {
    const ws = createWorkspace('Team', 'user-1');
    const inv = createInvitation(ws.id, 'a@example.com', 'user-1');
    expect(getInvitationById(inv.id)).toEqual(inv);
  });

  it('updates invitation status to accepted', () => {
    const ws = createWorkspace('Team', 'user-1');
    const inv = createInvitation(ws.id, 'a@example.com', 'user-1');
    const updated = updateInvitationStatus(inv.id, 'accepted');
    expect(updated?.status).toBe('accepted');
  });

  it('updates invitation status to expired', () => {
    const ws = createWorkspace('Team', 'user-1');
    const inv = createInvitation(ws.id, 'a@example.com', 'user-1');
    const updated = updateInvitationStatus(inv.id, 'expired');
    expect(updated?.status).toBe('expired');
  });

  it('deletes an invitation', () => {
    const ws = createWorkspace('Team', 'user-1');
    const inv = createInvitation(ws.id, 'a@example.com', 'user-1');
    expect(deleteInvitation(inv.id)).toBe(true);
    expect(getInvitationById(inv.id)).toBeUndefined();
  });

  it('returns false when deleting missing invitation', () => {
    expect(deleteInvitation('999')).toBe(false);
  });

  it('cascades invitation deletion when workspace is deleted', () => {
    const ws = createWorkspace('Team', 'user-1');
    createInvitation(ws.id, 'a@example.com', 'user-1');
    deleteWorkspace(ws.id);
    expect(getInvitationsByWorkspace(ws.id)).toHaveLength(0);
  });
});
