/**
 * Media Transcoding Service
 *
 * Asynchronously transcodes chat attachment images and videos.
 * Compression and resizing happen in the background without blocking the event loop.
 *
 * Image handling:
 *  - Compress to WebP format
 *  - Resize to high-resolution web standard (1920x1920)
 *  - Generate low-resolution thumbnail (300x300)
 *  - Pin both transcoded asset and thumbnail to IPFS
 *
 * Video handling:
 *  - Requires fluent-ffmpeg if available; otherwise skipped with warning
 *
 * All operations are queued asynchronously. The chat message is sent immediately
 * with the original CID; the transcoded CID is attached once ready.
 */

import sharp from 'sharp';
import ipfsService from './ipfsService.js';
import { createModuleLogger } from '../config/logger.js';

const logger = createModuleLogger('service.mediaTranscoder');

export const WEBP_QUALITY = parseInt(process.env.WEBP_QUALITY || '85', 10);
export const THUMBNAIL_SIZE = parseInt(process.env.THUMBNAIL_SIZE || '300', 10);
export const WEB_STANDARD_SIZE = parseInt(process.env.WEB_STANDARD_SIZE || '1920', 10);
export const MAX_TRANSCODE_SIZE = parseInt(
  process.env.MAX_TRANSCODE_SIZE || String(50 * 1024 * 1024),
  10,
);

export const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

export const MAX_MEDIA_DIMENSION = parseInt(process.env.MAX_MEDIA_DIMENSION || '4096', 10);
export const MAX_MEDIA_DURATION_SECONDS = parseInt(
  process.env.MAX_MEDIA_DURATION_SECONDS || '300',
  10,
); // 5 minutes

// Optional: fluent-ffmpeg for video transcoding
let ffmpeg;
try {
  const { default: ffmpegModule } = await import('fluent-ffmpeg');
  ffmpeg = ffmpegModule;
} catch {
  logger.warn({
    message: 'fluent_ffmpeg_not_available',
    note: 'Video transcoding will be skipped',
  });
}

class MediaTranscoder {
  /**
   * Check if buffer is an image by inspecting magic bytes.
   */
  isImage(mimeType, buffer) {
    if (typeof mimeType === 'string' && mimeType.startsWith('image/')) {
      return true;
    }
    // Fallback: check magic bytes
    if (!buffer || buffer.length < 4) return false;
    const magicBytes = buffer.toString('hex', 0, 4);
    // JPEG: FF D8, PNG: 89 50, GIF: 47 49 46, WebP: 52 49 46 46 (RIFF)
    return /^ffd8|^8950|^4749|^52494646/.test(magicBytes);
  }

  /**
   * Validate media dimensions, duration, and MIME type before submitting evidence to transcoder.
   * Throws user-readable errors if input validation fails.
   *
   * @param {object} media
   * @param {string} media.mimeType
   * @param {number} [media.duration] Duration in seconds
   * @param {number} [media.width] Width in pixels
   * @param {number} [media.height] Height in pixels
   * @param {object} [media.dimensions] Dimensions object { width, height }
   * @throws {Error} User-readable validation error with error.code
   * @returns {boolean} true if valid
   */
  validateMediaInput(media) {
    if (!media) {
      const err = new Error('Media file or descriptor is required.');
      err.code = 'INVALID_MEDIA_PAYLOAD';
      throw err;
    }

    const mimeType = (media.mimeType || media.mimetype || '').toLowerCase();
    if (!mimeType) {
      const err = new Error('Media MIME type is required.');
      err.code = 'INVALID_MIME_TYPE';
      throw err;
    }

    if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      const err = new Error(
        `Unsupported media type "${mimeType}". Allowed types: ${[...SUPPORTED_MIME_TYPES].join(', ')}.`,
      );
      err.code = 'UNSUPPORTED_MEDIA_TYPE';
      throw err;
    }

    // Validate duration (e.g. video / audio evidence)
    const duration = media.duration ?? media.durationSeconds;
    if (duration !== undefined && duration !== null) {
      const durNum = Number(duration);
      if (isNaN(durNum) || durNum < 0) {
        const err = new Error('Media duration must be a non-negative number.');
        err.code = 'INVALID_DURATION';
        throw err;
      }
      if (durNum > MAX_MEDIA_DURATION_SECONDS) {
        const err = new Error(
          `Media duration of ${durNum} seconds exceeds the maximum allowed limit of ${MAX_MEDIA_DURATION_SECONDS} seconds.`,
        );
        err.code = 'DURATION_EXCEEDED';
        throw err;
      }
    }

    // Validate dimensions
    const width = media.width ?? media.dimensions?.width;
    const height = media.height ?? media.dimensions?.height;

    if (width !== undefined && width !== null) {
      const w = Number(width);
      if (isNaN(w) || w <= 0) {
        const err = new Error('Media width must be a positive integer.');
        err.code = 'INVALID_DIMENSION';
        throw err;
      }
      if (w > MAX_MEDIA_DIMENSION) {
        const err = new Error(
          `Media width (${w}px) exceeds the maximum allowed limit of ${MAX_MEDIA_DIMENSION}px.`,
        );
        err.code = 'DIMENSIONS_EXCEEDED';
        throw err;
      }
    }

