# Refactor `src/store.ts` to Per-Entity Service Classes (Wide Mechanical Rename)

## Overview

`src/store.ts` is a single ~340-line file holding the state and ~30 free-function exports for six entities — workspaces, members, channels, messages, invitations, labels. Every entity follows the same shape (state arrays, ID counters, `getX`, `getXById`, `createX`, `updateX`, `deleteX` functions). Six routes (`src/routes/<entity>.ts`) and six test files (`test/<entity>.test.ts`) import these functions individually.

This refactor is a **wide mechanical rename**: split the monolith into one service class per entity, rename every call site from free-function form (`getWorkspaceById(id)`) to method form (`workspaceService.getById(id)`), and split the corresponding types file. The work is structurally homogeneous, files form **disjoint per-entity sets**, and the operation is repeated identically for each of the six entities — properties that make it well-suited to parallel implementation.

The refactor is **strictly internal**. Every existing HTTP route, status code, and JSON response shape stays identical. Every existing test stays semantically identical (only call-site syntax changes). No new behavior, no new endpoints, no new entities, no public surface changes.

## Target structure

After the refactor:

```
src/
  app.ts                      (unchanged)
  index.ts                    (unchanged)
  types.ts                    (becomes barrel: re-exports from src/types/*)
  store.ts                    (becomes barrel: re-exports the six service singletons + clearAll)
  types/
    workspaces.ts             (NEW — Workspace interface)
    members.ts                (NEW — MemberRole, Member)
    channels.ts               (NEW — Channel)
    messages.ts               (NEW — Message)
    invitations.ts            (NEW — InvitationStatus, Invitation)
    labels.ts                 (NEW — Label)
  services/
    workspaces.ts             (NEW — WorkspaceService class + workspaceService singleton)
    members.ts                (NEW — MemberService class + memberService singleton)
    channels.ts               (NEW — ChannelService class + channelService singleton)
    messages.ts               (NEW — MessageService class + messageService singleton)
    invitations.ts            (NEW — InvitationService class + invitationService singleton)
    labels.ts                 (NEW — LabelService class + labelService singleton)
  routes/
    workspaces.ts             (MODIFIED — call sites use workspaceService.X instead of free functions)
    members.ts                (MODIFIED — same)
    channels.ts               (MODIFIED — same)
    messages.ts               (MODIFIED — same)
    invitations.ts            (MODIFIED — same)
    labels.ts                 (MODIFIED — same)
test/
  workspaces.test.ts          (MODIFIED — call sites use workspaceService.X)
  members.test.ts             (MODIFIED — same)
  channels.test.ts            (MODIFIED — same)
  messages.test.ts            (MODIFIED — same)
  invitations.test.ts         (MODIFIED — same)
  labels.test.ts              (MODIFIED — same)
```

**File count:** 12 new files, 14 modified files, 0 deleted files (old `store.ts` and `types.ts` are repurposed as barrels). The work is identical in shape across each of the six entity verticals; the per-entity file sets are fully disjoint.

## Service class API (uniform across all six entities)

Each service class wraps its entity's state and exposes the existing CRUD as methods. The class encapsulates the array, the next-id counter, and the cascade behavior. The mapping from free function to method is mechanical and one-to-one.

### Method-name mapping

For all six entities, free-function names map to method names by stripping the entity suffix and lowercasing the first letter:

| Free function (existing)                | Service method (new)                    |
| ---                                     | ---                                     |
| `getAllWorkspaces()`                    | `workspaceService.getAll()`             |
| `getWorkspaceById(id)`                  | `workspaceService.getById(id)`          |
| `createWorkspace(name, ownerId)`        | `workspaceService.create(name, ownerId)`|
| `updateWorkspace(id, updates)`          | `workspaceService.update(id, updates)`  |
| `deleteWorkspace(id)`                   | `workspaceService.delete(id)`           |
| `getMembers(workspaceId)`               | `memberService.getByWorkspace(workspaceId)` |
| `getMember(workspaceId, userId)`        | `memberService.get(workspaceId, userId)`|
| `addMember(workspaceId, userId, role?)` | `memberService.add(workspaceId, userId, role?)` |
| `removeMember(workspaceId, userId)`     | `memberService.remove(workspaceId, userId)` |
| `getChannelsByWorkspace(workspaceId)`   | `channelService.getByWorkspace(workspaceId)` |
| `getChannelById(id)`                    | `channelService.getById(id)`            |
| `createChannel(workspaceId, name, topic, createdById)` | `channelService.create(workspaceId, name, topic, createdById)` |
| `updateChannel(id, updates)`            | `channelService.update(id, updates)`    |
| `deleteChannel(id)`                     | `channelService.delete(id)`             |
| `getMessagesByChannel(channelId)`       | `messageService.getByChannel(channelId)`|
| `getMessageById(id)`                    | `messageService.getById(id)`            |
| `createMessage(channelId, authorId, content)` | `messageService.create(channelId, authorId, content)` |
| `updateMessage(id, updates)`            | `messageService.update(id, updates)`    |
| `deleteMessage(id)`                     | `messageService.delete(id)`             |
| `getInvitationsByWorkspace(workspaceId)`| `invitationService.getByWorkspace(workspaceId)` |
| `getInvitationById(id)`                 | `invitationService.getById(id)`         |
| `createInvitation(workspaceId, email, invitedBy)` | `invitationService.create(workspaceId, email, invitedBy)` |
| `updateInvitationStatus(id, status)`    | `invitationService.updateStatus(id, status)` |
| `deleteInvitation(id)`                  | `invitationService.delete(id)`          |
| `getLabelsByWorkspace(workspaceId)`     | `labelService.getByWorkspace(workspaceId)` |
| `getLabelById(id)`                      | `labelService.getById(id)`              |
| `createLabel(workspaceId, name, color)` | `labelService.create(workspaceId, name, color)` |
| `updateLabel(id, updates)`              | `labelService.update(id, updates)`      |
| `deleteLabel(id)`                       | `labelService.delete(id)`               |
| `clearAll()`                            | (kept as a free function in `src/store.ts` — calls `.clear()` on each service singleton) |

