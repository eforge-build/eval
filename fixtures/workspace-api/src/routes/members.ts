import { Router } from 'express';
import {
  getMembers,
  getMember,
  addMember,
  removeMember,
  getWorkspaceById,
} from '../store.js';
import type { MemberRole } from '../types.js';

export const membersRouter = Router();

membersRouter.get('/by-workspace/:workspaceId', (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  res.json(getMembers(req.params.workspaceId));
});

membersRouter.get('/by-workspace/:workspaceId/:userId', (req, res) => {
  const member = getMember(req.params.workspaceId, req.params.userId);
  if (!member) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }
  res.json(member);
});

membersRouter.post('/by-workspace/:workspaceId', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || typeof userId !== 'string') {
    res.status(400).json({ error: 'User ID is required' });
    return;
  }
  if (role !== undefined && role !== 'owner' && role !== 'member') {
    res.status(400).json({ error: 'Role must be "owner" or "member"' });
    return;
  }
  const workspace = getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  const member = addMember(
    req.params.workspaceId,
    userId,
    (role as MemberRole | undefined) ?? 'member',
  );
  res.status(201).json(member);
});

membersRouter.delete('/by-workspace/:workspaceId/:userId', (req, res) => {
  const removed = removeMember(req.params.workspaceId, req.params.userId);
  if (!removed) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }
  res.status(204).send();
});
