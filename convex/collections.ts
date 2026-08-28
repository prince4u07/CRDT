import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const createCollection = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const collectionId = await ctx.db.insert("collections", {
      name: args.name,
      description: args.description,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    return collectionId;
  },
});

export const getCollection = query({
  args: { id: v.id("collections") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const listCollections = query({
  handler: async (ctx) => {
    return await ctx.db.query("collections").order("desc").collect();
  },
});

export const updateCRDTDocument = mutation({
  args: {
    id: v.id("collections"),
    crdtDocument: v.string(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    const { id, crdtDocument, version } = args;
    await ctx.db.patch(id, {
      crdtDocument,
      version,
      updatedAt: Date.now(),
    });
  },
});
