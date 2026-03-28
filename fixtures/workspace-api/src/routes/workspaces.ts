import { Router } from 'express';
import {
  getAllWorkspaces,
  getWorkspaceById,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getMembers,
  addMember,
  removeMember,
} from '../store.js';

export const workspacesRouter = Router();

workspacesRouter.get('/', (_req, res) => {
  res.json(getAllWorkspaces());
});

workspacesRouter.get('/:id', (req, res) => {
  const workspace = getWorkspaceById(req.params.id);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  res.json(workspace);
});

workspacesRouter.post('/', (req, res) => {
  const { name, ownerId } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Name is required' });
    return;
  }
  if (!ownerId || typeof ownerId !== 'string') {
    res.status(400).json({ error: 'Owner ID is required' });
    return;
  }
  const workspace = createWorkspace(name, ownerId);
  res.status(201).json(workspace);
});

workspacesRouter.patch('/:id', (req, res) => {
  const { name } = req.body;
  if (name !== undefined && typeof name !== 'string') {
    res.status(400).json({ error: 'Name must be a string' });
    return;
  }
  const workspace = updateWorkspace(req.params.id, { name });
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  res.json(workspace);
});

workspacesRouter.delete('/:id', (req, res) => {
  const deleted = deleteWorkspace(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  res.status(204).send();
});

// --- Members ---

workspacesRouter.get('/:id/members', (req, res) => {
  const workspace = getWorkspaceById(req.params.id);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  res.json(getMembers(req.params.id));
});

workspacesRouter.post('/:id/members', (req, res) => {
  const { userId } = req.body;
  if (!userId || typeof userId !== 'string') {
    res.status(400).json({ error: 'User ID is required' });
    return;
  }
  const workspace = getWorkspaceById(req.params.id);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  const member = addMember(req.params.id, userId);
  res.status(201).json(member);
});

workspacesRouter.delete('/:id/members/:userId', (req, res) => {
  const removed = removeMember(req.params.id, req.params.userId);
  if (!removed) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }
  res.status(204).send();
});
