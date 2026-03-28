import { Router } from 'express';
import {
  getMessagesByChannel,
  getMessageById,
  createMessage,
  updateMessage,
  deleteMessage,
  getChannelById,
} from '../store.js';

export const messagesRouter = Router();

// Messages nested under channels for creation/listing
messagesRouter.get('/by-channel/:channelId', (req, res) => {
  const channel = getChannelById(req.params.channelId);
  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }
  res.json(getMessagesByChannel(req.params.channelId));
});

messagesRouter.post('/by-channel/:channelId', (req, res) => {
  const { authorId, content } = req.body;
  if (!authorId || typeof authorId !== 'string') {
    res.status(400).json({ error: 'Author ID is required' });
    return;
  }
  if (!content || typeof content !== 'string') {
    res.status(400).json({ error: 'Content is required' });
    return;
  }
  const channel = getChannelById(req.params.channelId);
  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }
  const message = createMessage(req.params.channelId, authorId, content);
  res.status(201).json(message);
});

// Direct message access by ID
messagesRouter.get('/:id', (req, res) => {
  const message = getMessageById(req.params.id);
  if (!message) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }
  res.json(message);
});

messagesRouter.patch('/:id', (req, res) => {
  const { content } = req.body;
  if (content !== undefined && typeof content !== 'string') {
    res.status(400).json({ error: 'Content must be a string' });
    return;
  }
  const message = updateMessage(req.params.id, { content });
  if (!message) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }
  res.json(message);
});

messagesRouter.delete('/:id', (req, res) => {
  const deleted = deleteMessage(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }
  res.status(204).send();
});
