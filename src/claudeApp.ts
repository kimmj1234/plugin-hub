import type { Catalog, CatalogEntry, Plugin } from "./types";

const VALID_REF = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,199}$/;

export const APP_SURFACES = ["cowork", "claude_ai"];

export function usableInApp(e: CatalogEntry): boolean | null {
  if (e.surfaces.length === 0) return null;
  return e.surfaces.some((s) => APP_SURFACES.includes(s));
}

export function entryRef(e: CatalogEntry): string | null {
  if (e.directoryId && VALID_REF.test(e.directoryId)) return e.directoryId;
  return VALID_REF.test(e.pluginId) ? e.pluginId : null;
}

export function appPluginRef(p: Plugin, catalog: Catalog | null): string | null {
  const name = p.displayName.toLowerCase();
  const hit = catalog?.entries.find((e) => e.directoryId && e.name.toLowerCase() === name);
  if (hit?.directoryId) return hit.directoryId;
  const byName = `${p.displayName}@${p.marketplace}`;
  return VALID_REF.test(byName) ? byName : null;
}
