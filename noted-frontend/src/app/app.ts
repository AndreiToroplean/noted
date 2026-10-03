import { DatePipe } from '@angular/common';
import { Component, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { Footer } from 'app/components/footer/footer';
import { Topbar } from 'app/components/topbar/topbar';
import { Week } from 'app/components/week/week';
import { AppData } from 'app/services/app-data';
import { Selection } from 'app/services/selection';

@Component({
  selector: 'app-root',
  imports: [Week, Topbar, Footer],
  providers: [DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    class: 'contents',
    '(document:keydown)': 'onKeydown($event)',
    '(document:click)': 'onClick($event)',
  },
})
export class App {
  protected appData = inject(AppData);

  private readonly selection = inject(Selection);
  private readonly title = inject(Title);
  private readonly dates = inject(DatePipe);

  constructor() {
    // Named after the week being edited, so a bookmark or a row of tabs says
    // which week each one is.
    effect(() => {
      const week = this.appData.selectedWeek();
      this.title.setTitle(week ? `Noted – ${this.dates.transform(week)}` : 'Noted');
    });
  }

  /** App-wide shortcuts. A field being typed in keeps its own. */
  protected onKeydown(event: KeyboardEvent) {
    if (isTyping(event.target)) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (ctrl && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.appData.undo();
    } else if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault();
      this.appData.redo();
    } else if (event.key === 'Delete' && this.selection.size() > 0) {
      event.preventDefault();
      this.selection.deleteSelected();
    } else if (event.key === 'Escape') {
      this.selection.clear();
    }
  }

  /**
   * A click on nothing in particular lets go of the selection. Menus and dialogs
   * are exempt: they are usually acting on it.
   */
  protected onClick(event: MouseEvent) {
    const target = event.target;
    if (target instanceof Element && target.closest('[role="option"], .cdk-overlay-container')) {
      return;
    }
    this.selection.clear();
  }
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}
