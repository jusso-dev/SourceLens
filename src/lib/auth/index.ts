import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { slugify } from "@/lib/slug";

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const baseSlug = slugify(user.name ?? user.email.split("@")[0] ?? "workspace");
          const slug = `${baseSlug}-${user.id.slice(0, 6).toLowerCase()}`;
          await prisma.workspace.create({
            data: {
              name: user.name ? `${user.name}'s workspace` : "My workspace",
              slug,
              ownerId: user.id,
              memberships: {
                create: { userId: user.id, role: "owner" },
              },
            },
          });
        },
      },
    },
  },
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
