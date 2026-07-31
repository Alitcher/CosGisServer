import type { Event } from "@anime-con/shared";
import type { EventsRepo, EventInput } from "../repositories/events.repo";

/**
 * Events business logic. Sits between the controller (HTTP/validation) and the
 * repository (SQL). The status rules - admin creates go live, community
 * submissions land as pending, approval flips pending -> live - live HERE, so a
 * controller never has to remember them and the repo stays a dumb data store.
 */
export function eventsService(repo: EventsRepo) {
  return {
    /** Public read: only live conventions, optionally filtered by city. */
    listLive: (city?: string): Promise<Event[]> => repo.list({ status: "live", city }),

    /** Admin read: the community-submission queue awaiting approval. */
    listPending: (): Promise<Event[]> => repo.list({ status: "pending" }),

    get: (id: string): Promise<Event | null> => repo.get(id),

    /** Admin create - published immediately. */
    create: (input: Omit<EventInput, "status">): Promise<Event> =>
      repo.create({ ...input, status: "live" }),

    update: (id: string, patch: Partial<EventInput>): Promise<Event | null> =>
      repo.update(id, patch),

    remove: (id: string): Promise<void> => repo.remove(id),

    /** Public submission - lands in the pending queue for an admin to review. */
    submit: (input: Omit<EventInput, "status"> & { submittedBy?: string }): Promise<Event> =>
      repo.create({ ...input, status: "pending" }),

    /** Approve a pending submission -> it becomes a live event. */
    approve: (id: string): Promise<Event | null> => repo.update(id, { status: "live" }),
  };
}

export type EventsService = ReturnType<typeof eventsService>;
