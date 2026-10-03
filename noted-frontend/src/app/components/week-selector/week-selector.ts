import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal, viewChild } from '@angular/core';

import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTabsModule } from '@angular/material/tabs';

import { ConfirmDeleteWeek } from 'app/components/confirm-delete-week/confirm-delete-week';
import { IsoDate } from 'app/services/api';
import { AppData } from 'app/services/app-data';

@Component({
  selector: 'app-week-selector',
  imports: [DatePipe, MatTabsModule, MatMenuModule, MatIconModule],
  templateUrl: './week-selector.html',
})
export class WeekSelector {
  protected readonly appData = inject(AppData);

  protected readonly selectedIndex = computed(() =>
    this.appData.weekList().indexOf(this.appData.selectedWeek() ?? ''),
  );

  protected selectWeek(index: number) {
    const week = this.appData.weekList()[index];
    if (week) this.appData.selectedWeek.set(week);
  }

  private readonly dialog = inject(MatDialog);

  /** The week a right-click landed on, and where, for the menu to open there. */
  protected readonly menuWeek = signal<IsoDate | null>(null);
  protected readonly menuAt = signal({ x: 0, y: 0 });
  private readonly weekMenu = viewChild.required<MatMenuTrigger>('weekMenuTrigger');

  protected onContextMenu(event: MouseEvent) {
    const week = this.weekOfTab(event.target);
    if (!week) return;
    event.preventDefault();
    this.menuWeek.set(week);
    this.menuAt.set({ x: event.clientX, y: event.clientY });
    this.weekMenu().openMenu();
  }

  /** Delete on a focused tab, which the arrow keys move between. */
  protected onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Delete') return;
    const week = this.weekOfTab(event.target);
    if (!week) return;
    event.preventDefault();
    this.confirmDelete(week);
  }

  /** Always asks: unlike everything inside a week, deleting one can't be undone. */
  protected confirmDelete(week: IsoDate | null) {
    if (!week) return;
    this.dialog
      .open<ConfirmDeleteWeek, IsoDate, boolean>(ConfirmDeleteWeek, { data: week })
      .afterClosed()
      .subscribe(confirmed => {
        if (confirmed) void this.appData.deleteWeek(week);
      });
  }

  /** The week whose tab an event came from, if any. */
  private weekOfTab(target: EventTarget | null): IsoDate | null {
    const tab = target instanceof Element ? target.closest('[role="tab"]') : null;
    if (!tab?.parentElement) return null;
    const index = [...tab.parentElement.querySelectorAll('[role="tab"]')].indexOf(tab);
    return this.appData.weekList()[index] ?? null;
  }
}
