// Product photo uploads. Files are kept in memory and checked; they're only stored (Supabase Storage or
// the local uploads folder) once the rest of the form is valid, so a rejected form leaves no stray files.
import multer from 'multer';
import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, MAX_IMAGES_PER_UPLOAD } from '../config/constants.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES_PER_UPLOAD },
  fileFilter: (req, file, cb) => cb(null, Boolean(IMAGE_EXTENSIONS[file.mimetype])),
});

/** Check the file really is an image by its first bytes, not just the name/type it claimed. */
function looksLikeImage(buf) {
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const webp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  return jpeg || png || webp;
}

/**
 * Reads the form's "images" files into req.files. A problem doesn't stop the request: it's noted in
 * req.uploadError (a message key) so the form can be shown again with the rest of what was typed.
 */
export function uploadImages(req, res, next) {
  upload.array('images', MAX_IMAGES_PER_UPLOAD)(req, res, (err) => {
    if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'admin.error_image_size' : 'admin.error_image';
    else if ((req.files ?? []).some((f) => !looksLikeImage(f.buffer))) req.uploadError = 'admin.error_image';
    next();
  });
}

/** The uploaded photos, or none when there was a problem. */
export const uploadedImages = (req) => (req.uploadError ? [] : req.files ?? []);
