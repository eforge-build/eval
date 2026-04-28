import express from 'express';
import { workspacesRouter } from './routes/workspaces.js';
import { channelsRouter } from './routes/channels.js';
import { messagesRouter } from './routes/messages.js';
import { membersRouter } from './routes/members.js';
import { invitationsRouter } from './routes/invitations.js';
import { labelsRouter } from './routes/labels.js';

export const app = express();

app.use(express.json());
app.use('/workspaces', workspacesRouter);
app.use('/channels', channelsRouter);
app.use('/messages', messagesRouter);
app.use('/members', membersRouter);
app.use('/invitations', invitationsRouter);
app.use('/labels', labelsRouter);
