import * as pdfjs from 'pdfjs-dist';
import { TextToken } from '../types/invoice.types';

// Initialize PDF.js worker - use dynamic path resolution for production
const pdfjsLib = pdfjs;

function getWorkerSrc(): string {
  try {
    // Try to resolve the worker path dynamically
    const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
    return workerPath;
  } catch {
    // Fallback to CDN for environments where local resolution fails
    return 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js';
  }
}

pdfjsLib.GlobalWorkerOptions.workerSrc = getWorkerSrc();

/**
 * Extract text and layout information from a PDF buffer.
 * Uses PDF.js native text extraction to get text content with bounding boxes.
 */
export async function extractTextFromPDF(pdfBuffer: Buffer): Promise<{
  tokens: TextToken[];
  pageCount: number;
  hasSelectableText: boolean;
}> {
  const tokens: TextToken[] = [];
  
  try {
    const typedArray = new Uint8Array(pdfBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: typedArray });
    const pdf = await loadingTask.promise;
    const pageCount = pdf.numPages;

    let totalChars = 0;

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // Get viewport for coordinate transformation
      const viewport = page.getViewport({ scale: 1 });
      const pageHeight = viewport.height;

      for (const item of textContent.items) {
        const textItem = item as any;
        const text = textItem.str.trim();
        
        if (!text) continue;

        totalChars += text.length;

        // Transform coordinates from PDF space to image space
        // PDF coordinates start from bottom-left, we need top-left
        const transform = textItem.transform;
        const x = transform[4];
        const y = pageHeight - transform[5];
        const width = Math.sqrt(transform[0] ** 2 + transform[1] ** 2) * text.length;
        const height = Math.sqrt(transform[2] ** 2 + transform[3] ** 2);

        tokens.push({
          text,
          page: pageNum,
          x: Math.round(x * 100) / 100,
          y: Math.round(y * 100) / 100,
          width: Math.round(width * 100) / 100,
          height: Math.round(height * 100) / 100,
        });
      }
    }

    // Determine if PDF has selectable text
    // If we extracted very few characters relative to page count, it's likely scanned
    const avgCharsPerPage = totalChars / pageCount;
    const hasSelectableText = avgCharsPerPage > 50; // Threshold for meaningful text

    return {
      tokens,
      pageCount,
      hasSelectableText,
    };
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
