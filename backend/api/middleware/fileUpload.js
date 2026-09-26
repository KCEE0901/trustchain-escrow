import multer from 'multer';
import path from 'path';
import prisma from '../../lib/prisma.js';
import ipfsService from '../../services/ipfsService.js';
import { broadcastToDispute } from '../websocket/handlers.js';
import virusScanMiddleware from '../../middleware/virusScanner.js';
import auditService, { AuditCategory, AuditAction } from '../../services/auditService.js';

// ── File upload constraints ───────────────────────────────────────────────────
//
// MAX_FILE_SIZE is capped at 50 MB per issue #363 requirements. The env var
// allows a lower override for specific deployments but cannot exceed this cap.
const HARD_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB — absolute ceiling
const MAX_FILE_SIZE = Math.min(
  parseInt(process.env.MAX_FILE_SIZE || String(HARD_MAX_FILE_SIZE), 10),
  HARD_MAX_FILE_SIZE,
);
const MAX_FILES = parseInt(process.env.MAX_FILES || '5', 10);

const storage = multer.memoryStorage();

/**
 * Strict MIME type allowlist for dispute evidence uploads.
 *
 * Only the four types below are accepted. Any other MIME type is rejected
 * with HTTP 415. This prevents MIME spoofing from slipping through and
 * ensures only expected file formats reach IPFS storage.
 *
 * Ref: issue #363 — "Sanitize and Validate File Metadata in evidence endpoint"
 */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
  'video/mp4',
]);

// ── Filename sanitization ─────────────────────────────────────────────────────

/**
 * Sanitize an uploaded filename so it is safe to store and display.
 *
 * Rules (issue #363):
 *  1. Strip path separators (/ and \) and any leading dots to prevent path
 *     traversal attacks (e.g. "../../etc/passwd" → "etcpasswd").
 *  2. Keep only alphanumeric characters, dashes, underscores, and dots.
 *  3. Preserve the original file extension (dot + lowercase letters/digits).
 *  4. Truncate the base name to 200 characters to prevent filesystem issues.
 *  5. If the result is empty, fall back to "upload".
 *
 * @param {string} original - The raw filename from the multipart form field.
 * @returns {string} A safe filename.
 */
export function sanitizeFilename(original) {
  if (!original || typeof original !== 'string') return 'upload';

  // Grab the extension before we strip characters (e.g. ".pdf", ".mp4")
  const ext = path.extname(original).toLowerCase().replace(/[^a-z0-9.]/g, '');

  // Strip path separators and isolate the base name
  const base = path
    .basename(original)
    .replace(/^\.+/, '')                // strip leading dots
    .replace(/[/\\]/g, '')             // strip path separators
    .replace(/\.[^.]*$/, '')           // remove original extension
    .replace(/[^a-zA-Z0-9_-]/g, '_')  // replace non-alphanumeric (except _ and -) with _
    .slice(0, 200);                     // cap base name length

  const safeName = (base || 'upload') + ext;
  return safeName;
}

// ── Multer file filter ────────────────────────────────────────────────────────

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    // Attach context so the error handler can log the rejection
    const err = Object.assign(
      new Error(`File type ${file.mimetype} is not allowed`),
      {
        code: 'LIMIT_FILE_TYPE',
        originalname: file.originalname,
        mimetype: file.mimetype,
        req,
      },
    );
    return cb(err, false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter,
});

// ── Upload error handler ──────────────────────────────────────────────────────

/**
 * Express error handler for multer errors.
 * Must be used as the last middleware in the upload chain.
 * All errors are returned in the standard { error: { code, message } } envelope.
 * Rejected uploads are written to the audit log.
 */
