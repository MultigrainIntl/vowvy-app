import { useState } from 'react';
import { createPortal } from 'react-dom';
import { type User } from 'firebase/auth';
import {
  collection, doc, onSnapshot, updateDoc, setDoc,
  query, orderBy, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { navigate } from './nav';
import QRCode from 'qrcode';
import {
  subscribeToLocations, createLocation,
  getLocationChildren, getLocationPath, getDescendantIds,
  getLocationHealthIssues, type Location, type Visibility,
} from './locations';
import logoMark from './assets/logo-mark.svg';
import './ManageScreen.css';

interface Container {
  id: string;
  name: string;
  locationId: string | null;
  location: string;
  deletedAt: number | null;
  visibility: Visibility;
  effectiveIsPrivate: boolean;
}

interface Props { user: User; onStartGuidedAdd?: () => void; }

function LockedIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

function UnlockedIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0 1 9.9-1.7"/>
    </svg>
  );
}

function clearQrPrintState() {
  document.body.classList.remove('vowvy-printing-qr');
  document.body.classList.remove('vowvy-printing-qr-main');
  document.body.classList.remove('vowvy-printing-qr-manage');
  document.body.classList.remove('vowvy-qr-print-active');

  const existingPrintRoot = document.getElementById('vowvy-qr-print-root');
  existingPrintRoot?.remove();

  window.removeEventListener('afterprint', clearQrPrintState);
}

function requestQrPrint(scopeClass: 'vowvy-printing-qr-main' | 'vowvy-printing-qr-manage') {
  const card = document.querySelector('.qr-print-overlay .qr-print-card');

  if (!card) {
    window.print();
    return;
  }

  const existingPrintRoot = document.getElementById('vowvy-qr-print-root');
  existingPrintRoot?.remove();

  const printRoot = document.createElement('div');
  printRoot.id = 'vowvy-qr-print-root';
  printRoot.appendChild(card.cloneNode(true));
  document.body.appendChild(printRoot);

  document.body.classList.add('vowvy-printing-qr');
  document.body.classList.add(scopeClass);
  document.body.classList.add('vowvy-qr-print-active');

  window.removeEventListener('afterprint', clearQrPrintState);
  window.addEventListener('afterprint', clearQrPrintState);

  window.print();
}

