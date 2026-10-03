import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';

import { settle } from 'testing/settle';

import { API_BASE } from 'app/services/api';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('names the tab after the week being edited', async () => {
    // So a bookmark or a row of tabs says which week each one is.
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .match(`${API_BASE}/weeks`)
      .forEach(request => request.flush(['2026-02-09']));
    await settle();

    expect(TestBed.inject(Title).getTitle()).toBe('Noted – week of 9 Feb 2026');
  });
});
