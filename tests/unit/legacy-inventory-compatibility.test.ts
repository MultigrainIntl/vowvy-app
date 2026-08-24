import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

type RecordData = Record<string, unknown>;

const firestoreMocks = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>();
  const writes: { path: string; data: Record<string, unknown> }[] = [];

  function snapshot(path: string) {
    const value = records.get(path);
    return {
      id: path.split('/').at(-1) ?? '',
      exists: () => value !== undefined,
      data: () => value,
    };
  }

  return {
    records,
    writes,
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    doc: vi.fn((_db: unknown, path: string) => ({ path })),
    getDocs: vi.fn(async ({ path }: { path: string }) => ({
      docs: Array.from(records.keys())
        .filter(key => key.startsWith(`${path}/`) &&
          !key.slice(path.length + 1).includes('/'))
        .map(snapshot),
    })),
    runTransaction: vi.fn(async (
      _db: unknown,
      callback: (transaction: {
        get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
        update: (ref: { path: string }, data: Record<string, unknown>) => void;
      }) => Promise<boolean>,
    ) => {
      return callback({
        get: async ({ path }) => snapshot(path),
        update: ({ path }, data) => {
          writes.push({ path, data });
          records.set(path, { ...records.get(path), ...data });
        },
      });
    }),
  };
});

vi.mock('firebase/firestore', () => ({
  collection: firestoreMocks.collection,
  doc: firestoreMocks.doc,
  getDocs: firestoreMocks.getDocs,
  runTransaction: firestoreMocks.runTransaction,
}));

import {
  classifyLegacySharedInventoryRecord,
  inspectSharedInventoryCompatibility,
  repairSharedInventoryCompatibility,
} from '../../src/collaboration/legacy-inventory-compatibility';

const firestore = {} as Firestore;
const ownerUid = 'owner-1';

function record(
  kind: 'locations' | 'containers',
  id: string,
  data: RecordData,
) {
  firestoreMocks.records.set(`users/${ownerUid}/${kind}/${id}`, data);
}

const shared = {
  visibility: 'inherit',
  effectiveIsPrivate: false,
};

describe('legacy shared inventory classification', () => {
  it('identifies only explicitly shared records missing deletion metadata', () => {
    expect(classifyLegacySharedInventoryRecord(shared)).toBe('repairable');
    expect(classifyLegacySharedInventoryRecord({ ...shared, deletedAt: null })).toBe('ready');
    expect(classifyLegacySharedInventoryRecord({ ...shared, deletedAt: 123 })).toBe('deleted');
    expect(classifyLegacySharedInventoryRecord({ ...shared, effectiveIsPrivate: true })).toBe('private');
    expect(classifyLegacySharedInventoryRecord({ ...shared, visibility: 'private' })).toBe('private');
    expect(classifyLegacySharedInventoryRecord({ visibility: 'inherit' })).toBe('unsafe');
    expect(classifyLegacySharedInventoryRecord({ effectiveIsPrivate: false })).toBe('unsafe');
  });
});

