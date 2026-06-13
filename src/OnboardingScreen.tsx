import { useState, useRef } from 'react';
import { type User } from 'firebase/auth';
import logoMark from './assets/logo-mark.svg';
import {
  type StarterNode,
  writeStarterTree,
  buildHomeTree,
  buildMovingTree,
  buildStorageTree,
  buildCollectionTree,
  FIXED_TEMPLATES,
  type StorageSize,
} from './locations';
import './OnboardingScreen.css';

type TemplateId =
  | 'home' | 'moving' | 'storage' | 'estate'
  | 'business' | 'office' | 'collection' | 'vehicle' | 'custom';

type Step =
  | 'category' | 'home-q' | 'moving-q' | 'storage-q'
  | 'collection-q' | 'preview' | 'creating';

const EXTRA_SPACES = [
  'Kitchen', 'Living Room', 'Dining Room', 'Office',
  'Garage', 'Basement', 'Attic', 'Laundry Room', 'Storage Room', 'Patio / Outdoor',
];
const STORAGE_OPTS = [
  'Bedroom closets', 'Linen closet', 'Pantry', 'Garage shelves', 'Utility closet',
];

interface Category {
  id: TemplateId;
  icon: string;
  label: string;
  description: string;
}

const CATEGORIES: Category[] = [
  { id: 'home',       icon: '🏠', label: 'Home',                 description: 'House, apartment, or condo' },
  { id: 'moving',     icon: '🚚', label: 'Moving',               description: 'Packing up and moving somewhere new' },
  { id: 'storage',    icon: '📦', label: 'Storage Unit',         description: 'Organize by zone or shelf' },
  { id: 'estate',     icon: '📜', label: 'Family / Estate',      description: 'Shared belongings or estate items' },
  { id: 'business',   icon: '💼', label: 'Business / Supplies',  description: 'Inventory, tools, and supplies' },
  { id: 'office',     icon: '🗂️', label: 'Office',               description: 'Desk, files, and equipment' },
  { id: 'collection', icon: '⭐', label: 'Collection / Hobby',   description: 'Display, stored, and for sale' },
  { id: 'vehicle',    icon: '🚗', label: 'Vehicle / RV / Boat',  description: 'Compartments, tools, and gear' },
  { id: 'custom',     icon: '✏️', label: "I'll set it up myself", description: 'Start with a blank slate' },
];

