import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  collections: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    crdtDocument: v.optional(v.string()), // Store Yjs document binary as base64
    version: v.number(),
  }).index("by_updated_at", ["updatedAt"]),
  
  users: defineTable({
    name: v.string(),
    lastSeen: v.number(),
  }),
});
