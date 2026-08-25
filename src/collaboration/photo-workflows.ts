type SharedPhotoResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

interface SharedPhotoWriter<TPhoto> {
  addPhoto(containerId: string, photo: TPhoto): Promise<SharedPhotoResult>;
}

interface PersistCapturedPhotoOptions<TPhoto> {
  containerId: string;
  photo: TPhoto;
  existingPhotos: readonly TPhoto[];
  collaborator: SharedPhotoWriter<TPhoto> | null;
  writeOwnedPhotos: (photos: TPhoto[]) => Promise<void>;
}

export async function persistCapturedPhoto<TPhoto>({
  containerId,
  photo,
  existingPhotos,
  collaborator,
  writeOwnedPhotos,
}: PersistCapturedPhotoOptions<TPhoto>): Promise<TPhoto[]> {
  const nextPhotos = [...existingPhotos, photo];

  if (collaborator) {
    const result = await collaborator.addPhoto(containerId, photo);
    if (!result.ok) {
      throw new Error(`collaboration-photo:${result.reason}`);
    }
  } else {
    await writeOwnedPhotos(nextPhotos);
  }

  return nextPhotos;
}

interface SaveCapturedPhotoQueueOptions<TFile, TPhoto> {
  files: readonly TFile[];
  existingPhotos: readonly TPhoto[];
  createPhoto: (file: TFile, index: number) => Promise<TPhoto>;
  persistPhoto: (
    photo: TPhoto,
    existingPhotos: readonly TPhoto[],
  ) => Promise<TPhoto[]>;
  onProgress?: (current: number, total: number) => void;
}

export async function saveCapturedPhotoQueue<TFile, TPhoto>({
  files,
  existingPhotos,
  createPhoto,
  persistPhoto,
  onProgress,
}: SaveCapturedPhotoQueueOptions<TFile, TPhoto>): Promise<TPhoto[]> {
  let savedPhotos = [...existingPhotos];

  for (let index = 0; index < files.length; index += 1) {
    onProgress?.(index + 1, files.length);
    const photo = await createPhoto(files[index], index);
    savedPhotos = await persistPhoto(photo, savedPhotos);
  }

  return savedPhotos;
}
