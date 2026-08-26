export type CanonicalVisibility = 'inherit' | 'private' | 'shared';

export interface LegacyLocationPrivacyRecord {
  id: string;
  parentId?: string | null;
  visibility?: unknown;
  effectiveIsPrivate?: unknown;
  isPrivate?: unknown;
}

export interface LegacyContainerPrivacyRecord {
  id: string;
  locationId?: string | null;
  visibility?: unknown;
  effectiveIsPrivate?: unknown;
  isPrivate?: unknown;
}

export type PrivacyNormalizationReason =
  | 'canonical'
  | 'explicit-private'
  | 'explicit-shared'
  | 'inherited-private'
  | 'inherited-shared'
  | 'conflicting-fields'
  | 'invalid-field'
  | 'missing-parent'
  | 'missing-location'
  | 'location-cycle'
  | 'insufficient-evidence';

export interface PrivacyNormalizationDecision {
  id: string;
  recordType: 'location' | 'container';
  disposition: 'unchanged' | 'normalize' | 'manual-review';
  effectiveIsPrivate: boolean;
  visibility: CanonicalVisibility | null;
  reason: PrivacyNormalizationReason;
}

export interface PrivacyNormalizationPlan {
  locations: PrivacyNormalizationDecision[];
  containers: PrivacyNormalizationDecision[];
  summary: {
    unchanged: number;
    normalize: number;
    manualReview: number;
  };
}

interface ResolvedPrivacy {
  disposition: PrivacyNormalizationDecision['disposition'];
  effectiveIsPrivate: boolean;
  visibility: CanonicalVisibility | null;
  reason: PrivacyNormalizationReason;
}

const VISIBILITIES = new Set<CanonicalVisibility>([
  'inherit',
  'private',
  'shared',
]);

function readVisibility(value: unknown): CanonicalVisibility | null {
  return typeof value === 'string' &&
    VISIBILITIES.has(value as CanonicalVisibility)
    ? (value as CanonicalVisibility)
    : null;
}

function hasInvalidPrivacyField(
  record: LegacyLocationPrivacyRecord | LegacyContainerPrivacyRecord,
): boolean {
  return (
    (record.visibility !== undefined && readVisibility(record.visibility) === null) ||
    (record.effectiveIsPrivate !== undefined &&
      typeof record.effectiveIsPrivate !== 'boolean') ||
    (record.isPrivate !== undefined && typeof record.isPrivate !== 'boolean')
  );
}

function failClosed(reason: PrivacyNormalizationReason): ResolvedPrivacy {
  return {
    disposition: 'manual-review',
    effectiveIsPrivate: true,
    visibility: null,
    reason,
  };
}

function resolveExplicitPrivacy(
  record: LegacyLocationPrivacyRecord | LegacyContainerPrivacyRecord,
): ResolvedPrivacy | null {
  if (hasInvalidPrivacyField(record)) return failClosed('invalid-field');

  const visibility = readVisibility(record.visibility);
  const effective = record.effectiveIsPrivate;
  const legacy = record.isPrivate;

  const explicitlyPrivate =
    visibility === 'private' || effective === true || legacy === true;
  const explicitlyShared = visibility === 'shared' || effective === false;
  const legacyConflict =
    (effective === true && legacy === false) ||
    (effective === false && legacy === true);

  if ((explicitlyPrivate && explicitlyShared) || legacyConflict) {
    return failClosed('conflicting-fields');
  }

  if (effective === true && (visibility === undefined || visibility === 'private')) {
    return {
      disposition: visibility === 'private' ? 'unchanged' : 'normalize',
      effectiveIsPrivate: true,
      visibility: 'private',
      reason: visibility === 'private' ? 'canonical' : 'explicit-private',
    };
  }

  if (
    effective === false &&
    (visibility === 'shared' || visibility === 'inherit')
  ) {
    return {
      disposition: 'unchanged',
      effectiveIsPrivate: false,
      visibility,
      reason: 'canonical',
    };
  }

  if (visibility === 'private' || legacy === true) {
    return {
      disposition: 'normalize',
      effectiveIsPrivate: true,
      visibility: 'private',
      reason: 'explicit-private',
    };
  }

  if (visibility === 'shared') {
    return {
      disposition: 'normalize',
      effectiveIsPrivate: false,
      visibility: 'shared',
      reason: 'explicit-shared',
    };
  }

  return null;
}

export function buildPrivacyNormalizationPlan(
  locations: readonly LegacyLocationPrivacyRecord[],
  containers: readonly LegacyContainerPrivacyRecord[],
): PrivacyNormalizationPlan {
  const locationById = new Map(locations.map(location => [location.id, location]));
  const resolvedLocations = new Map<string, ResolvedPrivacy>();
  const resolving = new Set<string>();

  const resolveLocation = (id: string): ResolvedPrivacy => {
    const cached = resolvedLocations.get(id);
    if (cached) return cached;

    const location = locationById.get(id);
    if (!location) return failClosed('missing-parent');
    if (resolving.has(id)) return failClosed('location-cycle');

    resolving.add(id);
    let decision = resolveExplicitPrivacy(location);

    if (!decision) {
      const visibility = readVisibility(location.visibility);
      if (visibility !== 'inherit') {
        decision = failClosed('insufficient-evidence');
      } else if (!location.parentId) {
        decision = failClosed('insufficient-evidence');
      } else if (!locationById.has(location.parentId)) {
        decision = failClosed('missing-parent');
      } else {
        const parent = resolveLocation(location.parentId);
        if (parent.disposition === 'manual-review') {
          decision = failClosed(parent.reason);
        } else {
          decision = {
            disposition: 'normalize',
            effectiveIsPrivate: parent.effectiveIsPrivate,
            visibility: 'inherit',
            reason: parent.effectiveIsPrivate
              ? 'inherited-private'
              : 'inherited-shared',
          };
        }
      }
    }

    resolving.delete(id);
    resolvedLocations.set(id, decision);
    return decision;
  };

  const locationDecisions = locations.map(location => ({
    id: location.id,
    recordType: 'location' as const,
    ...resolveLocation(location.id),
  }));

  const containerDecisions = containers.map(container => {
    let decision = resolveExplicitPrivacy(container);
    if (!decision) {
      const visibility = readVisibility(container.visibility);
      if (visibility !== 'inherit') {
        decision = failClosed('insufficient-evidence');
      } else if (!container.locationId) {
        decision = failClosed('missing-location');
      } else {
        const parent = resolvedLocations.get(container.locationId) ??
          (locationById.has(container.locationId)
            ? resolveLocation(container.locationId)
            : failClosed('missing-location'));
        decision =
          parent.disposition === 'manual-review'
            ? failClosed(parent.reason)
            : {
                disposition: 'normalize',
                effectiveIsPrivate: parent.effectiveIsPrivate,
                visibility: 'inherit',
                reason: parent.effectiveIsPrivate
                  ? 'inherited-private'
                  : 'inherited-shared',
              };
      }
    }

    return {
      id: container.id,
      recordType: 'container' as const,
      ...decision,
    };
  });

  const all = [...locationDecisions, ...containerDecisions];
  return {
    locations: locationDecisions,
    containers: containerDecisions,
    summary: {
      unchanged: all.filter(item => item.disposition === 'unchanged').length,
      normalize: all.filter(item => item.disposition === 'normalize').length,
      manualReview: all.filter(item => item.disposition === 'manual-review').length,
    },
  };
}
