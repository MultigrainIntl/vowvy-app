import { useState } from 'react';
import { type User } from 'firebase/auth';
import {
  collection, doc, onSnapshot, updateDoc, setDoc,
  query, orderBy, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { useEffect } from 'react';
import { navigate } from './nav';
import {
  subscribeToLocations, createLocation,
  getLocationChildren, getLocationPath, getDescendantIds,
  getLocationHealthIssues, type Location,
} from './locations';
import logoMark from './assets/logo-mark.svg';
import './ManageScreen.css';

interface Container {
  id: string;
  name: string;
  locationId: string | null;
  location: string;
  deletedAt: number | null;
}

interface Props { user: User; }

export default function ManageScreen({ user }: Props) {
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
  const [newTopLevelName, setNewTopLevelName]           = useState('');
  const [movingId, setMovingId]                         = useState<string | null>(null);
  const [healthOpen, setHealthOpen]                     = useState(false);

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
    if (!window.confirm('Delete this location? Containers inside it will become unassigned.')) return;
    // Unassign containers in this location
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
    // No-op: selecting the current parent just closes the picker.
    if ((loc.parentId ?? null) === (newParentId ?? null)) { setMovingId(null); return; }
    // Safety: never under itself or any of its own descendants (prevents cycles).
    if (newParentId === id || getDescendantIds(id, locations).has(newParentId ?? '')) {
      setMovingId(null);
      return;
    }
    // Writes ONLY parentId. Containers, photos, name, and id are untouched.
    await updateDoc(doc(db, `users/${user.uid}/locations/${id}`), { parentId: newParentId });
    setMovingId(null);
  }

  // Health Check repair: reattach an orphaned location to the top level so the
  // normal Rename/Move/Delete tools become reachable. Writes ONLY parentId. The
  // user must click the button — no automatic repair.
  async function repairOrphanToTopLevel(id: string) {
    await updateDoc(doc(db, `users/${user.uid}/locations/${id}`), { parentId: null });
  }

  function renderLocation(loc: Location, depth = 0) {
    const children = getLocationChildren(loc.id, locations);
    const containersHere = containers.filter(c => c.locationId === loc.id);
    const isExpanded = expandedIds.has(loc.id);
    const isEditing = editingId === loc.id;

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
          <div className="manage-actions">
            {isEditing ? (
              <button className="manage-btn save" onClick={() => renameLocation(loc.id, editingName)}>Save</button>
            ) : (
              <button className="manage-btn edit" onClick={() => { setEditingId(loc.id); setEditingName(loc.name); }}>Rename</button>
            )}
            <button className="manage-btn edit" onClick={() => {
              setMovingId(movingId === loc.id ? null : loc.id);
            }}>Move</button>
            <button className="manage-btn add" onClick={() => {
              setAddingUnder(loc.id);
              setNewSubName('');
              setExpandedIds(prev => new Set([...prev, loc.id]));
            }}>+ Sub-location</button>
            <button className="manage-btn add" onClick={() => {
              setAddingContainerUnder(loc.id);
              setNewContainerName('');
              setExpandedIds(prev => new Set([...prev, loc.id]));
            }}>+ Container</button>
            <button className="manage-btn delete" onClick={() => deleteLocation(loc.id)}>Delete</button>
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
                <option value="">Top level (no parent)</option>
                {eligible.map(l => (
                  <option key={l.id} value={l.id}>{getLocationPath(l.id, locations)}</option>
                ))}
              </select>
              <button className="manage-btn" onClick={() => setMovingId(null)}>Cancel</button>
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
                  placeholder="Sub-location name"
                  value={newSubName}
                  onChange={e => setNewSubName(e.target.value)}
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && newSubName.trim()) {
                      await createLocation(user.uid, newSubName.trim(), loc.id);
                      setAddingUnder(null);
                      setNewSubName('');
                    }
                    if (e.key === 'Escape') setAddingUnder(null);
                  }}
                />
                <button className="manage-btn save" onClick={async () => {
                  if (newSubName.trim()) {
                    await createLocation(user.uid, newSubName.trim(), loc.id);
                    setAddingUnder(null);
                    setNewSubName('');
                  }
                }}>Add</button>
              </div>
            )}
            {addingContainerUnder === loc.id && (
              <div className="manage-add-row" style={{ marginLeft: 20 }}>
                <input
                  autoFocus
                  className="manage-input"
                  placeholder="Container name — e.g. Counter, Drawer, Box 1"
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
                        isPrivate: false,
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
                }}>Add</button>
              </div>
            )}
            {children.map(child => renderLocation(child, depth + 1))}
            {containersHere.map(c => renderContainer(c))}
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
            <button className="manage-btn save" onClick={() => renameContainer(c.id, editingName)}>Save</button>
          ) : (
            <button className="manage-btn edit" onClick={() => { setEditingId(c.id); setEditingName(c.name); }}>Rename</button>
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
          <button className="sign-out-btn" onClick={() => navigate('/')}>← Back</button>
        </div>
      </header>

      <div className="manage-content">
        <h2 className="manage-title">Manage Locations</h2>

        {healthIssues.length > 0 && (
          <div className="health-panel">
            <button
              className="health-header"
              onClick={() => setHealthOpen(v => !v)}
              aria-expanded={healthOpen}
            >
              <span>⚠️ Location Health Check — {healthIssues.length} {healthIssues.length === 1 ? 'item' : 'items'} found</span>
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
                        Move to top level
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
            <p>No locations yet.</p>
            <button className="manage-btn add" onClick={() => setAddingTopLevel(true)}>+ Add first location</button>
          </div>
        )}
        {addingTopLevel && (
          <div className="manage-add-row">
            <input
              autoFocus
              className="manage-input"
              placeholder="Location name — e.g. Kitchen, Garage"
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
            }}>Add</button>
          </div>
        )}

        {topLevel.map(loc => renderLocation(loc))}

        {unassigned.length > 0 && (
          <div className="manage-section">
            <h3 className="manage-subtitle">Unassigned containers</h3>
            {unassigned.map(c => renderContainer(c))}
          </div>
        )}
      </div>
    </div>
  );
}
