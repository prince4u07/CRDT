import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  collections: defineTable({
    // Stable identifier for a collaboration room, e.g. "demo-collection".
    slug: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Full Yjs document encoded as base64, so any client can bootstrap from it.
    crdtDocument: v.optional(v.string()),
    crdtUpdatedAt: v.optional(v.number()),
    version: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_updated_at", ["updatedAt"]),

  users: defineTable({
    name: v.string(),
    color: v.optional(v.string()),
    lastSeen: v.number(),
  }).index("by_last_seen", ["lastSeen"]),
});
