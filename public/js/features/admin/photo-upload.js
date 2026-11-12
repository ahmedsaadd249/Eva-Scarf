// Dashboard → product form: chosen photos are resized and shown as previews before the form is sent.
import { $, $$, msg } from '../../lib/dom.js';

// Phone photos are often several MB; the host accepts at most ~4.5 MB per request. Photos are resized
// in the browser (long side 1600 px, JPEG) before uploading, which also makes the store load faster.
const MAX_SIDE = 1600;
const MAX_TOTAL = 4 * 1024 * 1024;

async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 700 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

export function initPhotoUpload(imageInput) {
  const preview = $('[data-image-preview]');
  if (!preview) return;
  const submitButtons = $$('button:not([form]):not([type=button])', imageInput.form);
  imageInput.addEventListener('change', async () => {
    submitButtons.forEach((b) => { b.disabled = true; });
    const files = await Promise.all([...imageInput.files].map(shrinkImage));
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    imageInput.files = dt.files;
    const tooBig = files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL;
    preview.replaceChildren(...files.map((file) => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      img.className = 'aspect-[3/4] w-full rounded-md object-cover ring-1 ring-line';
      return img;
    }));
    if (tooBig) {
      const note = document.createElement('p');
      note.className = 'col-span-full text-[13px] text-[#B3203A]';
      note.textContent = msg('admin.upload_too_big');
      preview.append(note);
    }
    submitButtons.forEach((b) => { b.disabled = tooBig; });
  });
}
