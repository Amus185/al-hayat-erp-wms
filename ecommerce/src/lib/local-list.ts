"use client";

// A short list of product slugs kept in this browser's localStorage, read
// through useSyncExternalStore so every component stays in sync (also across
// tabs). Used for saved items and recently viewed products. Only slugs are
// stored: names, prices and photos are always fetched fresh.
import { useMemo, useSyncExternalStore } from "react";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface LocalList {
  useSlugs: () => string[];
  has: (slug: string) => boolean;
  add: (slug: string) => void;
  remove: (slug: string) => void;
  toggle: (slug: string) => boolean;
}

export function createLocalList(key: string, max: number, { newestFirst = false } = {}): LocalList {
  const event = `${key}-change`;

  const readRaw = (): string => {
    try {
      return localStorage.getItem(key) || "[]";
    } catch {
      return "[]";
    }
  };

  const parse = (raw: string): string[] => {
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.length <= 100 && SLUG.test(s)).slice(0, max) : [];
    } catch {
      return [];
    }
  };

  const write = (slugs: string[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(slugs.slice(0, max)));
    } catch { /* storage unavailable: the list simply will not persist */ }
    window.dispatchEvent(new Event(event));
  };

  const subscribe = (onChange: () => void) => {
    const onStorage = (e: StorageEvent) => { if (e.key === key) onChange(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(event, onChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(event, onChange);
    };
  };

  const has = (slug: string) => parse(readRaw()).includes(slug);
  const remove = (slug: string) => write(parse(readRaw()).filter((s) => s !== slug));
  const add = (slug: string) => {
    if (!SLUG.test(slug)) return;
    const rest = parse(readRaw()).filter((s) => s !== slug);
    write(newestFirst ? [slug, ...rest] : [...rest, slug]);
  };

  return {
    useSlugs() {
      // "[]" on the server and during hydration, the stored list right after.
      const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
      return useMemo(() => parse(raw), [raw]);
    },
    has,
    add,
    remove,
    toggle(slug) {
      if (has(slug)) { remove(slug); return false; }
      add(slug);
      return true;
    },
  };
}

export const savedItems = createLocalList("ah_saved_v1", 20, { newestFirst: true });
export const recentlyViewed = createLocalList("ah_recent_v1", 12, { newestFirst: true });
