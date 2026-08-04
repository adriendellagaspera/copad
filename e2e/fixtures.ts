import { test as base, expect } from '@playwright/test';

/**
 * Shared e2e fixtures.
 *
 * Editor flows here run solo (one page, no peers), so the P2P write gate is
 * eligible — but presence only holds `Alone` for `GATE_SETTLE_MS` before it
 * closes (contract §3.4's deferred-locking half), and every editor test clicks
 * and types well inside that grace window right after `goto()`. The gate's own
 * behaviour — including the explicit "Write alone anyway" escape hatch once it
 * does close — is covered directly in `intro.test.ts`.
 */

export const test = base;

export { expect };