function ManageQRModal({ container, onClose }: { container: Container; onClose: () => void }) {
  const { t } = useTranslation();
  const [tagline, setTagline] = useState(() => t('main.qr.defaultTagline'));
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    const url = `https://app.vowvy.com/container/${container.id}`;
    QRCode.toDataURL(url, { width: 240, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [container.id]);

  const closeQr = () => {
    clearQrPrintState();
    onClose();
  };

  return createPortal((
    <div className="qr-print-overlay">
      <div className="qr-print-controls">
        <button className="qr-btn-print" disabled={!qrDataUrl} onClick={() => requestQrPrint('vowvy-printing-qr-manage')}>
          {t('main.qr.print')}
        </button>
        <button className="qr-btn-close" onClick={closeQr}>{t('main.qr.close')}</button>
      </div>

      <div className="qr-print-card">
        <img src={logoMark} alt="Vowvy" className="qr-logo" />
        <div className="qr-code">
          {qrDataUrl && <img src={qrDataUrl} alt={`QR code for ${container.name}`} className="qr-code-img" />}
        </div>
        <div className="qr-container-name">{container.name}</div>
        <div className="qr-location">{container.location}</div>
        <input
          className="qr-tagline-input"
          value={tagline}
          onChange={e => setTagline(e.target.value)}
        />
      </div>
    </div>
  ), document.body);
}


export default function ManageScreen({ user, onStartGuidedAdd }: Props) {
  const { t } = useTranslation();
  const [locations, setLocations]     = useState<Location[]>([]);
  const [containers, setContainers]   = useState<Container[]>([]);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [newSubName, setNewSubName]   = useState('');
  const [addingContainerUnder, setAddingContainerUnder] = useState<string | null>(null);
  const [newContainerName, setNewContainerName]         = useState('');
  const [addingTopLevel, setAddingTopLevel]             = useState(false);
  const [movingContId, setMovingContId]   = useState<string | null>(null);
  const [printQrContainer, setPrintQrContainer] = useState<Container | null>(null);
  const [newTopLevelName, setNewTopLevelName]           = useState('');
  const [movingId, setMovingId]                         = useState<string | null>(null);
  const [healthOpen, setHealthOpen]                     = useState(false);
  const [menuOpenId, setMenuOpenId]                     = useState<string | null>(null);

  useEffect(() => subscribeToLocations(user.uid, setLocations), [user.uid]);

  useEffect(() => {
    const q = query(
      collection(db, `users/${user.uid}/containers`),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, snap => {
      setContainers(snap.docs
        .filter(d => !d.data().deletedAt)
        .map(d => ({
          id: d.id,
          name: d.data().name ?? '',
          locationId: d.data().locationId ?? null,
          location: d.data().location ?? '',
          deletedAt: d.data().deletedAt ?? null,
          visibility: (d.data().visibility ?? 'inherit') as Visibility,
          effectiveIsPrivate: d.data().effectiveIsPrivate ?? false,
        }))
      );
    });
  }, [user.uid]);

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function renameLocation(id: string, name: string) {
    await updateDoc(doc(db, `users/${user.uid}/locations/${id}`), { name: name.trim() });
    setEditingId(null);
  }

  async function deleteLocation(id: string) {
    const childLocations = getLocationChildren(id, locations);
    if (childLocations.length > 0) {
      const loc = locations.find(l => l.id === id);
      const name = loc?.name.trim() || 'this location';
      window.alert(t('manage.deleteLocationAlert', { name }));
      return;
    }
    if (!window.confirm(t('manage.deleteLocationConfirm'))) return;
    const affected = containers.filter(c => c.locationId === id);
    const batch = writeBatch(db);
    affected.forEach(c => {
      batch.update(doc(db, `users/${user.uid}/containers/${c.id}`), { locationId: null, location: '' });
    });
    batch.delete(doc(db, `users/${user.uid}/locations/${id}`));
    await batch.commit();
  }

  async function renameContainer(id: string, name: string) {
    await updateDoc(doc(db, `users/${user.uid}/containers/${id}`), { name: name.trim() });
    setEditingId(null);
  }

  async function moveLocation(id: string, newParentId: string | null) {
    const loc = locations.find(l => l.id === id);
    if (!loc) { setMovingId(null); return; }
    if ((loc.parentId ?? null) === (newParentId ?? null)) { setMovingId(null); return; }
    if (newParentId === id || getDescendantIds(id, locations).has(newParentId ?? '')) {
      setMovingId(null);
      return;
    }
    await updateDoc(doc(db, `users/${user.uid}/locations/${id}`), { parentId: newParentId });
    setMovingId(null);
    if (loc.visibility === 'inherit') {
      const newParent = newParentId ? locations.find(l => l.id === newParentId) : null;
      const newParentEffective = newParent?.effectiveIsPrivate ?? false;
      if (newParentEffective !== loc.effectiveIsPrivate) {
        await propagateEffective(id, 'inherit', newParentEffective);
      }
    }
  }

  async function repairOrphanToTopLevel(id: string) {
    await updateDoc(doc(db, `users/${user.uid}/locations/${id}`), { parentId: null });
    const loc = locations.find(l => l.id === id);
    if (loc?.visibility === 'inherit' && loc.effectiveIsPrivate) {
      await propagateEffective(id, 'inherit', false);
    }
  }

  async function propagateEffective(rootId: string, rootVis: Visibility, rootEffective: boolean) {
    const locUpdates = new Map<string, { visibility: Visibility; effectiveIsPrivate: boolean }>();
    const effectiveMap = new Map<string, boolean>();

    locUpdates.set(rootId, { visibility: rootVis, effectiveIsPrivate: rootEffective });
    effectiveMap.set(rootId, rootEffective);

    const queue: string[] = getLocationChildren(rootId, locations).map(c => c.id);
    while (queue.length > 0) {
      const childId = queue.shift()!;
      const child = locations.find(l => l.id === childId);
      if (!child) continue;
      const parentEffective = child.parentId
        ? (effectiveMap.get(child.parentId) ?? (locations.find(l => l.id === child.parentId)?.effectiveIsPrivate ?? false))
        : false;
      const childEffective = child.visibility === 'private' ? true
        : child.visibility === 'shared' ? false
        : parentEffective;
      locUpdates.set(childId, { visibility: child.visibility, effectiveIsPrivate: childEffective });
      effectiveMap.set(childId, childEffective);
      queue.push(...getLocationChildren(childId, locations).map(c => c.id));
    }

    const allWrites: [string, Record<string, unknown>][] = [];
    for (const [id, upd] of locUpdates) {
      allWrites.push([`users/${user.uid}/locations/${id}`, { visibility: upd.visibility, effectiveIsPrivate: upd.effectiveIsPrivate }]);
    }
    for (const c of containers) {
      if (!c.locationId || !locUpdates.has(c.locationId)) continue;
      const locEffective = locUpdates.get(c.locationId)!.effectiveIsPrivate;
      const conEffective = c.visibility === 'private' ? true : c.visibility === 'shared' ? false : locEffective;
      allWrites.push([`users/${user.uid}/containers/${c.id}`, { effectiveIsPrivate: conEffective }]);
    }

    const BATCH_SIZE = 400;
    for (let i = 0; i < allWrites.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      for (const [path, data] of allWrites.slice(i, i + BATCH_SIZE)) {
        batch.update(doc(db, path), data);
      }
      await batch.commit();
    }
  }

  async function applyLocationVisibility(locId: string, newVisibility: Visibility) {
    function resolveEffective(id: string, vis: Visibility, resolvedMap: Map<string, boolean>): boolean {
      if (vis === 'private') return true;
      if (vis === 'shared') return false;
      const loc = locations.find(l => l.id === id);
      if (!loc || !loc.parentId) return false;
      if (resolvedMap.has(loc.parentId)) return resolvedMap.get(loc.parentId)!;
      const parent = locations.find(l => l.id === loc.parentId);
      return parent?.effectiveIsPrivate ?? false;
    }
    const targetEffective = resolveEffective(locId, newVisibility, new Map());
    await propagateEffective(locId, newVisibility, targetEffective);
  }

  async function moveContainerToLoc(contId: string, locId: string) {
    const newPath = getLocationPath(locId, locations);
    await updateDoc(doc(db, `users/${user.uid}/containers/${contId}`), { locationId: locId, location: newPath });
    setMovingContId(null);
  }

  async function deleteContainer(c: Container) {
    if (!window.confirm(`Remove "${c.name}"?`)) return;
    await updateDoc(doc(db, `users/${user.uid}/containers/${c.id}`), { deletedAt: serverTimestamp() });
  }

  function renderLocation(loc: Location, depth = 0) {
    const children = getLocationChildren(loc.id, locations);
    const containersHere = containers.filter(c => c.locationId === loc.id);
    const isExpanded = expandedIds.has(loc.id);
    const isEditing = editingId === loc.id;

    const lockAriaLabel = loc.visibility === 'inherit'
      ? (loc.effectiveIsPrivate ? t('manage.followParentHiddenLabel') : t('manage.followParentVisibleLabel'))
      : loc.visibility === 'private' ? t('manage.hiddenFromHelpers') : t('manage.alwaysVisible');

    return (
      <div key={loc.id} style={{ marginLeft: depth * 20 }}>
        <div className="manage-row location-row">
          <button className="expand-btn" onClick={() => toggleExpand(loc.id)}>
            {isExpanded ? '▾' : '▸'}
          </button>
          {isEditing ? (
            <input
              autoFocus
              className="manage-input"
              value={editingName}
              onChange={e => setEditingName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') renameLocation(loc.id, editingName);
                if (e.key === 'Escape') setEditingId(null);
              }}
            />
          ) : (
            <span className="manage-name">{loc.name}</span>
          )}
          {loc.visibility !== 'inherit' && (
            <span className={`loc-vis-pill${loc.visibility === 'private' ? ' pill-private' : ' pill-shared'}`}>
              {loc.visibility === 'private' ? t('manage.private') : t('manage.shared')}
            </span>
          )}
          <div className="manage-actions">
            {isEditing ? (
              <button className="manage-btn save" onClick={() => renameLocation(loc.id, editingName)}>{t('shared.save')}</button>
            ) : (
              <button className="manage-btn edit" onClick={() => { setEditingId(loc.id); setEditingName(loc.name); }}>{t('manage.rename')}</button>
            )}
            <button className="manage-btn edit" onClick={() => {
              setMovingId(movingId === loc.id ? null : loc.id);
            }}>{t('main.move.containerTitle').split(' ')[0]}</button>
            <button className="manage-btn delete" onClick={() => deleteLocation(loc.id)}>{t('manage.delete')}</button>
            <button
              className={`loc-lock-btn${loc.effectiveIsPrivate ? ' is-private' : ''}${loc.visibility === 'inherit' ? ' is-inherit' : ''}`}
              aria-label={lockAriaLabel}
              title={lockAriaLabel}
              onClick={async () => {
                const newVis: Visibility =
                  loc.visibility === 'private' ? 'inherit'
                  : loc.effectiveIsPrivate     ? 'shared'
                  :                              'private';
                const ok = window.confirm(t('manage.privacyUpdateConfirm'));
                if (!ok) return;
                await applyLocationVisibility(loc.id, newVis);
              }}
            >
              {loc.effectiveIsPrivate ? <LockedIcon /> : <UnlockedIcon />}
            </button>
            <div style={{ position: 'relative' }}>
              <button
                className="loc-menu-btn"
                aria-label={t('manage.privacyOptions')}
                title={t('manage.privacyOptions')}
                onClick={e => {
                  e.stopPropagation();
                  setMenuOpenId(menuOpenId === loc.id ? null : loc.id);
                }}
              >⋯</button>
              {menuOpenId === loc.id && (
                <div className="loc-menu-dropdown" role="menu">
                  {(['inherit', 'private', 'shared'] as Visibility[]).map(v => (
                    <button
                      key={v}
                      className={`loc-menu-item${loc.visibility === v ? ' active' : ''}`}
                      role="menuitem"
                      onClick={async () => {
                        setMenuOpenId(null);
                        await applyLocationVisibility(loc.id, v);
                      }}
                    >
                      <span className="loc-menu-check">{loc.visibility === v ? '✓' : ''}</span>
                      {v === 'inherit' ? t('manage.followParent') : v === 'private' ? t('manage.hideFromHelpers') : t('manage.showToHelpers')}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="manage-btn add" onClick={() => {
              setAddingUnder(loc.id);
              setNewSubName('');
              setExpandedIds(prev => new Set([...prev, loc.id]));
            }}>{t('manage.addSubLocation')}</button>
            <button className="manage-btn add" onClick={() => {
              setAddingContainerUnder(loc.id);
              setNewContainerName('');
              setExpandedIds(prev => new Set([...prev, loc.id]));
            }}>{t('manage.addContainer')}</button>
          </div>
        </div>

        {movingId === loc.id && (() => {
          const blocked = getDescendantIds(loc.id, locations);
          const eligible = locations.filter(l => l.id !== loc.id && !blocked.has(l.id));
          return (
            <div className="manage-add-row" style={{ marginLeft: 20 }}>
              <select
                autoFocus
                className="manage-input"
                defaultValue={loc.parentId ?? ''}
                onChange={e => moveLocation(loc.id, e.target.value === '' ? null : e.target.value)}
              >
                <option value="">{t('manage.topLevel')}</option>
                {eligible.map(l => (
                  <option key={l.id} value={l.id}>{getLocationPath(l.id, locations)}</option>
                ))}
              </select>
              <button className="manage-btn" onClick={() => setMovingId(null)}>{t('manage.cancel')}</button>
            </div>
          );
        })()}

        {isExpanded && (
          <div className="manage-children">
            {addingUnder === loc.id && (
              <div className="manage-add-row" style={{ marginLeft: 20 }}>
                <input
                  autoFocus
                  className="manage-input"
                  placeholder={t('manage.subLocationPlaceholder')}
                  value={newSubName}
                  onChange={e => setNewSubName(e.target.value)}
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && newSubName.trim()) {
                      await createLocation(user.uid, newSubName.trim(), loc.id, loc.effectiveIsPrivate);
                      setAddingUnder(null);
                      setNewSubName('');
                    }
                    if (e.key === 'Escape') setAddingUnder(null);
                  }}
                />
                <button className="manage-btn save" onClick={async () => {
                  if (newSubName.trim()) {
                    await createLocation(user.uid, newSubName.trim(), loc.id, loc.effectiveIsPrivate);
                    setAddingUnder(null);
                    setNewSubName('');
                  }
                }}>{t('main.capture.add')}</button>
              </div>
            )}
            {addingContainerUnder === loc.id && (
              <div className="manage-add-row" style={{ marginLeft: 20 }}>
                <input
                  autoFocus
                  className="manage-input"
                  placeholder={t('manage.containerNamePlaceholder')}
                  value={newContainerName}
                  onChange={e => setNewContainerName(e.target.value)}
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && newContainerName.trim()) {
                      const containerRef = doc(collection(db, `users/${user.uid}/containers`));
                      await setDoc(containerRef, {
                        name: newContainerName.trim(),
                        locationId: loc.id,
                        location: getLocationPath(loc.id, locations),
                        photos: [],
                        photoUrls: [],
                        photoStoragePaths: [],
                        createdAt: serverTimestamp(),
                        deletedAt: null,
                        isPrivate: loc.effectiveIsPrivate,
                        visibility: 'inherit',
                        effectiveIsPrivate: loc.effectiveIsPrivate,
                      });
                      setAddingContainerUnder(null);
                      setNewContainerName('');
                    }
                    if (e.key === 'Escape') setAddingContainerUnder(null);
                  }}
                />
                <button className="manage-btn save" onClick={async () => {
                  if (!newContainerName.trim()) return;
                  const containerRef = doc(collection(db, `users/${user.uid}/containers`));
                  await setDoc(containerRef, {
                    name: newContainerName.trim(),
                    locationId: loc.id,
                    location: getLocationPath(loc.id, locations),
                    photos: [],
                    photoUrls: [],
                    photoStoragePaths: [],
                    createdAt: serverTimestamp(),
                    deletedAt: null,
                    isPrivate: false,
                  });
                  setAddingContainerUnder(null);
                  setNewContainerName('');
                }}>{t('main.capture.add')}</button>
              </div>
            )}
            {children.map(child => renderLocation(child, depth + 1))}
            {[...containersHere].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})).map(c=>renderContainer(c))}
          </div>
        )}
      </div>
    );
  }

  function renderContainer(c: Container) {
    const isEditing = editingId === c.id;
    return (
      <div key={c.id} className="manage-row container-row" style={{ marginLeft: 20 }}>
        <span className="container-icon">📦</span>
        {isEditing ? (
          <input
            autoFocus
            className="manage-input"
            value={editingName}
            onChange={e => setEditingName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') renameContainer(c.id, editingName);
              if (e.key === 'Escape') setEditingId(null);
            }}
          />
        ) : (
          <span className="manage-name">{c.name}</span>
        )}
        <div className="manage-actions">
          {isEditing ? (
            <button className="manage-btn save" onClick={() => renameContainer(c.id, editingName)}>{t('shared.save')}</button>
          ) : (
            <>
            {movingContId !== c.id && <button className="manage-btn edit" onClick={() => { setEditingId(c.id); setEditingName(c.name); }}>{t('manage.rename')}</button>}
            <button className="manage-btn" onClick={() => setMovingContId(movingContId === c.id ? null : c.id)}>Move</button>
            {movingContId === c.id && (
              <>
                <select style={{marginTop:'4px',width:'100%'}} defaultValue="" onChange={async e => { if (e.target.value) await moveContainerToLoc(c.id, e.target.value); }}>
                  <option value="" disabled>Pick location…</option>
                  {locations.map(loc => <option key={loc.id} value={loc.id}>{getLocationPath(loc.id, locations)}</option>)}
                </select>
                <button className="manage-btn" onClick={() => setMovingContId(null)}>Cancel</button>
              </>
            )}
            {movingContId !== c.id && <button className="manage-btn" onClick={() => setPrintQrContainer(c)}>Print QR</button>}
            {movingContId !== c.id && <button className="manage-btn" onClick={() => deleteContainer(c)}>Remove</button>}
            </>
          )}
        </div>
      </div>
    );
  }

  const topLevel = getLocationChildren(null, locations);
  const unassigned = containers.filter(c => !c.locationId && !c.location);
  const healthIssues = getLocationHealthIssues(locations);

  return (
    <div className="manage-screen">
      <header className="app-header">
        <div className="header-brand">
          <img src={logoMark} alt="Vowvy" className="header-logo-mark" />
          <span className="app-wordmark">Vowvy</span>
        </div>
        <div className="header-actions">
          {printQrContainer && <ManageQRModal container={printQrContainer} onClose={() => setPrintQrContainer(null)} />}
        <button className="sign-out-btn" onClick={() => navigate('/')}>{t('shared.back')}</button>
        </div>
      </header>

      {printQrContainer && <ManageQRModal container={printQrContainer} onClose={() => setPrintQrContainer(null)} />}

      <div className="manage-content">
        <h2 className="manage-title">{t('manage.title')}</h2>
        {onStartGuidedAdd && (
          <button className="manage-guided-add-btn" onClick={onStartGuidedAdd}>
            {t('manage.addNewSpace')}
          </button>
        )}

        {healthIssues.length > 0 && (
          <div className="health-panel">
            <button
              className="health-header"
              onClick={() => setHealthOpen(v => !v)}
              aria-expanded={healthOpen}
            >
              <span>{t('manage.health.header', { count: healthIssues.length })}</span>
              <span className="health-chevron">{healthOpen ? '▾' : '▸'}</span>
            </button>
            {healthOpen && (
              <ul className="health-list">
                {healthIssues.map((issue, i) => (
                  <li key={i} className={`health-item health-${issue.severity}`}>
                    <span>{issue.message}</span>
                    {issue.type === 'orphaned' && issue.locationIds[0] && (
                      <button
                        className="health-repair-btn"
                        onClick={() => repairOrphanToTopLevel(issue.locationIds[0])}
                      >
                        {t('manage.health.moveToTopLevel')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {topLevel.length === 0 && !addingTopLevel && (
          <div className="manage-empty">
            <p>{t('manage.noLocations')}</p>
            <button className="manage-btn add" onClick={() => setAddingTopLevel(true)}>{t('manage.addFirstLocation')}</button>
          </div>
        )}
        {addingTopLevel && (
          <div className="manage-add-row">
            <input
              autoFocus
              className="manage-input"
              placeholder={t('manage.locationPlaceholder')}
              value={newTopLevelName}
              onChange={e => setNewTopLevelName(e.target.value)}
              onKeyDown={async e => {
                if (e.key === 'Enter' && newTopLevelName.trim()) {
                  await createLocation(user.uid, newTopLevelName.trim(), null);
                  setAddingTopLevel(false);
                  setNewTopLevelName('');
                }
                if (e.key === 'Escape') { setAddingTopLevel(false); setNewTopLevelName(''); }
              }}
            />
            <button className="manage-btn save" onClick={async () => {
              if (!newTopLevelName.trim()) return;
              await createLocation(user.uid, newTopLevelName.trim(), null);
              setAddingTopLevel(false);
              setNewTopLevelName('');
            }}>{t('main.capture.add')}</button>
          </div>
        )}

        {menuOpenId !== null && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 50 }}
            onClick={() => setMenuOpenId(null)}
          />
        )}

        {topLevel.map(loc => renderLocation(loc))}

        {unassigned.length > 0 && (
          <div className="manage-section">
            <h3 className="manage-subtitle">{t('manage.unassigned')}</h3>
            {unassigned.map(c => renderContainer(c))}
          </div>
        )}
      </div>
    </div>
  );
}
