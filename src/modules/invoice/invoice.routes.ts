import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { extractTextFromPDF } from './extractors/pdf-text.extractor';
import { extractTextFromImage } from './extractors/ocr.extractor';
import { InvoiceParser } from './parser/invoice.parser';
import { InvoiceExtractionResult } from './types/invoice.types';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../../tmp/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename to prevent collisions and path traversal
    const uniqueName = `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`;
    cb(null, uniqueName);
  },
});

// File filter for validation
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
  ];

  const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed types: PDF, JPG, JPEG, PNG, WEBP`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1,
  },
});

/**
 * Helper function to clean up uploaded file
 */
function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Error cleaning up file:', error);
  }
}

/**
 * Helper function to send error response
 */
function sendErrorResponse(
  res: Response,
  statusCode: number,
  code: string,
  message: string
): void {
  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
    },
  });
}

/**
 * POST /api/invoice/extract-text
 * 
 * Extract text from system-generated PDFs where text is selectable.
 * Does NOT perform OCR.
 */
router.post('/extract-text', upload.single('file'), async (req: Request, res: Response) => {
  try {
    // Validate file presence
    if (!req.file) {
      return sendErrorResponse(res, 400, 'MISSING_FILE', 'No file uploaded. Please provide a PDF file in the "file" field.');
    }

    // Validate file type
    const allowedPdfTypes = ['application/pdf'];
    if (!allowedPdfTypes.includes(req.file.mimetype)) {
      cleanupFile(req.file.path);
      return sendErrorResponse(
        res,
        400,
        'UNSUPPORTED_FORMAT',
        `Invalid file type. This endpoint only accepts PDF files. Received: ${req.file.mimetype}`
      );
    }

    // Read PDF buffer
    const pdfBuffer = fs.readFileSync(req.file.path);

    // Extract text from PDF
    const extractionResult = await extractTextFromPDF(pdfBuffer);

    // Check if PDF has selectable text
    if (!extractionResult.hasSelectableText) {
      cleanupFile(req.file.path);
      return sendErrorResponse(
        res,
        422,
        'NO_SELECTABLE_TEXT',
        'The PDF does not contain selectable text. Please use the /api/invoice/extract-ocr endpoint for scanned documents.'
      );
    }

    // Parse the invoice using common parser
    const parser = new InvoiceParser(extractionResult.tokens);
    const result: InvoiceExtractionResult = await parser.parse('text');

    // Clean up uploaded file
    cleanupFile(req.file.path);

    // Return successful response
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error in extract-text:', error);
    
    // Clean up file if it exists
    if (req.file && req.file.path) {
      cleanupFile(req.file.path);
    }

    sendErrorResponse(
      res,
      500,
      'EXTRACTION_FAILED',
      error instanceof Error ? error.message : 'An unexpected error occurred during text extraction'
    );
  }
});

/**
 * POST /api/invoice/extract-ocr
 * 
 * Extract text from scanned/image-based invoices using OCR.
 * Supports PDF, JPG, JPEG, PNG, WEBP formats.
 */
router.post('/extract-ocr', upload.single('file'), async (req: Request, res: Response) => {
  try {
    // Validate file presence
    if (!req.file) {
      return sendErrorResponse(res, 400, 'MISSING_FILE', 'No file uploaded. Please provide a file in the "file" field.');
    }

    // Validate file type
    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ];

    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      cleanupFile(req.file.path);
      return sendErrorResponse(
        res,
        400,
        'UNSUPPORTED_FORMAT',
        `Invalid file type. Allowed types: PDF, JPG, JPEG, PNG, WEBP. Received: ${req.file.mimetype}`
      );
    }

    // Read file buffer
    const fileBuffer = fs.readFileSync(req.file.path);

    // Extract text using OCR
    const ocrResult = await extractTextFromImage(fileBuffer, req.file.mimetype);

    // Check if OCR found any text
    if (ocrResult.tokens.length === 0) {
      cleanupFile(req.file.path);
      return sendErrorResponse(
        res,
        422,
        'NO_TEXT_DETECTED',
        'No text could be detected in the document. The image may be too blurry or the quality may be insufficient for OCR.'
      );
    }

    // Parse the invoice using common parser
    const parser = new InvoiceParser(ocrResult.tokens);
    const result: InvoiceExtractionResult = await parser.parse('ocr');

    // Clean up uploaded file
    cleanupFile(req.file.path);

    // Return successful response
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error in extract-ocr:', error);
    
    // Clean up file if it exists
    if (req.file && req.file.path) {
      cleanupFile(req.file.path);
    }

    sendErrorResponse(
      res,
      500,
      'OCR_EXTRACTION_FAILED',
      error instanceof Error ? error.message : 'An unexpected error occurred during OCR extraction'
    );
  }
});

// Error handler for multer
router.use((err: any, req: Request, res: Response, next: any) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return sendErrorResponse(res, 400, 'FILE_TOO_LARGE', 'File size exceeds the 10MB limit');
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return sendErrorResponse(res, 400, 'TOO_MANY_FILES', 'Only one file can be uploaded at a time');
    }
    return sendErrorResponse(res, 400, 'UPLOAD_ERROR', err.message);
  }

  if (err.message && err.message.includes('Unsupported file type')) {
    return sendErrorResponse(res, 400, 'UNSUPPORTED_FORMAT', err.message);
  }

  next(err);
});

export { router as invoiceRoutes, upload };
