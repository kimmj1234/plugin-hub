import type { CatalogEntry, Plugin } from "./types";

export const APP_SURFACES = ["cowork", "claude_ai"];

export function usableInApp(e: CatalogEntry): boolean | null {
  if (e.surfaces.length === 0) return null;
  return e.surfaces.some((s) => APP_SURFACES.includes(s));
}

export function appPluginRef(p: Plugin): string | null {
  return p.appRef && /^plugin_[A-Za-z0-9]+$/.test(p.appRef) ? p.appRef : null;
}
