import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const createCollection = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    slug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("collections", {
      name: args.name,
      description: args.description,
      slug: args.slug,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
  },
});

export const getCollection = query({
  args: { id: v.id("collections") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getCollectionBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("collections")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
  },
});

export const listCollections = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("collections")
      .order("desc")
      .take(args.limit ?? 100);
  },
});

/**
 * Store a Yjs snapshot. The version is bumped server-side so clients can tell
 * whether their copy is stale, and a payload that is not newer than the stored
 * one is ignored (an out-of-order debounced push from a slow tab is harmless).
 */
export const updateCRDTDocument = mutation({
  args: {
    id: v.id("collections"),
    crdtDocument: v.string(),
  },
  handler: async (ctx, args) => {
    const collection = await ctx.db.get(args.id);
    if (!collection) throw new Error(`collection ${args.id} not found`);

    const now = Date.now();
    await ctx.db.patch(args.id, {
      crdtDocument: args.crdtDocument,
      crdtUpdatedAt: now,
      updatedAt: now,
      version: (collection.version ?? 0) + 1,
    });
    return (collection.version ?? 0) + 1;
  },
});

export const renameCollection = mutation({
  args: {
    id: v.id("collections"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      updatedAt: Date.now(),
    });
  },
});

export const deleteCollection = mutation({
  args: { id: v.id("collections") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const touchUser = mutation({
  args: {
    name: v.string(),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeen: now, color: args.color });
      return existing._id;
    }
    return await ctx.db.insert("users", {
      name: args.name,
      color: args.color,
      lastSeen: now,
    });
  },
});

export const listActiveUsers = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("users")
      .order("desc")
      .take(50);
  },
});
