/**
 * Firebase Storage helper — 이미지/파일 업로드, 삭제
 */
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './config.js';

/**
 * Upload a file and return download URL
 * @param {string} path - Storage path (e.g. 'chat-files/roomId/filename')
 * @param {File} file
 * @returns {Promise<{url: string, name: string, type: string, size: number}>}
 */
export async function uploadFile(path, file) {
  const fileRef = storageRef(storage, path);
  const snap = await uploadBytes(fileRef, file);
  const url = await getDownloadURL(snap.ref);
  return { url, name: file.name, type: file.type, size: file.size };
}

/**
 * Upload image with resize (max 1920px, WebP)
 */
export async function uploadImage(path, file) {
  const resized = await resizeImage(file, 1920);
  return uploadFile(path, resized);
}

/**
 * Delete a file by URL or path
 */
export async function deleteFile(pathOrUrl) {
  try {
    let filePath = pathOrUrl;
    if (pathOrUrl.startsWith('http')) {
      // Extract path from download URL
      const url = new URL(pathOrUrl);
      filePath = decodeURIComponent(url.pathname.split('/o/')[1]?.split('?')[0] || '');
    }
    if (!filePath) return;
    const fileRef = storageRef(storage, filePath);
    await deleteObject(fileRef);
  } catch (e) {
    if (e.code === 'storage/object-not-found') return; // already deleted
    throw e;
  }
}

/**
 * Resize image to max dimension, convert to WebP
 */
function resizeImage(file, maxSize) {
  return new Promise((resolve) => {
    // If not image, return as-is
    if (!file.type.startsWith('image/')) { resolve(file); return; }

    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxSize && height <= maxSize) { resolve(file); return; }

      const ratio = Math.min(maxSize / width, maxSize / height);
      width *= ratio;
      height *= ratio;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        resolve(new File([blob], file.name.replace(/\.\w+$/, '.webp'), { type: 'image/webp' }));
      }, 'image/webp', 0.8);
    };
    img.src = URL.createObjectURL(file);
  });
}
