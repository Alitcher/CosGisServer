import type { Place } from "@anime-con/shared";
import type { PlacesRepo, PlaceInput } from "../repositories/places.repo";

/**
 * Places business logic. Same shape as the events service on purpose - the two
 * entities share a status/submission/approval workflow, which is exactly why
 * they now live in one service instead of two. Places just add type/city
 * filtering on the public list.
 */
export function placesService(repo: PlacesRepo) {
  return {
    /** Public read: only live places, optionally filtered by type and/or city. */
    listLive: (filter?: { type?: string; city?: string }): Promise<Place[]> =>
      repo.list({ status: "live", ...filter }),

    /** Admin read: the community-submission queue awaiting approval. */
    listPending: (): Promise<Place[]> => repo.list({ status: "pending" }),

    get: (id: string): Promise<Place | null> => repo.get(id),

    /** Admin create - published immediately. */
    create: (input: Omit<PlaceInput, "status">): Promise<Place> =>
      repo.create({ ...input, status: "live" }),

    update: (id: string, patch: Partial<PlaceInput>): Promise<Place | null> =>
      repo.update(id, patch),

    remove: (id: string): Promise<void> => repo.remove(id),

    /** Public submission - lands in the pending queue for an admin to review. */
    submit: (input: Omit<PlaceInput, "status"> & { submittedBy?: string }): Promise<Place> =>
      repo.create({ ...input, status: "pending" }),

    /** Approve a pending submission -> it becomes a live place. */
    approve: (id: string): Promise<Place | null> => repo.update(id, { status: "live" }),
  };
}

export type PlacesService = ReturnType<typeof placesService>;
