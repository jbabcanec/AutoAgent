import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handleProvidersRoute(pathname: string, method: string, ctx: RouteContext): RouteResult | undefined {
  if (pathname === "/api/providers" && method === "GET") {
    return { status: 200, body: ctx.providers.list() };
  }
  return undefined;
}