    if (height !== undefined && height !== null) {
      const h = Number(height);
      if (isNaN(h) || h <= 0) {
        const err = new Error('Media height must be a positive integer.');
        err.code = 'INVALID_DIMENSION';
        throw err;
      }
      if (h > MAX_MEDIA_DIMENSION) {
        const err = new Error(
          `Media height (${h}px) exceeds the maximum allowed limit of ${MAX_MEDIA_DIMENSION}px.`,
        );
        err.code = 'DIMENSIONS_EXCEEDED';
        throw err;
      }
    }

    return true;
  }

  /**
   * Validates media and enqueues it for transcoding.
   * Unsupported files fail BEFORE enqueue with user-readable errors.
   *
   * @param {object} attachment
   * @param {string} originalCid
   * @returns {Promise<object>} Transcoding result promise
   */
  async enqueue(attachment, originalCid) {
    // Validate inputs BEFORE enqueueing
    this.validateMediaInput(attachment);

    // Enqueue transcoding
    return this.transcodeAsync(attachment, originalCid);
  }

  /**
   * Submit evidence to mediaTranscoder with pre-enqueue validation.
   */
  async submitEvidence(attachment, originalCid) {
    return this.enqueue(attachment, originalCid);
  }

  /**
   * Compress image to WebP and resize to web standard (1920x1920).
   */
  async transcodeImage(buffer, filename) {
    try {
      if (buffer.length > MAX_TRANSCODE_SIZE) {
        logger.warn({
          message: 'image_too_large_for_transcode',
          filename,
          size: buffer.length,
          maxSize: MAX_TRANSCODE_SIZE,
        });
        return null;
      }

      const transcoded = await sharp(buffer)
        .resize(WEB_STANDARD_SIZE, WEB_STANDARD_SIZE, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();

      logger.debug({
        message: 'image_transcoded',
        filename,
        originalSize: buffer.length,
        transcodedSize: transcoded.length,
        compressionRatio: (transcoded.length / buffer.length).toFixed(2),
      });

      return transcoded;
    } catch (error) {
      logger.error({
        message: 'image_transcode_failed',
        filename,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Generate low-resolution thumbnail (300x300).
   */
  async generateThumbnail(buffer, filename) {
    try {
      return await sharp(buffer)
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
          fit: 'cover',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();
    } catch (error) {
      logger.error({
        message: 'thumbnail_generation_failed',
        filename,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Transcode image: generate WebP asset and thumbnail, pin both to IPFS.
   * Returns { assetCid, thumbnailCid, status }.
   */
  async transcodeImageFile(buffer, filename) {
    try {
      // Generate transcoded image and thumbnail in parallel
      const [transcodedBuffer, thumbnailBuffer] = await Promise.all([
        this.transcodeImage(buffer, filename),
        this.generateThumbnail(buffer, filename),
      ]);

      if (!transcodedBuffer && !thumbnailBuffer) {
        return { status: 'failed', reason: 'Transcoding failed' };
      }

      // Pin to IPFS in parallel
      const results = await Promise.all([
        transcodedBuffer ? ipfsService.pinFile(transcodedBuffer) : null,
        thumbnailBuffer ? ipfsService.pinFile(thumbnailBuffer) : null,
      ]);

      const assetCid = results[0]?.cid || null;
      const thumbnailCid = results[1]?.cid || null;

      logger.info({
        message: 'image_transcoded_and_pinned',
        filename,
        assetCid,
        thumbnailCid,
      });

      return {
        status: 'success',
        assetCid,
        thumbnailCid,
      };
    } catch (error) {
      logger.error({
        message: 'image_transcode_pipeline_failed',
        filename,
        error: error.message,
      });
      return { status: 'error', reason: error.message };
    }
  }

  /**
   * Queue asynchronous transcoding for a chat attachment.
   * Returns immediately without blocking; the chat message is sent with original CID.
   * Transcoded results are available in the promise for async handlers.
   */
  async transcodeAsync(attachment, originalCid) {
    // Skip transcoding for non-image files (video transcoding requires ffmpeg setup)
    if (!this.isImage(attachment.mimeType, attachment.buffer)) {
      logger.debug({
        message: 'skipping_non_image_transcode',
        filename: attachment.filename,
        mimeType: attachment.mimeType,
      });
      return { status: 'skipped', reason: 'Not an image' };
    }

    // Queue transcoding to run asynchronously without blocking event loop
    // Use setImmediate to yield to event loop, then process in background
    return new Promise((resolve) => {
      setImmediate(async () => {
        try {
          const result = await this.transcodeImageFile(attachment.buffer, attachment.filename);
          resolve(result);
        } catch (error) {
          logger.error({
            message: 'async_transcode_error',
            filename: attachment.filename,
            error: error.message,
          });
          resolve({ status: 'error', reason: error.message });
        }
      });
    });
  }

  /**
   * Enrich chat payload with transcoded media assets.
   * Called after async transcoding completes.
   */
  updatePayloadWithTranscodedCid(payload, transcodeResult) {
    if (transcodeResult.status !== 'success') {
      return payload;
    }

    return {
      ...payload,
      attachment: {
        ...payload.attachment,
        originalCid: payload.attachment.cid,
        transcodedCid: transcodeResult.assetCid,
        thumbnailCid: transcodeResult.thumbnailCid,
        transcodeStatus: 'complete',
      },
    };
  }
}

export default new MediaTranscoder();
