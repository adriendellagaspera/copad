import { test as base, expect } from '@playwright/test';

/**
 * Shared e2e fixtures.
 *
 * Editor flows here run solo (one page, no peers), so the P2P write-gate is
 * eligible. It needs no special handling: the gate yields on the writing gesture,
 * and every editor test clicks into the body before typing — that click opts into
 * writing solo and lifts the gate, with no lost keystroke. The gate's own behaviour
 * is covered directly in `intro.test.ts`.
 */

export const test = base;

export { expect };
