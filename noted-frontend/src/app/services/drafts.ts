import { Injectable, signal } from '@angular/core';

/**
 * Edits left unsaved. Closing an editor — Esc, or clicking elsewhere — never
 * loses what was typed: it waits here, under the item it belongs to, and the
 * editor opens on it next time. Saving drops it.
 *
 * Kept for the session only. A draft is a pause, not a document.
 */
@Injectable({ providedIn: 'root' })
export class Drafts {
  private readonly drafts = signal<ReadonlyMap<string, unknown>>(new Map());

  get<T>(key: string): T | undefined {
    return this.drafts().get(key) as T | undefined;
  }

  keep(key: string, draft: unknown) {
    this.drafts.update(drafts => new Map(drafts).set(key, draft));
  }

  drop(key: string) {
    if (!this.drafts().has(key)) return;
    this.drafts.update(drafts => {
      const next = new Map(drafts);
      next.delete(key);
      return next;
    });
  }
}