Each service class also exposes a `clear(): void` method that resets its own array and ID counter. `clearAll()` (still exported from `src/store.ts`) is implemented as:

```ts
export function clearAll(): void {
  workspaceService.clear();
  memberService.clear();
  channelService.clear();
  messageService.clear();
  invitationService.clear();
  labelService.clear();
}
```

### Cascading deletes

Cascade behavior currently encoded in `deleteWorkspace` (removes members, channels, messages, invitations, labels) and `deleteChannel` (removes messages) must be preserved. Implement cascades inside the source service's `delete` method by directly invoking the relevant peer-service singletons. Example:

```ts
// WorkspaceService.delete(id)
//   → calls memberService.removeByWorkspace(id)
//   → calls channelService.deleteByWorkspace(id)  // channelService.delete handles message cascade per-channel
//   → calls invitationService.deleteByWorkspace(id)
//   → calls labelService.deleteByWorkspace(id)
//   → removes the workspace itself
```

You may add helper methods (`removeByWorkspace`, `deleteByWorkspace`) on each service as needed to support cascades. They are internal helpers — not part of the route surface.

## Barrel files

`src/store.ts` and `src/types.ts` are converted to thin barrels for backwards compatibility. Every name currently exported from these files must remain importable from the same path with the same signature.

`src/store.ts` (after refactor, ~40 lines):
```ts
export { workspaceService, memberService, channelService, messageService, invitationService, labelService } from './services/...';

// Backwards-compat re-exports of the legacy free-function API.
// These are thin wrappers that delegate to the service singletons.
export const getAllWorkspaces = () => workspaceService.getAll();
export const getWorkspaceById = (id: string) => workspaceService.getById(id);
// ... (one re-export per legacy free function)

export function clearAll(): void { /* see above */ }
```

`src/types.ts` (after refactor, ~10 lines):
```ts
export type { Workspace } from './types/workspaces.js';
export type { Member, MemberRole } from './types/members.js';
export type { Channel } from './types/channels.js';
export type { Message } from './types/messages.js';
export type { Invitation, InvitationStatus } from './types/invitations.js';
export type { Label } from './types/labels.js';
```

## Call-site rewrite scope

The mechanical rename touches every call site of every legacy free function. Approximate counts (per entity, summed across that entity's route + test file): each entity has ~10–15 call sites. Across all six entities, that is **~70–90 call sites** to update, distributed across **12 files** (6 routes + 6 tests). Imports in those files also change from `'../src/store.js'` (or `'../store.js'`) to the corresponding `services/<entity>.js` path.

The rewrite per file is purely textual — no behavioral changes, no signature changes, no type changes beyond the import paths. Each entity's per-file edits are independent of every other entity's.

## Non-goals

- No new HTTP endpoints, routes, or status codes
- No changes to JSON request/response shapes
- No new entities or domain features
- No persistence layer — stores remain in-memory
- No DI containers, decorators, or external libraries — plain TypeScript module-singleton services
- No changes to `src/index.ts`, `src/app.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts`
- No changes to the public free-function API exported from `src/store.ts` (the barrel preserves it)

## Acceptance criteria

The PRD is satisfied if and only if:

1. `src/services/<entity>.ts` exists for each of the six entities, exporting both the class and a singleton instance with the method names from the mapping table above.
2. `src/types/<entity>.ts` exists for each of the six entities, exporting that entity's interfaces/types.
3. `src/types.ts` is a barrel re-exporting all types from `src/types/*`.
4. `src/store.ts` is a barrel that (a) re-exports the six service singletons, (b) preserves all legacy free-function exports as thin delegates, and (c) preserves `clearAll()`.
5. Every route file in `src/routes/` imports from `src/services/<entity>.js` (not from `src/store.js`) and uses the service-method API at every call site.
6. Every test file in `test/` imports from `src/services/<entity>.js` (not from `src/store.js`) and uses the service-method API at every call site.
7. `pnpm type-check` passes.
8. `pnpm test` passes all 39 existing tests across `test/{workspaces,members,channels,messages,invitations,labels}.test.ts` with no behavioral changes.
9. Cascading deletes are preserved (deleting a workspace still removes its members, channels, messages, invitations, and labels; deleting a channel still removes its messages).
