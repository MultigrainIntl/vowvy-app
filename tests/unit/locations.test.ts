import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Location } from '../../src/locations';

const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  addDoc: vi.fn(async () => ({ id: 'created-location' })),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
}));

vi.mock('../../src/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: firestoreMocks.collection,
  addDoc: firestoreMocks.addDoc,
  serverTimestamp: firestoreMocks.serverTimestamp,
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  Timestamp: class Timestamp {},
}));

let locations: typeof import('../../src/locations');

beforeAll(async () => {
  locations = await import('../../src/locations');
});

function loc(id: string, name: string, parentId: string | null): Location {
  return {
    id,
    name,
    parentId,
    createdAt: null,
    visibility: 'inherit',
    effectiveIsPrivate: false,
  };
}

describe('owner-created shared location compatibility', () => {
  it('includes the deletion metadata required by collaborator queries', async () => {
    expect(await locations.createLocation('owner-1', ' Garage ')).toBe(
      'created-location',
    );

    expect(firestoreMocks.collection).toHaveBeenCalledWith(
      {},
      'users/owner-1/locations',
    );
    expect(firestoreMocks.addDoc).toHaveBeenLastCalledWith(
      { path: 'users/owner-1/locations' },
      {
        name: 'Garage',
        parentId: null,
        createdAt: 'server-timestamp',
        visibility: 'inherit',
        effectiveIsPrivate: false,
        deletedAt: null,
      },
    );
  });

  it('keeps a private parent private while adding compatible deletion metadata', async () => {
    await locations.createLocation('owner-1', ' Private shelf ', 'private-parent', true);

    expect(firestoreMocks.addDoc).toHaveBeenLastCalledWith(
      { path: 'users/owner-1/locations' },
      expect.objectContaining({
        name: 'Private shelf',
        parentId: 'private-parent',
        effectiveIsPrivate: true,
        deletedAt: null,
      }),
    );
  });
});

describe('location hierarchy regression protection', () => {
  const tree = [
    loc('home', 'Home', null),
    loc('garage', 'Garage', 'home'),
    loc('shelf', 'Shelf B', 'garage'),
    loc('office', 'Office', null),
  ];

  it('builds a complete display path', () => {
    expect(locations.getLocationPath('shelf', tree)).toBe('Home › Garage › Shelf B');
  });

  it('returns only direct children', () => {
    expect(locations.getLocationChildren('home', tree).map(item => item.id)).toEqual(['garage']);
  });

  it('finds every descendant without including the parent', () => {
    expect([...locations.getDescendantIds('home', tree)]).toEqual(['garage', 'shelf']);
  });
});

describe('location health regression protection', () => {
  it('detects duplicate siblings case-insensitively and orphaned locations', () => {
    const issues = locations.getLocationHealthIssues([
      loc('home', 'Home', null),
      loc('a', 'Garage', 'home'),
      loc('b', ' garage ', 'home'),
      loc('lost', 'Lost room', 'missing'),
    ]);

    expect(issues.map(issue => issue.type)).toEqual(['duplicate-siblings', 'orphaned']);
    expect(issues[0].locationIds).toEqual(['a', 'b']);
    expect(issues[1].locationIds).toEqual(['lost']);
  });

  it('warns only after the top-level threshold is exceeded', () => {
    const topLevel = Array.from({ length: locations.MANY_TOP_LEVEL_THRESHOLD + 1 }, (_, index) =>
      loc(String(index), `Location ${index}`, null),
    );
    expect(locations.getLocationHealthIssues(topLevel).map(issue => issue.type)).toContain('many-top-level');
  });
});

describe('onboarding template regression protection', () => {
  it('nests vehicles beneath Home', () => {
    const [home] = locations.buildHomeTree({
      bedrooms: 1,
      bathrooms: 1,
      extras: ['Kitchen'],
      storage: ['Pantry'],
      vehicles: 1,
    });

    expect(home.name).toBe('Home');
    expect(home.children?.find(node => node.name === 'Vehicle 1')?.children?.map(node => node.name))
      .toEqual(['Documents', 'Emergency Gear', 'Tools', 'Maintenance', 'Storage / Trunk']);
    expect(home.children?.find(node => node.name === 'Kitchen')?.children).toEqual([{ name: 'Pantry' }]);
  });

  it('caps generated rooms and vehicles at supported limits', () => {
    const [home] = locations.buildHomeTree({
      bedrooms: 99,
      bathrooms: 99,
      extras: [],
      storage: [],
      vehicles: 99,
    });
    expect(home.children?.filter(node => node.name.startsWith('Bedroom'))).toHaveLength(8);
    expect(home.children?.filter(node => node.name.startsWith('Bathroom'))).toHaveLength(6);
    expect(home.children?.filter(node => node.name.startsWith('Vehicle'))).toHaveLength(3);
  });
});
