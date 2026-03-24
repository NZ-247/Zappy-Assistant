interface AuthHookApp {
  addHook: (name: string, handler: (...args: any[]) => Promise<unknown> | unknown) => unknown;
}

export const registerAdminAuthHook = (app: AuthHookApp, adminApiToken: string): void => {
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/admin")) return;
    const token = request.headers.authorization?.replace("Bearer ", "");
    if (token !== adminApiToken) return reply.status(401).send({ error: "Unauthorized" });
  });
};
