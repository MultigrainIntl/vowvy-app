import { describe, expect, it, vi } from 'vitest';
import {
  persistCapturedPhoto,
  saveCapturedPhotoQueue,
} from '../../src/collaboration/photo-workflows';

describe('distinct inventory photo workflows', () => {
  it('preserves the existing owner photo write path', async () => {
    const writeOwnedPhotos = vi.fn(async () => undefined);
    const existingPhotos = ['existing-photo'];

    await expect(persistCapturedPhoto({
      containerId: 'owner-container',
      photo: 'new-photo',
      existingPhotos,
      collaborator: null,
      writeOwnedPhotos,
    })).resolves.toEqual(['existing-photo', 'new-photo']);

    expect(writeOwnedPhotos).toHaveBeenCalledOnce();
    expect(writeOwnedPhotos).toHaveBeenCalledWith([
      'existing-photo',
      'new-photo',
    ]);
    expect(existingPhotos).toEqual(['existing-photo']);
  });

  it('writes collaborator photos through the verified inventory service', async () => {
    const collaborator = {
      addPhoto: vi.fn(async () => ({ ok: true as const, value: undefined })),
    };
    const writeOwnedPhotos = vi.fn(async () => undefined);

    await expect(persistCapturedPhoto({
      containerId: 'shared-container',
      photo: 'shared-photo',
      existingPhotos: ['existing-photo'],
      collaborator,
      writeOwnedPhotos,
    })).resolves.toEqual(['existing-photo', 'shared-photo']);

    expect(collaborator.addPhoto).toHaveBeenCalledWith(
      'shared-container',
      'shared-photo',
    );
    expect(writeOwnedPhotos).not.toHaveBeenCalled();
  });

  it('rejects unauthorized collaborator photos without using the owner path', async () => {
    const collaborator = {
      addPhoto: vi.fn(async () => ({ ok: false as const, reason: 'forbidden' })),
    };
    const writeOwnedPhotos = vi.fn(async () => undefined);

    await expect(persistCapturedPhoto({
      containerId: 'private-container',
      photo: 'blocked-photo',
      existingPhotos: [],
      collaborator,
      writeOwnedPhotos,
    })).rejects.toThrow('collaboration-photo:forbidden');

    expect(writeOwnedPhotos).not.toHaveBeenCalled();
  });

  it('saves every Add Items capture sequentially and preserves its progress counter', async () => {
    const files = ['capture-one', 'capture-two', 'capture-three'];
    const progress: Array<[number, number]> = [];
    const writes: string[][] = [];

    const result = await saveCapturedPhotoQueue({
      files,
      existingPhotos: ['existing-photo'],
      createPhoto: async (file, index) => `${file}-${index}`,
      persistPhoto: async (photo, existingPhotos) => {
        const nextPhotos = [...existingPhotos, photo];
        writes.push(nextPhotos);
        return nextPhotos;
      },
      onProgress: (current, total) => progress.push([current, total]),
    });

    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(writes).toEqual([
      ['existing-photo', 'capture-one-0'],
      ['existing-photo', 'capture-one-0', 'capture-two-1'],
      ['existing-photo', 'capture-one-0', 'capture-two-1', 'capture-three-2'],
    ]);
    expect(result).toEqual([
      'existing-photo',
      'capture-one-0',
      'capture-two-1',
      'capture-three-2',
    ]);
    expect(files).toEqual(['capture-one', 'capture-two', 'capture-three']);
  });

  it('supports the photo viewer single-photo workflow without adding a queue', async () => {
    const createPhoto = vi.fn(async (file: string) => `saved-${file}`);
    const persistPhoto = vi.fn(async (
      photo: string,
      existingPhotos: readonly string[],
    ) => [...existingPhotos, photo]);

    await expect(saveCapturedPhotoQueue({
      files: ['viewer-photo'],
      existingPhotos: ['existing-photo'],
      createPhoto,
      persistPhoto,
    })).resolves.toEqual(['existing-photo', 'saved-viewer-photo']);

    expect(createPhoto).toHaveBeenCalledOnce();
    expect(persistPhoto).toHaveBeenCalledOnce();
  });

  it('stops the batch immediately when a photo cannot be persisted', async () => {
    const persisted: string[] = [];

    await expect(saveCapturedPhotoQueue({
      files: ['first', 'blocked', 'third'],
      existingPhotos: [],
      createPhoto: async file => file,
      persistPhoto: async (photo, existingPhotos) => {
        if (photo === 'blocked') throw new Error('photo-write-failed');
        persisted.push(photo);
        return [...existingPhotos, photo];
      },
    })).rejects.toThrow('photo-write-failed');

    expect(persisted).toEqual(['first']);
  });
});
