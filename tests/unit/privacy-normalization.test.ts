import { describe, expect, it } from 'vitest';
import { buildPrivacyNormalizationPlan } from '../../src/collaboration/privacy-normalization';

describe('canonical privacy normalization planner', () => {
  it('leaves complete canonical records unchanged', () => {
    const plan = buildPrivacyNormalizationPlan(
      [
        {
          id: 'shared-root',
          parentId: null,
          visibility: 'shared',
          effectiveIsPrivate: false,
        },
        {
          id: 'private-root',
          parentId: null,
          visibility: 'private',
          effectiveIsPrivate: true,
        },
      ],
      [],
    );

    expect(plan.summary).toEqual({
      unchanged: 2,
      normalize: 0,
      manualReview: 0,
    });
  });

  it('treats every explicit private signal as private', () => {
    const plan = buildPrivacyNormalizationPlan(
      [{ id: 'location', visibility: 'private' }],
      [{ id: 'container', isPrivate: true }],
    );

    expect(plan.locations[0]).toMatchObject({
      disposition: 'normalize',
      effectiveIsPrivate: true,
      reason: 'explicit-private',
    });
    expect(plan.containers[0]).toMatchObject({
      disposition: 'normalize',
      effectiveIsPrivate: true,
      reason: 'explicit-private',
    });
  });

  it('fails closed when old and new privacy fields conflict', () => {
    const plan = buildPrivacyNormalizationPlan(
      [],
      [
        {
          id: 'conflict',
          visibility: 'inherit',
          effectiveIsPrivate: true,
          isPrivate: false,
        },
      ],
    );

    expect(plan.containers[0]).toMatchObject({
      disposition: 'manual-review',
      effectiveIsPrivate: true,
      reason: 'conflicting-fields',
    });
  });

  it('derives inherited privacy through the complete location hierarchy', () => {
    const plan = buildPrivacyNormalizationPlan(
      [
        {
          id: 'root',
          visibility: 'private',
          effectiveIsPrivate: true,
        },
        { id: 'room', parentId: 'root', visibility: 'inherit' },
        { id: 'shelf', parentId: 'room', visibility: 'inherit' },
      ],
      [{ id: 'box', locationId: 'shelf', visibility: 'inherit' }],
    );

    expect(plan.locations[1]).toMatchObject({
      effectiveIsPrivate: true,
      reason: 'inherited-private',
    });
    expect(plan.locations[2]).toMatchObject({
      effectiveIsPrivate: true,
      reason: 'inherited-private',
    });
    expect(plan.containers[0]).toMatchObject({
      effectiveIsPrivate: true,
      reason: 'inherited-private',
    });
  });

  it('normalizes inherited shared records only from a proven shared ancestor', () => {
    const plan = buildPrivacyNormalizationPlan(
      [
        {
          id: 'root',
          visibility: 'shared',
          effectiveIsPrivate: false,
        },
        { id: 'room', parentId: 'root', visibility: 'inherit' },
      ],
      [{ id: 'box', locationId: 'room', visibility: 'inherit' }],
    );

    expect(plan.locations[1]).toMatchObject({
      disposition: 'normalize',
      effectiveIsPrivate: false,
      reason: 'inherited-shared',
    });
    expect(plan.containers[0]).toMatchObject({
      disposition: 'normalize',
      effectiveIsPrivate: false,
      reason: 'inherited-shared',
    });
  });

  it('does not treat legacy isPrivate false alone as proof of sharing', () => {
    const plan = buildPrivacyNormalizationPlan(
      [],
      [{ id: 'legacy-box', isPrivate: false }],
    );

    expect(plan.containers[0]).toMatchObject({
      disposition: 'manual-review',
      effectiveIsPrivate: true,
      reason: 'insufficient-evidence',
    });
  });

  it('fails closed for missing parents and missing container locations', () => {
    const plan = buildPrivacyNormalizationPlan(
      [{ id: 'orphan', parentId: 'missing', visibility: 'inherit' }],
      [{ id: 'unassigned', visibility: 'inherit' }],
    );

    expect(plan.locations[0]).toMatchObject({
      disposition: 'manual-review',
      reason: 'missing-parent',
    });
    expect(plan.containers[0]).toMatchObject({
      disposition: 'manual-review',
      reason: 'missing-location',
    });
  });

  it('fails closed for hierarchy cycles', () => {
    const plan = buildPrivacyNormalizationPlan(
      [
        { id: 'a', parentId: 'b', visibility: 'inherit' },
        { id: 'b', parentId: 'a', visibility: 'inherit' },
      ],
      [],
    );

    expect(plan.locations.every(item => item.disposition === 'manual-review')).toBe(
      true,
    );
    expect(plan.locations.every(item => item.effectiveIsPrivate)).toBe(true);
    expect(plan.locations.some(item => item.reason === 'location-cycle')).toBe(
      true,
    );
  });

  it('fails closed for malformed privacy fields', () => {
    const plan = buildPrivacyNormalizationPlan(
      [{ id: 'bad', visibility: 'public' }],
      [{ id: 'worse', effectiveIsPrivate: 'false' }],
    );

    expect(plan.summary.manualReview).toBe(2);
    expect(plan.locations[0].reason).toBe('invalid-field');
    expect(plan.containers[0].reason).toBe('invalid-field');
  });

  it('returns a read-only plan without mutating source records', () => {
    const locations = [
      {
        id: 'root',
        visibility: 'shared',
        effectiveIsPrivate: false,
      },
    ];
    const containers = [
      { id: 'box', locationId: 'root', visibility: 'inherit' },
    ];
    const before = structuredClone({ locations, containers });

    const plan = buildPrivacyNormalizationPlan(locations, containers);

    expect({ locations, containers }).toEqual(before);
    expect(plan.summary).toEqual({
      unchanged: 1,
      normalize: 1,
      manualReview: 0,
    });
  });
});
