import {
  collection, addDoc, onSnapshot,
  query, orderBy, serverTimestamp, Timestamp, where,
} from 'firebase/firestore';
import { db } from './firebase';

export type Visibility = "inherit" | "private" | "shared";

export interface Location {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Timestamp | null;
  visibility: Visibility;
  effectiveIsPrivate: boolean;
}

export function subscribeToLocations(
  userId: string,
  callback: (locations: Location[]) => void,
  sharedView = false,
  onError?: (error: Error) => void,
): () => void {
  const q = query(
    collection(db, `users/${userId}/locations`),
    ...(sharedView
      ? [where('effectiveIsPrivate', '==', false)]
      : [orderBy('createdAt', 'asc')])
  );
  return onSnapshot(q, snap => {
    const locations = snap.docs.map(d => ({
      id: d.id,
      name: d.data().name ?? '',
      parentId: d.data().parentId ?? null,
      createdAt: d.data().createdAt ?? null,
      visibility: (d.data().visibility ?? 'inherit') as Visibility,
      effectiveIsPrivate: d.data().effectiveIsPrivate ?? false,
    }));
    locations.sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));
    callback(locations);
  }, error => onError?.(error));
}

export async function createLocation(
  userId: string,
  name: string,
  parentId: string | null = null,
  parentEffectiveIsPrivate = false,
): Promise<string> {
  const ref = await addDoc(collection(db, `users/${userId}/locations`), {
    name: name.trim(),
    parentId,
    createdAt: serverTimestamp(),
    visibility: 'inherit',
    effectiveIsPrivate: parentEffectiveIsPrivate,
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

// ---- Starter location templates (new-user onboarding) ----

export interface StarterNode {
  name: string;
  children?: StarterNode[];
}

// Recursively writes a tree of StarterNodes as real Location documents.
// Sequential writes preserve createdAt order for orderBy('createdAt','asc').
export async function writeStarterTree(
  userId: string,
  nodes: StarterNode[],
  parentId: string | null,
): Promise<void> {
  for (const node of nodes) {
    const id = await createLocation(userId, node.name, parentId);
    if (node.children?.length) {
      await writeStarterTree(userId, node.children, id);
    }
  }
}

export interface HomeAnswers {
  bedrooms: number;
  bathrooms: number;
  extras: string[];
  storage: string[];
  vehicles: number;  // 0 = none, 1–3 = Vehicle 1 … Vehicle N
}

export interface MovingAnswers {
  bedrooms: number;
  includeGarage: boolean;
}

export type StorageSize = 'small' | 'medium' | 'large';

const EXTRA_ORDER = [
  'Kitchen', 'Living Room', 'Dining Room', 'Office',
  'Garage', 'Basement', 'Attic', 'Laundry Room', 'Storage Room', 'Patio / Outdoor',
];

export function buildHomeTree(a: HomeAnswers): StarterNode[] {
  const children: StarterNode[] = [];
  const withClosets      = a.storage.includes('Bedroom closets');
  const withPantry       = a.storage.includes('Pantry');
  const withGarageShelves = a.storage.includes('Garage shelves');
  const withLinenCloset  = a.storage.includes('Linen closet');
  const withUtilityCloset = a.storage.includes('Utility closet');

  for (let i = 1; i <= Math.min(a.bedrooms, 8); i++) {
    const node: StarterNode = { name: a.bedrooms === 1 ? 'Bedroom' : `Bedroom ${i}` };
    if (withClosets) node.children = [{ name: 'Closet' }];
    children.push(node);
  }
  for (let i = 1; i <= Math.min(a.bathrooms, 6); i++) {
    children.push({ name: a.bathrooms === 1 ? 'Bathroom' : `Bathroom ${i}` });
  }
  if (withLinenCloset) children.push({ name: 'Linen Closet' });

  for (const name of EXTRA_ORDER) {
    if (!a.extras.includes(name)) continue;
    const node: StarterNode = { name };
    if (name === 'Kitchen' && withPantry)       node.children = [{ name: 'Pantry' }];
    if (name === 'Garage' && withGarageShelves) node.children = [{ name: 'Garage Shelves' }];
    children.push(node);
  }
  if (withUtilityCloset) children.push({ name: 'Utility Closet' });

  const vehicleChildren: StarterNode[] = [
    { name: 'Documents' },
    { name: 'Emergency Gear' },
    { name: 'Tools' },
    { name: 'Maintenance' },
    { name: 'Storage / Trunk' },
  ];
  for (let i = 1; i <= Math.min(a.vehicles, 3); i++) {
    children.push({ name: `Vehicle ${i}`, children: vehicleChildren.map(c => ({ ...c })) });
  }

  return [{ name: 'Home', children }];
}

export function buildMovingTree(a: MovingAnswers): StarterNode[] {
  const oldChildren: StarterNode[] = [];
  for (let i = 1; i <= Math.min(a.bedrooms, 8); i++) {
    oldChildren.push({ name: a.bedrooms === 1 ? 'Bedroom' : `Bedroom ${i}` });
  }
  oldChildren.push({ name: 'Kitchen' }, { name: 'Bathroom' });
  if (a.includeGarage) oldChildren.push({ name: 'Garage / Storage' });

  return [{
    name: 'Move',
    children: [
      { name: 'Old Place', children: oldChildren },
      { name: 'New Place' },
      { name: 'Keep With Me' },
      { name: 'Donate' },
      { name: 'Sell' },
      { name: 'Trash' },
    ],
  }];
}

export function buildStorageTree(size: StorageSize): StarterNode[] {
  const zones: Record<StorageSize, string[]> = {
    small:  ['Front Area', 'Back Area', 'Shelves', 'Easy Access'],
    medium: ['Front Area', 'Left Side', 'Right Side', 'Back Area', 'Shelves', 'Easy Access'],
    large:  ['Front Area', 'Left Side', 'Right Side', 'Back Area', 'Shelves (Upper)', 'Shelves (Lower)', 'Easy Access'],
  };
  return [{ name: 'Storage Unit', children: zones[size].map(name => ({ name })) }];
}

export function buildCollectionTree(type: string): StarterNode[] {
  return [{
    name: type.trim() || 'Collection',
    children: [
      { name: 'Display' },
      { name: 'Stored' },
      { name: 'To Sell' },
      { name: 'Documents' },
      { name: 'Supplies' },
    ],
  }];
}

export const FIXED_TEMPLATES: Record<string, StarterNode[]> = {
  estate: [{
    name: 'Family / Estate',
    children: [
      { name: 'Documents' },
      { name: 'Photos / Memories' },
      { name: 'Furniture' },
      { name: 'Kitchen' },
      { name: 'Bedroom', children: [{ name: 'Closet' }] },
      { name: 'Garage / Storage' },
      { name: 'Donate / Sell / Give Away' },
    ],
  }],
  business: [{
    name: 'Business / Supplies',
    children: [
      { name: 'Inventory' },
      { name: 'Tools' },
      { name: 'Shipping / Packing' },
      { name: 'Documents' },
      { name: 'Supplies' },
      { name: 'Storage' },
    ],
  }],
  office: [{
    name: 'Office',
    children: [
      { name: 'Desk' },
      { name: 'Files' },
      { name: 'Supplies' },
      { name: 'Equipment' },
      { name: 'Storage' },
      { name: 'Shared Area' },
    ],
  }],
  vehicle: [{
    name: 'Vehicle / RV / Boat',
    children: [
      { name: 'Cabin / Interior' },
      { name: 'Storage Compartments' },
      { name: 'Tools' },
      { name: 'Documents' },
      { name: 'Maintenance' },
      { name: 'Emergency Gear' },
    ],
  }],
};
