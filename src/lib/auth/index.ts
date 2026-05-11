import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db";
import { resetTemplate, sendEmail, verifyTemplate } from "@/lib/email";
import { env } from "@/lib/env";
import { slugify } from "@/lib/slug";

const REQUIRE_VERIFY =
  (process.env.BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION ?? "").toLowerCase() === "true";

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: !REQUIRE_VERIFY,
    minPasswordLength: 8,
    requireEmailVerification: REQUIRE_VERIFY,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail(
        resetTemplate({
          to: user.email,
          name: user.name ?? null,
          resetUrl: url,
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        }),
      );
    },
  },
  emailVerification: {
    sendOnSignUp: REQUIRE_VERIFY,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(
        verifyTemplate({
          to: user.email,
          name: user.name ?? null,
          verifyUrl: url,
          expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
        }),
      );
    },
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
