import express from 'express';
import { workspacesRouter } from './routes/workspaces.js';
import { channelsRouter } from './routes/channels.js';
import { messagesRouter } from './routes/messages.js';

export const app = express();

app.use(express.json());
app.use('/workspaces', workspacesRouter);
app.use('/channels', channelsRouter);
app.use('/messages', messagesRouter);
