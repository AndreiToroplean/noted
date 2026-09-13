import { TestBed } from '@angular/core/testing';

/**
 * Let a flushed HTTP response reach the resource that asked for it, then run
 * effects and rendering.
 *
 * `HttpTestingController.flush` delivers on a later turn of the event loop, so
 * a resource's value is still the old one when `flush` returns. Awaiting this
 * between flushing and asserting is the difference between reading the response
 * and reading the default.
 */
export async function settle() {
  await new Promise(resolve => setTimeout(resolve));
  TestBed.tick();
}