export function handleUploadError(err, req, res, next) {
  if (!err) return next();

  const actor =
    req.user?.walletAddress ||
    req.userAddress ||
    req.user?.userId?.toString() ||
    'anonymous';
  const resourceId = req.params?.id || req.params?.escrowId || null;

  if (err.code === 'LIMIT_FILE_SIZE') {
    // Log oversized upload rejection
    auditService.log({
      category: AuditCategory.DISPUTE,
      action: AuditAction.SUBMIT_EVIDENCE,
      actor,
      resourceId,
      metadata: {
        rejected: true,
        reason: 'FILE_TOO_LARGE',
        limitBytes: MAX_FILE_SIZE,
      },
      statusCode: 413,
      ipAddress: req.ip,
    });
    return res.status(413).json({
      error: {
        code: 'FILE_TOO_LARGE',
        message: `File size exceeds the ${MAX_FILE_SIZE / (1024 * 1024)} MB limit.`,
      },
    });
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    auditService.log({
      category: AuditCategory.DISPUTE,
      action: AuditAction.SUBMIT_EVIDENCE,
      actor,
      resourceId,
      metadata: {
        rejected: true,
        reason: 'TOO_MANY_FILES',
        maxFiles: MAX_FILES,
      },
      statusCode: 400,
      ipAddress: req.ip,
    });
    return res.status(400).json({
      error: {
        code: 'TOO_MANY_FILES',
        message: `Too many files attached. Maximum allowed is ${MAX_FILES}.`,
      },
    });
  }

  if (err.code === 'LIMIT_FILE_TYPE') {
    // Log disallowed MIME type rejection
    auditService.log({
      category: AuditCategory.DISPUTE,
      action: AuditAction.SUBMIT_EVIDENCE,
      actor,
      resourceId,
      metadata: {
        rejected: true,
        reason: 'UNSUPPORTED_MEDIA_TYPE',
        mimetype: err.mimetype,
        filename: err.originalname,
        allowedTypes: [...ALLOWED_MIME_TYPES],
      },
      statusCode: 415,
      ipAddress: req.ip,
    });
    return res.status(415).json({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: err.message,
        allowedTypes: [...ALLOWED_MIME_TYPES],
      },
    });
  }

  next(err);
}

// ── Filename sanitization middleware ─────────────────────────────────────────

/**
 * Sanitize filenames on all uploaded files in-place so that downstream
 * handlers (IPFS uploader, DB write) always work with safe names.
 */
export function sanitizeFilenames(req, _res, next) {
  if (req.files && Array.isArray(req.files)) {
    for (const file of req.files) {
      file.originalname = sanitizeFilename(file.originalname);
    }
  } else if (req.file) {
    req.file.originalname = sanitizeFilename(req.file.originalname);
  }
  next();
}

// ── IPFS upload middleware ────────────────────────────────────────────────────

const ipfsUploadMiddleware = async (req, res, next) => {
  if (!req.files || req.files.length === 0) return next();

  const disputeId = req.dispute?.id;

  try {
    const uploadResults = await Promise.all(
      req.files.map(async (file, index) => {
        // Broadcast per-file progress via WebSocket
        if (disputeId) {
          broadcastToDispute(disputeId, {
            type: 'upload_progress',
            filename: file.originalname,
            index,
            total: req.files.length,
          });
        }

        const ipfsResult = await ipfsService.pinFile(file.buffer);

        let thumbnailCid = null;
        if (ipfsService.isImage(file.mimetype)) {
          const thumbnailBuffer = await ipfsService.generateThumbnail(file.buffer, file.mimetype);
          if (thumbnailBuffer) {
            const thumbResult = await ipfsService.pinFile(thumbnailBuffer);
            thumbnailCid = thumbResult.cid;
          }
        }

        const metadata = await ipfsService.getFileMetadata(
          file.buffer,
          file.originalname,
          file.mimetype,
        );

        return {
          fieldname: file.fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          ipfsCid: ipfsResult.cid,
          thumbnailCid,
          metadata,
        };
      }),
    );

    req.ipfsUploadResults = uploadResults;
    next();
  } catch (error) {
    console.error('IPFS upload error:', error);
    res
      .status(500)
      .json({ error: 'IPFS upload failed', message: 'Unable to upload files to IPFS' });
  }
};

// ── Dispute access validation ─────────────────────────────────────────────────

const validateDisputeAccess = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user?.userId;

  if (!userId) return res.status(401).json({ error: 'User not authenticated' });

  try {
    // Resolve wallet address from DB — JWT payload only carries userId
    const userProfile = await prisma.userProfile.findFirst({
      where: { userId },
      select: { walletAddress: true },
    });
    const userAddress = userProfile?.walletAddress ?? null;

    const dispute = await prisma.dispute.findFirst({
      where: { id: parseInt(id), tenantId: req.tenant.id },
      include: { escrow: true },
    });

    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

    const isParticipant =
      userAddress &&
      (dispute.raisedByAddress === userAddress ||
        dispute.escrow.clientAddress === userAddress ||
        dispute.escrow.freelancerAddress === userAddress);
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'arbiter';

    if (!isParticipant && !isAdmin) return res.status(403).json({ error: 'Access denied' });

    req.dispute = dispute;
    req.userAddress = userAddress;
    next();
  } catch (error) {
    console.error('Dispute access validation error:', error);
    res.status(500).json({ error: 'Validation failed' });
  }
};

// ── Exported middleware chains ────────────────────────────────────────────────

export const uploadEvidence = [
  upload.array('files', MAX_FILES),
  handleUploadError,
  sanitizeFilenames,
  validateDisputeAccess,
  virusScanMiddleware,
  ipfsUploadMiddleware,
];

export const uploadSingleFile = upload.single('file');
export const uploadMultipleFiles = upload.array('files', MAX_FILES);

export { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, MAX_FILES };
