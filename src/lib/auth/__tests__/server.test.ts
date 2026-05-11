import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    membership: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  ForbiddenError,
  UnauthorizedError,
  requireCurrentWorkspace,
  requireUser,
  requireWorkspaceAccess,
} from "../server";

const getSession = vi.mocked(auth.api.getSession);
const findFirst = vi.mocked(prisma.membership.findFirst);
const findUnique = vi.mocked(prisma.membership.findUnique);
const userFindUnique = vi.mocked(prisma.user.findUnique);
const userUpdate = vi.mocked(prisma.user.update);

const USER = { id: "u1", email: "demo@example.com", name: "Demo" } as const;
const WS = { id: "w1", name: "Demo WS", slug: "demo" } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireUser", () => {
  it("throws Unauthorized when no session", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws Unauthorized when session has no user", async () => {
    getSession.mockResolvedValue({ user: null } as never);
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("returns the user when session is valid", async () => {
    getSession.mockResolvedValue({ user: USER } as never);
    await expect(requireUser()).resolves.toEqual(USER);
  });
});

describe("requireCurrentWorkspace", () => {
  it("throws Unauthorized for unauthenticated callers", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireCurrentWorkspace()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws Forbidden when user has no memberships", async () => {
    getSession.mockResolvedValue({ user: USER } as never);
    userFindUnique.mockResolvedValue({ currentWorkspaceId: null } as never);
    findFirst.mockResolvedValue(null);
    await expect(requireCurrentWorkspace()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("uses currentWorkspaceId when set and membership still exists", async () => {
    getSession.mockResolvedValue({ user: USER } as never);
    userFindUnique.mockResolvedValue({ currentWorkspaceId: WS.id } as never);
    findUnique.mockResolvedValue({ role: "admin", workspace: WS, workspaceId: WS.id } as never);
    const res = await requireCurrentWorkspace();
    expect(res.workspace).toEqual(WS);
    expect(res.role).toBe("admin");
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("falls back to earliest membership and self-heals currentWorkspaceId", async () => {
    getSession.mockResolvedValue({ user: USER } as never);
    userFindUnique.mockResolvedValue({ currentWorkspaceId: null } as never);
    findFirst.mockResolvedValue({ role: "owner", workspace: WS, workspaceId: WS.id } as never);
    userUpdate.mockResolvedValue({} as never);
    const res = await requireCurrentWorkspace();
    expect(res.role).toBe("owner");
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: USER.id },
      data: { currentWorkspaceId: WS.id },
    });
  });
});

describe("requireWorkspaceAccess", () => {
  it("throws Forbidden when caller is not a member of the workspace", async () => {
    getSession.mockResolvedValue({ user: USER } as never);
    findUnique.mockResolvedValue(null);
    await expect(requireWorkspaceAccess("w-other")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("looks up membership by (userId, workspaceId) composite key", async () => {
    getSession.mockResolvedValue({ user: USER } as never);
    findUnique.mockResolvedValue({ role: "member", workspace: WS } as never);
    await requireWorkspaceAccess(WS.id);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_workspaceId: { userId: USER.id, workspaceId: WS.id } },
      }),
    );
  });
});
