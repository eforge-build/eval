import { Router } from 'express';
import {
  getChannelsByWorkspace,
  getChannelById,
  createChannel,
  updateChannel,
  deleteChannel,
  getWorkspaceById,
} from '../store.js';

export const channelsRouter = Router();

// Channels nested under workspaces for creation/listing
channelsRouter.get('/by-workspace/:workspaceId', (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  res.json(getChannelsByWorkspace(req.params.workspaceId));
});

channelsRouter.post('/by-workspace/:workspaceId', (req, res) => {
  const { name, topic, createdById } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Name is required' });
    return;
  }
  if (!createdById || typeof createdById !== 'string') {
    res.status(400).json({ error: 'Creator ID is required' });
    return;
  }
  const workspace = getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  const channel = createChannel(
    req.params.workspaceId,
    name,
    typeof topic === 'string' ? topic : '',
    createdById,
  );
  res.status(201).json(channel);
});

// Direct channel access by ID
channelsRouter.get('/:id', (req, res) => {
  const channel = getChannelById(req.params.id);
  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }
  res.json(channel);
});

channelsRouter.patch('/:id', (req, res) => {
  const { name, topic } = req.body;
  if (name !== undefined && typeof name !== 'string') {
    res.status(400).json({ error: 'Name must be a string' });
    return;
  }
  if (topic !== undefined && typeof topic !== 'string') {
    res.status(400).json({ error: 'Topic must be a string' });
    return;
  }
  const channel = updateChannel(req.params.id, { name, topic });
  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }
  res.json(channel);
});

channelsRouter.delete('/:id', (req, res) => {
  const deleted = deleteChannel(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }
  res.status(204).send();
});
