import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearAll,
  createWorkspace,
  createLabel,
  getLabelsByWorkspace,
  getLabelById,
  updateLabel,
  deleteLabel,
  deleteWorkspace,
} from '../src/store.js';

describe('Workspace Store: labels', () => {
  beforeEach(() => {
    clearAll();
  });

  it('creates a label in a workspace', () => {
    const ws = createWorkspace('Team', 'user-1');
    const label = createLabel(ws.id, 'Urgent', '#ff0000');
    expect(label.name).toBe('Urgent');
    expect(label.color).toBe('#ff0000');
    expect(label.workspaceId).toBe(ws.id);
  });

  it('lists labels by workspace', () => {
    const ws = createWorkspace('Team', 'user-1');
    createLabel(ws.id, 'Urgent', '#ff0000');
    createLabel(ws.id, 'Backlog', '#00ff00');
    expect(getLabelsByWorkspace(ws.id)).toHaveLength(2);
  });

  it('gets a label by id', () => {
    const ws = createWorkspace('Team', 'user-1');
    const label = createLabel(ws.id, 'Urgent', '#ff0000');
    expect(getLabelById(label.id)).toEqual(label);
  });

  it('updates a label name', () => {
    const ws = createWorkspace('Team', 'user-1');
    const label = createLabel(ws.id, 'Urgent', '#ff0000');
    const updated = updateLabel(label.id, { name: 'Critical' });
    expect(updated?.name).toBe('Critical');
    expect(updated?.color).toBe('#ff0000');
  });

  it('updates a label color', () => {
    const ws = createWorkspace('Team', 'user-1');
    const label = createLabel(ws.id, 'Urgent', '#ff0000');
    const updated = updateLabel(label.id, { color: '#cc0000' });
    expect(updated?.color).toBe('#cc0000');
  });

  it('deletes a label', () => {
    const ws = createWorkspace('Team', 'user-1');
    const label = createLabel(ws.id, 'Urgent', '#ff0000');
    expect(deleteLabel(label.id)).toBe(true);
    expect(getLabelById(label.id)).toBeUndefined();
  });

  it('returns false when deleting missing label', () => {
    expect(deleteLabel('999')).toBe(false);
  });

  it('cascades label deletion when workspace is deleted', () => {
    const ws = createWorkspace('Team', 'user-1');
    createLabel(ws.id, 'Urgent', '#ff0000');
    deleteWorkspace(ws.id);
    expect(getLabelsByWorkspace(ws.id)).toHaveLength(0);
  });
});