function TreeNode({ node, depth }: { node: StarterNode; depth: number }) {
  return (
    <div>
      <div className="ob-tree-row" style={{ paddingLeft: depth * 18 }}>
        <span className="ob-tree-dot">●</span>
        <span className="ob-tree-name">{node.name}</span>
      </div>
      {node.children?.map((child, i) => (
        <TreeNode key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

interface Props {
  user: User;
  onDone: (result: { skipped: boolean }) => void;
}

export default function OnboardingScreen({ user, onDone }: Props) {
  const [step, setStep]             = useState<Step>('category');
  const [templateId, setTemplateId] = useState<TemplateId | null>(null);
  const [previewTree, setPreviewTree] = useState<StarterNode[]>([]);
  const [error, setError]           = useState('');
  const creatingRef                 = useRef(false);

  // Home answers
  const [bedrooms, setBedrooms]       = useState(2);
  const [bathrooms, setBathrooms]     = useState(1);
  const [extras, setExtras]           = useState<string[]>(['Kitchen', 'Living Room', 'Garage']);
  const [storageOpts, setStorageOpts] = useState<string[]>([]);

  // Home — vehicles
  const [vehicles, setVehicles] = useState(0);

  // Moving answers
  const [movingBeds, setMovingBeds]       = useState(2);
  const [includeGarage, setIncludeGarage] = useState(true);

  // Storage answers
  const [storageSize, setStorageSize] = useState<StorageSize>('medium');

  // Collection answers
  const [collectionType, setCollectionType] = useState('');

  function toggleExtra(name: string) {
    setExtras(p => p.includes(name) ? p.filter(x => x !== name) : [...p, name]);
  }
  function toggleStorageOpt(name: string) {
    setStorageOpts(p => p.includes(name) ? p.filter(x => x !== name) : [...p, name]);
  }

  function selectTemplate(id: TemplateId) {
    setTemplateId(id);
    if (id === 'custom')     { onDone({ skipped: true }); return; }
    if (id === 'home')       { setStep('home-q');       return; }
    if (id === 'moving')     { setStep('moving-q');     return; }
    if (id === 'storage')    { setStep('storage-q');    return; }
    if (id === 'collection') { setStep('collection-q'); return; }
    const tree = FIXED_TEMPLATES[id] ?? [];
    setPreviewTree(tree);
    setStep('preview');
  }

  function goToPreview() {
    let tree: StarterNode[] = [];
    if (templateId === 'home')
      tree = buildHomeTree({ bedrooms, bathrooms, extras, storage: storageOpts, vehicles });
    else if (templateId === 'moving')
      tree = buildMovingTree({ bedrooms: movingBeds, includeGarage });
    else if (templateId === 'storage')
      tree = buildStorageTree(storageSize);
    else if (templateId === 'collection')
      tree = buildCollectionTree(collectionType);
    setPreviewTree(tree);
    setStep('preview');
  }

  async function handleCreate() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setError('');
    setStep('creating');
    try {
      await writeStarterTree(user.uid, previewTree, null);
    } catch {
      setError('Something went wrong. Please try again.');
      creatingRef.current = false;
      setStep('preview');
      return;
    }
    onDone({ skipped: false });
  }

  function backFromQ() {
    setStep('category');
    setTemplateId(null);
  }

  function backFromPreview() {
    if (templateId === 'home')       { setStep('home-q');       return; }
    if (templateId === 'moving')     { setStep('moving-q');     return; }
    if (templateId === 'storage')    { setStep('storage-q');    return; }
    if (templateId === 'collection') { setStep('collection-q'); return; }
    setStep('category');
  }

  if (step === 'creating') {
    return (
      <div className="ob-screen ob-center">
        <div className="ob-spinner" />
        <p className="ob-creating-text">Setting up your locations…</p>
      </div>
    );
  }

  return (
    <div className="ob-screen">
      <header className="ob-header">
        <img src={logoMark} alt="" className="ob-logo-mark" />
        <span className="ob-wordmark">Vowvy</span>
      </header>

      {step === 'category'    && renderCategory()}
      {step === 'home-q'      && renderHomeQ()}
      {step === 'moving-q'    && renderMovingQ()}
      {step === 'storage-q'   && renderStorageQ()}
      {step === 'collection-q' && renderCollectionQ()}
      {step === 'preview'     && renderPreview()}
    </div>
  );

  function renderCategory() {
    return (
      <div className="ob-body">
        <h1 className="ob-title">What are you organizing first?</h1>
        <p className="ob-subtitle">We'll set up a quick location structure — you can always change it later.</p>
        <div className="ob-grid">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              className={`ob-card${cat.id === 'custom' ? ' ob-card-custom' : ''}`}
              onClick={() => selectTemplate(cat.id)}
            >
              <span className="ob-card-icon">{cat.icon}</span>
              <span className="ob-card-label">{cat.label}</span>
              <span className="ob-card-desc">{cat.description}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderHomeQ() {
    return (
      <div className="ob-body ob-questions">
        <button className="ob-back" onClick={backFromQ}>← Back</button>
        <h2 className="ob-q-title">Home Setup</h2>

        <div className="ob-field">
          <label className="ob-label">Bedrooms</label>
          <div className="ob-stepper">
            <button onClick={() => setBedrooms(n => Math.max(1, n - 1))}>−</button>
            <span className="ob-stepper-val">{bedrooms}</span>
            <button onClick={() => setBedrooms(n => Math.min(8, n + 1))}>+</button>
          </div>
        </div>

        <div className="ob-field">
          <label className="ob-label">Bathrooms</label>
          <div className="ob-stepper">
            <button onClick={() => setBathrooms(n => Math.max(1, n - 1))}>−</button>
            <span className="ob-stepper-val">{bathrooms}</span>
            <button onClick={() => setBathrooms(n => Math.min(6, n + 1))}>+</button>
          </div>
        </div>

        <div className="ob-field">
          <label className="ob-label">Extra spaces</label>
          <div className="ob-checkgroup">
            {EXTRA_SPACES.map(name => (
              <label key={name} className="ob-check">
                <input type="checkbox" checked={extras.includes(name)} onChange={() => toggleExtra(name)} />
                {name}
              </label>
            ))}
          </div>
        </div>

        <div className="ob-field">
          <label className="ob-label">Starter storage</label>
          <div className="ob-checkgroup">
            {STORAGE_OPTS.map(name => (
              <label key={name} className="ob-check">
                <input type="checkbox" checked={storageOpts.includes(name)} onChange={() => toggleStorageOpt(name)} />
                {name}
              </label>
            ))}
          </div>
        </div>

        <div className="ob-field">
          <label className="ob-label">Do you want to add your car(s)?</label>
          <div className="ob-size-group">
            {([0, 1, 2, 3] as const).map(n => (
              <label key={n} className={`ob-size-card${vehicles === n ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="ob-vehicles"
                  value={n}
                  checked={vehicles === n}
                  onChange={() => setVehicles(n)}
                />
                <span className="ob-size-label">{n === 0 ? 'None' : n}</span>
                <span className="ob-size-desc">{n === 0 ? 'Skip' : n === 1 ? 'vehicle' : 'vehicles'}</span>
              </label>
            ))}
          </div>
        </div>

        <button className="ob-primary-btn" onClick={goToPreview}>Preview my locations →</button>
      </div>
    );
  }

  function renderMovingQ() {
    return (
      <div className="ob-body ob-questions">
        <button className="ob-back" onClick={backFromQ}>← Back</button>
        <h2 className="ob-q-title">Moving Setup</h2>

        <div className="ob-field">
          <label className="ob-label">Bedrooms in the old place</label>
          <div className="ob-stepper">
            <button onClick={() => setMovingBeds(n => Math.max(1, n - 1))}>−</button>
            <span className="ob-stepper-val">{movingBeds}</span>
            <button onClick={() => setMovingBeds(n => Math.min(8, n + 1))}>+</button>
          </div>
        </div>

        <div className="ob-field">
          <label className="ob-label">Include Garage / Storage?</label>
          <div className="ob-radio-group">
            <label className="ob-radio">
              <input type="radio" name="ob-garage" checked={includeGarage} onChange={() => setIncludeGarage(true)} />
              Yes
            </label>
            <label className="ob-radio">
              <input type="radio" name="ob-garage" checked={!includeGarage} onChange={() => setIncludeGarage(false)} />
              No
            </label>
          </div>
        </div>

        <button className="ob-primary-btn" onClick={goToPreview}>Preview my locations →</button>
      </div>
    );
  }

  function renderStorageQ() {
    const SIZES: { value: StorageSize; label: string; desc: string }[] = [
      { value: 'small',  label: 'Small',  desc: 'A few zones' },
      { value: 'medium', label: 'Medium', desc: 'Standard unit' },
      { value: 'large',  label: 'Large',  desc: 'Large unit' },
    ];
    return (
      <div className="ob-body ob-questions">
        <button className="ob-back" onClick={backFromQ}>← Back</button>
        <h2 className="ob-q-title">Storage Unit Setup</h2>

        <div className="ob-field">
          <label className="ob-label">What size is your unit?</label>
          <div className="ob-size-group">
            {SIZES.map(s => (
              <label key={s.value} className={`ob-size-card${storageSize === s.value ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="ob-size"
                  value={s.value}
                  checked={storageSize === s.value}
                  onChange={() => setStorageSize(s.value)}
                />
                <span className="ob-size-label">{s.label}</span>
                <span className="ob-size-desc">{s.desc}</span>
              </label>
            ))}
          </div>
        </div>

        <button className="ob-primary-btn" onClick={goToPreview}>Preview my locations →</button>
      </div>
    );
  }

  function renderCollectionQ() {
    return (
      <div className="ob-body ob-questions">
        <button className="ob-back" onClick={backFromQ}>← Back</button>
        <h2 className="ob-q-title">Collection Setup</h2>

        <div className="ob-field">
          <label className="ob-label">What are you collecting or organizing?</label>
          <input
            className="ob-text-input"
            type="text"
            placeholder="e.g. Vinyl Records, Books, Comic Books"
            value={collectionType}
            autoFocus
            onChange={e => setCollectionType(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && goToPreview()}
          />
        </div>

        <button className="ob-primary-btn" onClick={goToPreview}>Preview my locations →</button>
      </div>
    );
  }

  function renderPreview() {
    return (
      <div className="ob-body">
        <button className="ob-back" onClick={backFromPreview}>← Back</button>
        <h2 className="ob-q-title">Here's what we'll create</h2>
        <p className="ob-subtitle">You can rename, add, or remove any of these later.</p>

        <div className="ob-preview-tree">
          {previewTree.map((node, i) => (
            <TreeNode key={i} node={node} depth={0} />
          ))}
        </div>

        {error && <p className="ob-error">{error}</p>}

        <button className="ob-primary-btn" onClick={handleCreate}>
          Create my locations
        </button>
        <button className="ob-text-link" onClick={() => setStep('category')}>
          Choose a different template
        </button>
      </div>
    );
  }
}
