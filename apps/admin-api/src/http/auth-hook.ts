interface AuthHookApp {
  addHook: (name: string, handler: (...args: any[]) => Promise<unknown> | unknown) => unknown;
}

const parseBearerToken = (authorizationHeader?: string): string | null => {
  if (!authorizationHeader) return null;
  const trimmed = authorizationHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  return trimmed.slice(7).trim() || null;
};

export const registerAdminAuthHook = (app: AuthHookApp, adminApiToken: string): void => {
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/admin")) return;

    const bearerToken = parseBearerToken(request.headers.authorization);
    const headerToken = typeof request.headers["x-admin-token"] === "string" ? request.headers["x-admin-token"] : null;
    const token = bearerToken ?? headerToken;

    if (!token || token !== adminApiToken) {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
    }
  });
};
