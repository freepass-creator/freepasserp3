/**
 * 공지사항 Firebase CRUD
 */
import { watchCollection, setRecord, updateRecord, softDelete, pushRecord } from './db.js';
import { uploadImage } from './storage-helper.js';

export function watchNotices(callback) {
  return watchCollection('home_notices', callback);
}

export async function saveNotice(data) {
  const key = `notice_${Date.now()}`;
  await setRecord(`home_notices/${key}`, {
    ...data,
    created_at: Date.now(),
  });
  return key;
}

export async function updateNotice(key, data) {
  await updateRecord(`home_notices/${key}`, data);
}

export async function deleteNotice(key) {
  await softDelete(`home_notices/${key}`);
}

export async function uploadNoticeImage(file) {
  const path = `notice-images/${Date.now()}_${file.name}`;
  const { url } = await uploadImage(path, file);
  return url;
}
