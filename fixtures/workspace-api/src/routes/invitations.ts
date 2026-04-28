import { Router } from 'express';
import {
  getInvitationsByWorkspace,
  getInvitationById,
  createInvitation,
  updateInvitationStatus,
  deleteInvitation,
  getWorkspaceById,
} from '../store.js';

export const invitationsRouter = Router();

invitationsRouter.get('/by-workspace/:workspaceId', (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  res.json(getInvitationsByWorkspace(req.params.workspaceId));
});

invitationsRouter.post('/by-workspace/:workspaceId', (req, res) => {
  const { email, invitedBy } = req.body;
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email is required' });
    return;
  }
  if (!invitedBy || typeof invitedBy !== 'string') {
    res.status(400).json({ error: 'Inviter ID is required' });
    return;
  }
  const workspace = getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  const invitation = createInvitation(req.params.workspaceId, email, invitedBy);
  res.status(201).json(invitation);
});

invitationsRouter.get('/:id', (req, res) => {
  const invitation = getInvitationById(req.params.id);
  if (!invitation) {
    res.status(404).json({ error: 'Invitation not found' });
    return;
  }
  res.json(invitation);
});

invitationsRouter.post('/:id/accept', (req, res) => {
  const invitation = updateInvitationStatus(req.params.id, 'accepted');
  if (!invitation) {
    res.status(404).json({ error: 'Invitation not found' });
    return;
  }
  res.json(invitation);
});

invitationsRouter.delete('/:id', (req, res) => {
  const deleted = deleteInvitation(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Invitation not found' });
    return;
  }
  res.status(204).send();
});
