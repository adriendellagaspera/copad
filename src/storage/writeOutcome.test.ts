import { describe, it, expect } from 'vitest';
import { classifyHttpStatus, ClassifiedWriteError, writeFailure, landed, skipped, WriteLanding, WriteSkip, WriteFailureKind } from './writeOutcome.js';

describe('classifyHttpStatus', () => {
  it('maps auth failures to Denied', () => {
    expect(classifyHttpStatus(401)).toBe(WriteFailureKind.Denied);
    expect(classifyHttpStatus(403)).toBe(WriteFailureKind.Denied);
  });

  it('maps 404 to Missing', () => {
    expect(classifyHttpStatus(404)).toBe(WriteFailureKind.Missing);
  });

  it('maps conflict-shaped statuses to Contended', () => {
    expect(classifyHttpStatus(400)).toBe(WriteFailureKind.Contended);
    expect(classifyHttpStatus(409)).toBe(WriteFailureKind.Contended);
    expect(classifyHttpStatus(423)).toBe(WriteFailureKind.Contended);
  });

  it('maps rate-limit and server errors to Transient', () => {
    expect(classifyHttpStatus(429)).toBe(WriteFailureKind.Transient);
    expect(classifyHttpStatus(500)).toBe(WriteFailureKind.Transient);
    expect(classifyHttpStatus(503)).toBe(WriteFailureKind.Transient);
  });

  it('falls back to Unknown for anything else', () => {
    expect(classifyHttpStatus(418)).toBe(WriteFailureKind.Unknown);
  });
});

describe('writeFailure / ClassifiedWriteError', () => {
  it('carries its kind through instanceof narrowing', () => {
    const err = writeFailure(WriteFailureKind.Contended, 'stale sha');
    expect(err).toBeInstanceOf(ClassifiedWriteError);
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe(WriteFailureKind.Contended);
    expect(err.message).toBe('stale sha');
  });
});

describe('landed / skipped', () => {
  it('landed() reports Landed', () => {
    expect(landed()).toEqual({ landing: WriteLanding.Landed });
  });

  it('skipped() carries its reason', () => {
    expect(skipped(WriteSkip.Coalesced)).toEqual({ landing: WriteLanding.Skipped, why: WriteSkip.Coalesced });
  });
});
