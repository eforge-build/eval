import { Router } from 'express';
import {
  getLabelsByWorkspace,
  getLabelById,
  createLabel,
  updateLabel,
  deleteLabel,
  getWorkspaceById,
} from '../store.js';

export const labelsRouter = Router();

labelsRouter.get('/by-workspace/:workspaceId', (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  res.json(getLabelsByWorkspace(req.params.workspaceId));
});

labelsRouter.post('/by-workspace/:workspaceId', (req, res) => {
  const { name, color } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Name is required' });
    return;
  }
  if (!color || typeof color !== 'string') {
    res.status(400).json({ error: 'Color is required' });
    return;
  }
  const workspace = getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  const label = createLabel(req.params.workspaceId, name, color);
  res.status(201).json(label);
});

labelsRouter.get('/:id', (req, res) => {
  const label = getLabelById(req.params.id);
  if (!label) {
    res.status(404).json({ error: 'Label not found' });
    return;
  }
  res.json(label);
});

labelsRouter.patch('/:id', (req, res) => {
  const { name, color } = req.body;
  if (name !== undefined && typeof name !== 'string') {
    res.status(400).json({ error: 'Name must be a string' });
    return;
  }
  if (color !== undefined && typeof color !== 'string') {
    res.status(400).json({ error: 'Color must be a string' });
    return;
  }
  const label = updateLabel(req.params.id, { name, color });
  if (!label) {
    res.status(404).json({ error: 'Label not found' });
    return;
  }
  res.json(label);
});

labelsRouter.delete('/:id', (req, res) => {
  const deleted = deleteLabel(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Label not found' });
    return;
  }
  res.status(204).send();
});
