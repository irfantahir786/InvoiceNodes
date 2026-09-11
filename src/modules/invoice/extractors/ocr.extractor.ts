import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import { TextToken } from '../types/invoice.types';

/**
 * OCR Extractor interface - allows swapping OCR engines without changing API
 */
export interface OcrResult {
  tokens: TextToken[];
  pageCount: number;
}

/**
 * Perform OCR on an image buffer and return text with bounding boxes.
 */
async function ocrImage(imageBuffer: Buffer, page: number): Promise<TextToken[]> {
  const tokens: TextToken[] = [];

  try {
    // Preprocess image for better OCR results
    const processedImage = await sharp(imageBuffer)
      .grayscale()
      .normalize()
      .threshold(128)
      .toBuffer();

    const result = await Tesseract.recognize(processedImage, 'eng', {
      logger: () => {}, // Suppress progress logging
    });

    // Extract words with bounding boxes from the result
    // Type assertion to handle Tesseract.js API variations
    const resultData = result.data as any;
    if (resultData && Array.isArray(resultData.words)) {
      for (const word of resultData.words) {
        const text = word.text?.trim() || '';
        if (!text) continue;

        const bbox = word.bbox;
        if (!bbox) continue;

        tokens.push({
          text,
          page,
          x: Math.round(bbox.x0),
          y: Math.round(bbox.y0),
          width: Math.round(bbox.x1 - bbox.x0),
          height: Math.round(bbox.y1 - bbox.y0),
        });
      }
    }

    return tokens;
  } catch (error) {
    console.error('OCR error:', error);
    throw new Error(`OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Convert PDF page to image buffer using pdfjs-dist
 */
async function pdfPageToImage(pdfBuffer: Buffer, pageNum: number): Promise<Buffer> {
  const pdfjsLib = require('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/build/pdf.worker.min.js');

  const typedArray = new Uint8Array(pdfBuffer);
  const loadingTask = pdfjsLib.getDocument({ data: typedArray });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageNum);

  // Render at higher scale for better OCR quality
  const viewport = page.getViewport({ scale: 2 });

  const canvas = {
    width: viewport.width,
    height: viewport.height,
    data: new Uint8ClampedArray(viewport.width * viewport.height * 4),
  };

  const renderContext = {
    canvasContext: {
      ...canvas,
      fillRect: () => {},
      clearRect: () => {},
      getImageData: () => ({ data: canvas.data }),
      putImageData: () => {},
      createImageData: () => [],
      setTransform: () => {},
      drawImage: () => {},
      save: () => {},
      fillText: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      arc: () => {},
      fill: () => {},
      measureText: () => ({ width: 0 }),
      transform: () => {},
      rect: () => {},
      clip: () => {},
    } as any,
    viewport: viewport,
  };

  await page.render(renderContext).promise;

  // Convert canvas data to image buffer using sharp
  const imageBuffer = await sharp(canvas.data, {
    raw: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();

  return imageBuffer;
}

/**
 * Extract text from image(s) using OCR.
 * Supports PDF, PNG, JPG, JPEG, WEBP formats.
 */
export async function extractTextFromImage(
  fileBuffer: Buffer,
  mimeType: string
): Promise<OcrResult> {
  const tokens: TextToken[] = [];
  let pageCount = 0;

  try {
    if (mimeType === 'application/pdf') {
      // Handle multi-page PDF
      const pdfjsLib = require('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/build/pdf.worker.min.js');

      const typedArray = new Uint8Array(fileBuffer);
      const loadingTask = pdfjsLib.getDocument({ data: typedArray });
      const pdf = await loadingTask.promise;
      pageCount = pdf.numPages;

      for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
        const imageBuffer = await pdfPageToImage(fileBuffer, pageNum);
        const pageTokens = await ocrImage(imageBuffer, pageNum);
        tokens.push(...pageTokens);
      }
    } else {
      // Single image file
      pageCount = 1;
      const pageTokens = await ocrImage(fileBuffer, 1);
      tokens.push(...pageTokens);
    }

    return { tokens, pageCount };
  } catch (error) {
    console.error('Error extracting text from image:', error);
    throw new Error(`Failed to extract text from image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
