import { useState, useRef } from 'react';
import { type User } from 'firebase/auth';
import { useTranslation } from 'react-i18next';
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

// Stable keys for extra spaces — translated at render time and passed to Firestore as names
const EXTRA_SPACE_KEYS = [
  'kitchen', 'livingRoom', 'diningRoom', 'office',
  'garage', 'basement', 'attic', 'laundryRoom', 'storageRoom', 'patio',
] as const;

// Stable keys for storage options — same pattern
const STORAGE_OPT_KEYS = [
  'bedroomClosets', 'linenCloset', 'pantry', 'garageShelves', 'utilityCloset',
] as const;

// Category icons are not translated
const CATEGORY_ICONS: Record<TemplateId, string> = {
  home: '🏠', moving: '🚚', storage: '📦', estate: '📜',
  business: '💼', office: '🗂️', collection: '⭐', vehicle: '🚗', custom: '✏️',
};

const CATEGORY_IDS: TemplateId[] = [
  'home', 'moving', 'storage', 'estate',
  'business', 'office', 'collection', 'vehicle', 'custom',
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
  const { t } = useTranslation();
  const [step, setStep]             = useState<Step>('category');
  const [templateId, setTemplateId] = useState<TemplateId | null>(null);
  const [previewTree, setPreviewTree] = useState<StarterNode[]>([]);
  const [error, setError]           = useState('');
  const creatingRef                 = useRef(false);

  // Home answers — selectedExtraKeys stores EXTRA_SPACE_KEYS values
  const [bedrooms, setBedrooms]             = useState(2);
  const [bathrooms, setBathrooms]           = useState(1);
  const [selectedExtraKeys, setSelectedExtraKeys] = useState<string[]>(['kitchen', 'livingRoom', 'garage']);
  const [selectedStorageKeys, setSelectedStorageKeys] = useState<string[]>([]);

  // Home — vehicles
  const [vehicles, setVehicles] = useState(0);

  // Moving answers
  const [movingBeds, setMovingBeds]       = useState(2);
  const [includeGarage, setIncludeGarage] = useState(true);

  // Storage answers
  const [storageSize, setStorageSize] = useState<StorageSize>('medium');

  // Collection answers
  const [collectionType, setCollectionType] = useState('');

  function toggleExtraKey(key: string) {
    setSelectedExtraKeys(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key]);
  }
  function toggleStorageKey(key: string) {
    setSelectedStorageKeys(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key]);
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
      tree = buildHomeTree({
        bedrooms,
        bathrooms,
        extras: selectedExtraKeys.map(k => t(`onboarding.spaces.${k}`)),
        storage: selectedStorageKeys.map(k => t(`onboarding.storage.${k}`)),
        vehicles,
      });
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
      setError(t('onboarding.preview.error'));
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
        <p className="ob-creating-text">{t('onboarding.creating')}</p>
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
        <h1 className="ob-title">{t('onboarding.categoryTitle')}</h1>
        <p className="ob-subtitle">{t('onboarding.categorySubtitle')}</p>
        <div className="ob-grid">
          {CATEGORY_IDS.map(id => (
            <button
              key={id}
              className={`ob-card${id === 'custom' ? ' ob-card-custom' : ''}`}
              onClick={() => selectTemplate(id)}
            >
              <span className="ob-card-icon">{CATEGORY_ICONS[id]}</span>
              <span className="ob-card-label">{t(`onboarding.categories.${id}.label`)}</span>
              <span className="ob-card-desc">{t(`onboarding.categories.${id}.desc`)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderHomeQ() {
    return (
      <div className="ob-body ob-questions">
        <button className="ob-back" onClick={backFromQ}>{t('onboarding.back')}</button>
        <h2 className="ob-q-title">{t('onboarding.homeSetup.title')}</h2>

        <div className="ob-field">
          <label className="ob-label">{t('onboarding.homeSetup.bedrooms')}</label>
          <div className="ob-stepper">
            <button onClick={() => setBedrooms(n => Math.max(1, n - 1))}>−</button>
            <span className="ob-stepper-val">{bedrooms}</span>
            <button onClick={() => setBedrooms(n => Math.min(8, n + 1))}>+</button>
          </div>
        </div>

        <div className="ob-field">
          <label className="ob-label">{t('onboarding.homeSetup.bathrooms')}</label>
          <div className="ob-stepper">
            <button onClick={() => setBathrooms(n => Math.max(1, n - 1))}>−</button>
            <span className="ob-stepper-val">{bathrooms}</span>
            <button onClick={() => setBathrooms(n => Math.min(6, n + 1))}>+</button>
          </div>
        </div>

        <div className="ob-field">
          <label className="ob-label">{t('onboarding.homeSetup.extraSpaces')}</label>
          <div className="ob-checkgroup">
            {EXTRA_SPACE_KEYS.map(key => (
              <label key={key} className="ob-check">
                <input
                  type="checkbox"
                  checked={selectedExtraKeys.includes(key)}
                  onChange={() => toggleExtraKey(key)}
                />
                {t(`onboarding.spaces.${key}`)}
              </label>
            ))}
          </div>
        </div>

        <div className="ob-field">
          <label className="ob-label">{t('onboarding.homeSetup.starterStorage')}</label>
          <div className="ob-checkgroup">
            {STORAGE_OPT_KEYS.map(key => (
              <label key={key} className="ob-check">
                <input
                  type="checkbox"
                  checked={selectedStorageKeys.includes(key)}
                  onChange={() => toggleStorageKey(key)}
                />
                {t(`onboarding.storage.${key}`)}
              </label>
            ))}
          </div>
        </div>

        <div className="ob-field">
          <label className="ob-label">{t('onboarding.homeSetup.vehiclesQuestion')}</label>
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
                <span className="ob-size-label">
                  {n === 0 ? t('onboarding.homeSetup.noVehicles') : n}
                </span>
                <span className="ob-size-desc">
                  {n === 0
                    ? t('onboarding.homeSetup.skipVehicles')
                    : n === 1
                      ? t('onboarding.homeSetup.vehicleSingular')
                      : t('onboarding.homeSetup.vehiclesPlural')}
                </span>
              </label>
            ))}
          </div>
        </div>

        <button className="ob-primary-btn" onClick={goToPreview}>{t('onboarding.previewBtn')}</button>
      </div>
    );
  }

  function renderMovingQ() {
    return (
      <div className="ob-body ob-questions">
        <button className="ob-back" onClick={backFromQ}>{t('onboarding.back')}</button>
        <h2 className="ob-q-title">{t('onboarding.movingSetup.title')}</h2>

        <div className="ob-field">
          <label className="ob-label">{t('onboarding.movingSetup.bedrooms')}</label>
          <div className="ob-stepper">
            <button onClick={() => setMovingBeds(n => Math.max(1, n - 1))}>−</button>
            <span className="ob-stepper-val">{movingBeds}</span>
            <button onClick={() => setMovingBeds(n => Math.min(8, n + 1))}>+</button>
          </div>
        </div>

        <div className="ob-field">
          <label className="ob-label">{t('onboarding.movingSetup.includeGarage')}</label>
          <div className="ob-radio-group">
            <label className="ob-radio">
              <input type="radio" name="ob-garage" checked={includeGarage} onChange={() => setIncludeGarage(true)} />
              {t('onboarding.movingSetup.yes')}
            </label>
            <label className="ob-radio">
              <input type="radio" name="ob-garage" checked={!includeGarage} onChange={() => setIncludeGarage(false)} />
              {t('onboarding.movingSetup.no')}
            </label>
          </div>
        </div>

        <button className="ob-primary-btn" onClick={goToPreview}>{t('onboarding.previewBtn')}</button>
      </div>
    );
  }

  function renderStorageQ() {
    const SIZES: { value: StorageSize; labelKey: string; descKey: string }[] = [
      { value: 'small',  labelKey: 'onboarding.storageSetup.small',  descKey: 'onboarding.storageSetup.smallDesc' },
      { value: 'medium', labelKey: 'onboarding.storageSetup.medium', descKey: 'onboarding.storageSetup.mediumDesc' },
      { value: 'large',  labelKey: 'onboarding.storageSetup.large',  descKey: 'onboarding.storageSetup.largeDesc' },
    ];
    return (
      <div className="ob-body ob-questions">
        <button className="ob-back" onClick={backFromQ}>{t('onboarding.back')}</button>
        <h2 className="ob-q-title">{t('onboarding.storageSetup.title')}</h2>

        <div className="ob-field">
          <label className="ob-label">{t('onboarding.storageSetup.sizeQuestion')}</label>
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
                <span className="ob-size-label">{t(s.labelKey)}</span>
                <span className="ob-size-desc">{t(s.descKey)}</span>
              </label>
            ))}
          </div>
        </div>

        <button className="ob-primary-btn" onClick={goToPreview}>{t('onboarding.previewBtn')}</button>
      </div>
    );
  }

  function renderCollectionQ() {
    return (
      <div className="ob-body ob-questions">
        <button className="ob-back" onClick={backFromQ}>{t('onboarding.back')}</button>
        <h2 className="ob-q-title">{t('onboarding.collectionSetup.title')}</h2>

        <div className="ob-field">
          <label className="ob-label">{t('onboarding.collectionSetup.question')}</label>
          <input
            className="ob-text-input"
            type="text"
            placeholder={t('onboarding.collectionSetup.placeholder')}
            value={collectionType}
            autoFocus
            onChange={e => setCollectionType(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && goToPreview()}
          />
        </div>

        <button className="ob-primary-btn" onClick={goToPreview}>{t('onboarding.previewBtn')}</button>
      </div>
    );
  }

  function renderPreview() {
    return (
      <div className="ob-body">
        <button className="ob-back" onClick={backFromPreview}>{t('onboarding.back')}</button>
        <h2 className="ob-q-title">{t('onboarding.preview.title')}</h2>
        <p className="ob-subtitle">{t('onboarding.preview.subtitle')}</p>

        <div className="ob-preview-tree">
          {previewTree.map((node, i) => (
            <TreeNode key={i} node={node} depth={0} />
          ))}
        </div>

        {error && <p className="ob-error">{error}</p>}

        <button className="ob-primary-btn" onClick={handleCreate}>
          {t('onboarding.preview.create')}
        </button>
        <button className="ob-text-link" onClick={() => setStep('category')}>
          {t('onboarding.preview.chooseDifferent')}
        </button>
      </div>
    );
  }
}
