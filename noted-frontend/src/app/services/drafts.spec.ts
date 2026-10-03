import { TestBed } from '@angular/core/testing';

import { Drafts } from 'app/services/drafts';

describe('Drafts', () => {
  it('keeps a draft until it is dropped', () => {
    const drafts = TestBed.inject(Drafts);
    expect(drafts.get('entry-1')).toBeUndefined();
    drafts.keep('entry-1', { text: 'Half', note: null });
    expect(drafts.get('entry-1')).toEqual({ text: 'Half', note: null });
    drafts.drop('entry-1');
    expect(drafts.get('entry-1')).toBeUndefined();
  });
});
