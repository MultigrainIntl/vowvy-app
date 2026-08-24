import {
  collection,
  doc,
  getDocs,
  runTransaction,
  type Firestore,
} from 'firebase/firestore';

type SharedInventoryCollection = 'locations' | 'containers';

interface LegacyInventoryCandidate {
  collection: SharedInventoryCollection;
  id: string;
  locationId: string | null;
}

export interface SharedInventoryCompatibilityReport {
  ownerUid: string;
  scannedLocations: number;
  scannedContainers: number;
  repairableLocations: number;
  repairableContainers: number;
  privateRecordsSkipped: number;
  deletedRecordsSkipped: number;
  unsafeRecordsSkipped: number;
  candidates: readonly LegacyInventoryCandidate[];
}

export interface SharedInventoryRepairResult {
  repairedLocations: number;
  repairedContainers: number;
  recordsChangedSincePreview: number;
}

type RecordClassification = 'repairable' | 'ready' | 'private' | 'deleted' | 'unsafe';

function safeDocumentId(value: string): boolean {
  return value.length > 0 && !value.includes('/');
}

export function classifyLegacySharedInventoryRecord(
  data: Record<string, unknown>,
): RecordClassification {
  if (data.effectiveIsPrivate === true || data.visibility === 'private') {
    return 'private';
  }

  if (data.deletedAt !== undefined && data.deletedAt !== null) {
    return 'deleted';
  }

  if (
    data.effectiveIsPrivate !== false ||
    (data.visibility !== 'shared' && data.visibility !== 'inherit')
  ) {
    return 'unsafe';
  }

  return data.deletedAt === undefined ? 'repairable' : 'ready';
}

export async function inspectSharedInventoryCompatibility(
  firestore: Firestore,
  ownerUid: string,
): Promise<SharedInventoryCompatibilityReport> {
  if (!safeDocumentId(ownerUid)) throw new Error('invalid-owner');

  const [locations, containers] = await Promise.all([
    getDocs(collection(firestore, `users/${ownerUid}/locations`)),
    getDocs(collection(firestore, `users/${ownerUid}/containers`)),
  ]);

  const report: SharedInventoryCompatibilityReport = {
    ownerUid,
    scannedLocations: locations.docs.length,
    scannedContainers: containers.docs.length,
    repairableLocations: 0,
    repairableContainers: 0,
    privateRecordsSkipped: 0,
    deletedRecordsSkipped: 0,
    unsafeRecordsSkipped: 0,
    candidates: [],
  };
  const candidates: LegacyInventoryCandidate[] = [];
  const locationsById = new Map(locations.docs.map(item => [item.id, item.data()]));

  for (const [kind, snapshot] of [
    ['locations', locations],
    ['containers', containers],
  ] as const) {
    for (const record of snapshot.docs) {
      const data = record.data();
      const classification = classifyLegacySharedInventoryRecord(data);

      if (classification === 'private') {
        report.privateRecordsSkipped += 1;
        continue;
      }
      if (classification === 'deleted') {
        report.deletedRecordsSkipped += 1;
        continue;
      }
      if (classification !== 'repairable' || !safeDocumentId(record.id)) {
        if (classification === 'unsafe' || !safeDocumentId(record.id)) {
          report.unsafeRecordsSkipped += 1;
        }
        continue;
      }

      if (kind === 'containers') {
        const locationId = data.locationId;
        const parent = typeof locationId === 'string'
          ? locationsById.get(locationId)
          : undefined;
        const parentClassification = parent
          ? classifyLegacySharedInventoryRecord(parent)
          : 'unsafe';

        if (
          typeof locationId !== 'string' ||
          !safeDocumentId(locationId) ||
          (parentClassification !== 'repairable' && parentClassification !== 'ready')
        ) {
          report.unsafeRecordsSkipped += 1;
          continue;
        }

        report.repairableContainers += 1;
        candidates.push({ collection: kind, id: record.id, locationId });
      } else {
        report.repairableLocations += 1;
        candidates.push({ collection: kind, id: record.id, locationId: null });
      }
    }
  }

  report.candidates = candidates;
  return report;
}

export async function repairSharedInventoryCompatibility(
  firestore: Firestore,
  ownerUid: string,
  report: SharedInventoryCompatibilityReport,
): Promise<SharedInventoryRepairResult> {
  if (!safeDocumentId(ownerUid) || report.ownerUid !== ownerUid) {
    throw new Error('owner-mismatch');
  }

  const result: SharedInventoryRepairResult = {
    repairedLocations: 0,
    repairedContainers: 0,
    recordsChangedSincePreview: 0,
  };

  for (const candidate of report.candidates) {
    if (
      !safeDocumentId(candidate.id) ||
      (candidate.collection !== 'locations' && candidate.collection !== 'containers') ||
      (candidate.locationId !== null && !safeDocumentId(candidate.locationId))
    ) {
      throw new Error('invalid-repair-candidate');
    }

    const updated = await runTransaction(firestore, async transaction => {
      const recordRef = doc(
        firestore,
        `users/${ownerUid}/${candidate.collection}/${candidate.id}`,
      );
      const record = await transaction.get(recordRef);
      if (
        !record.exists() ||
        classifyLegacySharedInventoryRecord(record.data()) !== 'repairable'
      ) {
        return false;
      }

      if (candidate.collection === 'containers') {
        if (candidate.locationId === null) return false;
        if (record.data().locationId !== candidate.locationId) return false;

        const location = await transaction.get(
          doc(firestore, `users/${ownerUid}/locations/${candidate.locationId}`),
        );
        if (
          !location.exists() ||
          classifyLegacySharedInventoryRecord(location.data()) !== 'ready'
        ) {
          return false;
        }
      }

      transaction.update(recordRef, { deletedAt: null });
      return true;
    });

    if (!updated) {
      result.recordsChangedSincePreview += 1;
    } else if (candidate.collection === 'locations') {
      result.repairedLocations += 1;
    } else {
      result.repairedContainers += 1;
    }
  }

  return result;
}
