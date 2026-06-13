import {
  collection, addDoc, onSnapshot,
  query, orderBy, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';

export interface Location {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Timestamp | null;
}

export function subscribeToLocations(
  userId: string,
  callback: (locations: Location[]) => void
): () => void {
  const q = query(
    collection(db, `users/${userId}/locations`),
    orderBy('createdAt', 'asc')
  );
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({
      id: d.id,
      name: d.data().name ?? '',
      parentId: d.data().parentId ?? null,
      createdAt: d.data().createdAt ?? null,
    })));
  });
}

export async function createLocation(
  userId: string,
  name: string,
  parentId: string | null = null
): Promise<string> {
  const ref = await addDoc(collection(db, `users/${userId}/locations`), {
    name: name.trim(),
    parentId,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// Build a display path like "My House > Garage > Shelf B"
export function getLocationPath(locationId: string, allLocations: Location[]): string {
  const map = new Map(allLocations.map(l => [l.id, l]));
  const parts: string[] = [];
  let current = map.get(locationId);
  while (current) {
    parts.unshift(current.name);
    current = current.parentId ? map.get(current.parentId) : undefined;
  }
  return parts.join(' › ');
}

// Get direct children of a parent (null = top-level)
export function getLocationChildren(
  parentId: string | null,
  allLocations: Location[]
): Location[] {
  return allLocations.filter(l => l.parentId === parentId);
}

// All descendant ids of a location (children, grandchildren, …), excluding itself.
// Used to prevent moving a location under itself or any of its own descendants,
// which would create a cycle in the location tree.
export function getDescendantIds(
  locationId: string,
  allLocations: Location[]
): Set<string> {
  const result = new Set<string>();
  const stack = [locationId];
  while (stack.length) {
    const current = stack.pop()!;
    for (const child of allLocations.filter(l => l.parentId === current)) {
      if (!result.has(child.id)) {
        result.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return result;
}

// ---- Location Health Check (read-only, detect-and-warn) ----

export type HealthIssueType =
  | 'duplicate-siblings'
  | 'duplicate-top-level'
  | 'orphaned'
  | 'many-top-level';

export interface HealthIssue {
  type: HealthIssueType;
  severity: 'warning' | 'info';
  message: string;
  locationIds: string[];
}

// Soft threshold for the "many top-level locations" informational nudge.
export const MANY_TOP_LEVEL_THRESHOLD = 8;

// Pure analysis over already-loaded locations. No Firestore, no writes, no React.
// Returns an empty array when there are no issues.
export function getLocationHealthIssues(allLocations: Location[]): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const idSet = new Set(allLocations.map(l => l.id));
  const norm = (s: string) => s.trim().toLowerCase();

  // Group by parentId ('' represents top level for keying purposes).
  const byParent = new Map<string, Location[]>();
  for (const loc of allLocations) {
    const key = loc.parentId ?? '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(loc);
  }

  // Duplicate names among siblings (same parent). Top-level duplicates are
  // reported with their own type/wording.
  for (const [parentKey, siblings] of byParent) {
    const seen = new Map<string, Location[]>();
    for (const loc of siblings) {
      const n = norm(loc.name);
      if (!n) continue;
      if (!seen.has(n)) seen.set(n, []);
      seen.get(n)!.push(loc);
    }
    for (const [, group] of seen) {
      if (group.length < 2) continue;
      const displayName = group[0].name.trim();
      const ids = group.map(g => g.id);
      if (parentKey === '') {
        issues.push({
          type: 'duplicate-top-level',
          severity: 'warning',
          message: `You have ${group.length} top-level locations named “${displayName}”. Consider renaming one so they're easy to tell apart.`,
          locationIds: ids,
        });
      } else {
        const parent = allLocations.find(l => l.id === parentKey);
        const parentName = parent ? parent.name.trim() : 'a location';
        issues.push({
          type: 'duplicate-siblings',
          severity: 'warning',
          message: `${group.length} locations named “${displayName}” are under “${parentName}”. Consider renaming one (use Rename) so they're easy to tell apart.`,
          locationIds: ids,
        });
      }
    }
  }

  // Orphaned locations: non-null parentId pointing at a location that doesn't exist.
  // These won't appear in the tree, so the panel may be the only place to see them.
  for (const loc of allLocations) {
    if (loc.parentId !== null && !idSet.has(loc.parentId)) {
      issues.push({
        type: 'orphaned',
        severity: 'warning',
        message: `“${loc.name.trim() || 'A location'}” is attached to a location that no longer exists, so it may not appear in your list. Use Move to place it somewhere valid.`,
        locationIds: [loc.id],
      });
    }
  }

  // Many top-level locations: informational nudge only.
  const topLevel = allLocations.filter(l => l.parentId === null);
  if (topLevel.length > MANY_TOP_LEVEL_THRESHOLD) {
    issues.push({
      type: 'many-top-level',
      severity: 'info',
      message: `You have ${topLevel.length} top-level locations. You can tidy up by moving some under a parent location with Move.`,
      locationIds: [],
    });
  }

  return issues;
}