describe('owner-scoped shared inventory compatibility repair', () => {
  beforeEach(() => {
    firestoreMocks.records.clear();
    firestoreMocks.writes.length = 0;
    vi.clearAllMocks();
  });

  it('previews only the signed-in owner’s inventory without writing anything', async () => {
    record('locations', 'garage', { ...shared, name: 'Garage' });
    record('locations', 'ready', { ...shared, deletedAt: null });
    record('locations', 'private', { ...shared, effectiveIsPrivate: true });
    record('locations', 'deleted', { ...shared, deletedAt: 123 });
    record('locations', 'unknown', { visibility: 'inherit' });
    record('containers', 'toolbox', { ...shared, locationId: 'garage' });
    record('containers', 'orphan', { ...shared, locationId: 'missing-location' });
    record('containers', 'private-box', { ...shared, locationId: 'garage', visibility: 'private' });
    firestoreMocks.records.set('users/another-owner/locations/other', shared);

    const report = await inspectSharedInventoryCompatibility(firestore, ownerUid);

    expect(report).toMatchObject({
      ownerUid,
      scannedLocations: 5,
      scannedContainers: 3,
      repairableLocations: 1,
      repairableContainers: 1,
      privateRecordsSkipped: 2,
      deletedRecordsSkipped: 1,
      unsafeRecordsSkipped: 2,
    });
    expect(firestoreMocks.collection).toHaveBeenCalledWith(
      firestore,
      'users/owner-1/locations',
    );
    expect(firestoreMocks.collection).toHaveBeenCalledWith(
      firestore,
      'users/owner-1/containers',
    );
    expect(firestoreMocks.runTransaction).not.toHaveBeenCalled();
    expect(firestoreMocks.writes).toEqual([]);
  });

  it('adds only the missing deletion field while preserving all existing data', async () => {
    record('locations', 'garage', { ...shared, name: 'Garage' });
    record('containers', 'toolbox', { ...shared, name: 'Toolbox', locationId: 'garage' });

    const report = await inspectSharedInventoryCompatibility(firestore, ownerUid);
    const result = await repairSharedInventoryCompatibility(firestore, ownerUid, report);

    expect(result).toEqual({
      repairedLocations: 1,
      repairedContainers: 1,
      recordsChangedSincePreview: 0,
    });
    expect(firestoreMocks.writes).toEqual([
      { path: 'users/owner-1/locations/garage', data: { deletedAt: null } },
      { path: 'users/owner-1/containers/toolbox', data: { deletedAt: null } },
    ]);
    expect(firestoreMocks.records.get('users/owner-1/locations/garage')).toEqual({
      ...shared,
      name: 'Garage',
      deletedAt: null,
    });
  });

  it('never applies one owner’s preview to a different owner', async () => {
    record('locations', 'garage', shared);
    const report = await inspectSharedInventoryCompatibility(firestore, ownerUid);

    await expect(
      repairSharedInventoryCompatibility(firestore, 'another-owner', report),
    ).rejects.toThrow('owner-mismatch');
    expect(firestoreMocks.writes).toEqual([]);
  });

  it('does not modify records that became private or deleted after the preview', async () => {
    record('locations', 'now-private', shared);
    record('locations', 'now-deleted', shared);
    const report = await inspectSharedInventoryCompatibility(firestore, ownerUid);

    record('locations', 'now-private', { ...shared, effectiveIsPrivate: true });
    record('locations', 'now-deleted', { ...shared, deletedAt: 456 });
    const result = await repairSharedInventoryCompatibility(firestore, ownerUid, report);

    expect(result).toEqual({
      repairedLocations: 0,
      repairedContainers: 0,
      recordsChangedSincePreview: 2,
    });
    expect(firestoreMocks.writes).toEqual([]);
  });

  it('does not expose a container if its parent becomes private', async () => {
    record('locations', 'garage', { ...shared, deletedAt: null });
    record('containers', 'toolbox', { ...shared, locationId: 'garage' });
    const report = await inspectSharedInventoryCompatibility(firestore, ownerUid);

    record('locations', 'garage', {
      ...shared,
      effectiveIsPrivate: true,
      deletedAt: null,
    });
    const result = await repairSharedInventoryCompatibility(firestore, ownerUid, report);

    expect(result.recordsChangedSincePreview).toBe(1);
    expect(firestoreMocks.writes).toEqual([]);
  });

  it('does not update a container moved after the preview', async () => {
    record('locations', 'garage', { ...shared, deletedAt: null });
    record('locations', 'office', { ...shared, deletedAt: null });
    record('containers', 'toolbox', { ...shared, locationId: 'garage' });
    const report = await inspectSharedInventoryCompatibility(firestore, ownerUid);

    record('containers', 'toolbox', { ...shared, locationId: 'office' });
    const result = await repairSharedInventoryCompatibility(firestore, ownerUid, report);

    expect(result.recordsChangedSincePreview).toBe(1);
    expect(firestoreMocks.writes).toEqual([]);
  });

  it('rejects malformed owner identifiers before reading any records', async () => {
    await expect(
      inspectSharedInventoryCompatibility(firestore, 'owner-1/locations'),
    ).rejects.toThrow('invalid-owner');
    expect(firestoreMocks.collection).not.toHaveBeenCalled();
  });
});
