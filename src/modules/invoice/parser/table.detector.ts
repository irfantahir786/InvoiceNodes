import { TextToken } from '../types/invoice.types';
import { normalizeText, matchesToken } from './normalizer';

/**
 * Line token represents a group of tokens on the same horizontal line
 */
export interface LineToken {
  tokens: TextToken[];
  page: number;
  y: number;
  minX: number;
  maxX: number;
  text: string;
}

/**
 * Group tokens into lines based on vertical proximity.
 * Tokens within a small Y threshold are considered to be on the same line.
 */
export function groupTokensIntoLines(tokens: TextToken[], yThreshold: number = 5): LineToken[] {
  if (tokens.length === 0) return [];

  // Sort tokens by page, then by Y coordinate (top to bottom)
  const sortedTokens = [...tokens].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return a.y - b.y;
  });

  const lines: LineToken[] = [];
  let currentLine: TextToken[] = [sortedTokens[0]];

  for (let i = 1; i < sortedTokens.length; i++) {
    const prevToken = currentLine[currentLine.length - 1];
    const currToken = sortedTokens[i];

    // Check if this token is on the same line (within Y threshold)
    const yDiff = Math.abs(currToken.y - prevToken.y);
    
    if (yDiff <= yThreshold && currToken.page === prevToken.page) {
      currentLine.push(currToken);
    } else {
      // Finalize current line and start new one
      lines.push(createLineToken(currentLine));
      currentLine = [currToken];
    }
  }

  // Don't forget the last line
  if (currentLine.length > 0) {
    lines.push(createLineToken(currentLine));
  }

  return lines;
}

function createLineToken(tokens: TextToken[]): LineToken {
  const sortedByX = [...tokens].sort((a, b) => a.x - b.x);
  return {
    tokens: sortedByX,
    page: tokens[0].page,
    y: tokens[0].y,
    minX: Math.min(...tokens.map(t => t.x)),
    maxX: Math.max(...tokens.map(t => t.x + t.width)),
    text: tokens.map(t => t.text).join(' '),
  };
}

/**
 * Detect potential table header lines.
 * Headers typically contain specific keywords and are positioned before data rows.
 */
export function detectHeaderLines(lines: LineToken[]): LineToken[] {
  const headerKeywords = [
    'description', 'item', 'qty', 'quantity', 'rate', 'price', 'amount',
    'hsn', 'sac', 'gst', 'cgst', 'sgst', 'igst', 'tax', 'total',
    'particulars', 'goods', 'product', 'units', 'nos', 'pieces'
  ];

  const potentialHeaders: Array<{ line: LineToken; score: number }> = [];

  for (const line of lines) {
    const lineText = normalizeText(line.text);
    let score = 0;

    // Count how many header keywords appear in this line
    for (const keyword of headerKeywords) {
      if (lineText.includes(keyword)) {
        score++;
      }
    }

    // Headers often have multiple words/tokens
    if (line.tokens.length >= 3) {
      score += 1;
    }

    // Headers are often in uppercase or title case
    const upperCaseRatio = line.text.replace(/[^A-Za-z]/g, '').split('').filter(c => c === c.toUpperCase()).length / 
                           (line.text.replace(/[^A-Za-z]/g, '').length || 1);
    if (upperCaseRatio > 0.5) {
      score += 0.5;
    }

    if (score >= 2) {
      potentialHeaders.push({ line, score });
    }
  }

  // Sort by score descending and return top candidates
  potentialHeaders.sort((a, b) => b.score - a.score);
  
  // Return headers with good scores, but limit to avoid false positives
  return potentialHeaders.filter(h => h.score >= 2).map(h => h.line);
}

/**
 * Detect column positions from header tokens.
 * Returns column boundaries based on X coordinates of header words.
 */
export interface ColumnDefinition {
  type: string;
  xStart: number;
  xEnd: number;
  centerX: number;
}

export function detectColumnsFromHeader(headerLine: LineToken): ColumnDefinition[] {
  const columns: ColumnDefinition[] = [];
  
  for (const token of headerLine.tokens) {
    const columnType = inferColumnType(token.text);
    if (columnType) {
      columns.push({
        type: columnType,
        xStart: token.x,
        xEnd: token.x + token.width,
        centerX: token.x + token.width / 2,
      });
    }
  }

  // Expand column boundaries to cover gaps
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    
    // Extend left boundary to halfway to previous column
    if (i > 0) {
      const prevCol = columns[i - 1];
      col.xStart = (prevCol.xEnd + col.xStart) / 2;
    }
    
    // Extend right boundary to halfway to next column
    if (i < columns.length - 1) {
      const nextCol = columns[i + 1];
      col.xEnd = (col.xEnd + nextCol.xStart) / 2;
    }
  }

  return columns;
}

/**
 * Infer column type from token text
 */
function inferColumnType(text: string): string | null {
  const normalized = normalizeText(text);
  
  // Map common header variations to canonical column types
  const columnMappings: Record<string, string[]> = {
    description: ['description', 'item', 'particulars', 'goods', 'product', 'name', 'details'],
    quantity: ['qty', 'quantity', 'qnty', 'units', 'nos', 'pcs', 'pieces', 'count'],
    rate: ['rate', 'price', 'unit', 'mrp', 'unitprice'],
    hsn: ['hsn', 'sac', 'hsnsac', 'code', 'classification'],
    amount: ['amount', 'total', 'value', 'net', 'gross', 'taxable'],
    gst: ['gst', 'tax', 'gst%'],
    cgst: ['cgst', 'central'],
    sgst: ['sgst', 'state'],
    igst: ['igst', 'integrated'],
    discount: ['discount', 'disc', 'less', 'off'],
    cess: ['cess', 'compensation'],
    unit: ['unit', 'uom', 'measure'],
  };

  for (const [columnType, variations] of Object.entries(columnMappings)) {
    if (variations.some(v => normalized.includes(v))) {
      return columnType;
    }
  }

  return null;
}

/**
 * Assign a token to the most appropriate column based on X position
 */
export function assignTokenToColumn(token: TextToken, columns: ColumnDefinition[]): string | null {
  const tokenCenterX = token.x + token.width / 2;

  for (const column of columns) {
    if (tokenCenterX >= column.xStart && tokenCenterX <= column.xEnd) {
      return column.type;
    }
  }

  // If no exact match, find closest column
  let closestColumn: ColumnDefinition | null = null;
  let minDistance = Infinity;

  for (const column of columns) {
    const distance = Math.abs(tokenCenterX - column.centerX);
    if (distance < minDistance) {
      minDistance = distance;
      closestColumn = column;
    }
  }

  // Only assign if reasonably close (within 100 pixels)
  if (closestColumn && minDistance < 100) {
    return closestColumn.type;
  }

  return null;
}

/**
 * Detect table region based on header position and content density
 */
export interface TableRegion {
  startY: number;
  endY: number;
  startPage: number;
  endPage: number;
  headerLine: LineToken | null;
  columns: ColumnDefinition[];
}

export function detectTableRegions(lines: LineToken[]): TableRegion[] {
  const headerLines = detectHeaderLines(lines);
  
  if (headerLines.length === 0) {
    return [];
  }

  const regions: TableRegion[] = [];

  for (const headerLine of headerLines) {
    const columns = detectColumnsFromHeader(headerLine);
    
    if (columns.length < 2) {
      continue; // Need at least 2 columns to be a valid table
    }

    // Find data rows below this header
    const dataStartIndex = lines.findIndex(l => l === headerLine) + 1;
    if (dataStartIndex >= lines.length) continue;

    let dataEndIndex = dataStartIndex;
    
    // Look for where the table ends
    for (let i = dataStartIndex; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if line has tokens that align with columns
      const hasAlignedTokens = line.tokens.some(token => {
        return assignTokenToColumn(token, columns) !== null;
      });

      // Also check if line looks like numeric data row
      const hasNumericContent = line.tokens.some(t => /^[\d.,]+$/.test(t.text));

      if (hasAlignedTokens || hasNumericContent) {
        dataEndIndex = i + 1;
      } else if (i > dataStartIndex + 2) {
        // If we've seen some data rows and now hit non-data, stop
        break;
      }
    }

    // Handle multi-page tables
    let endPage = headerLine.page;
    for (let i = dataStartIndex; i < dataEndIndex && i < lines.length; i++) {
      endPage = Math.max(endPage, lines[i].page);
    }

    regions.push({
      startY: headerLine.y,
      endY: dataEndIndex < lines.length ? lines[dataEndIndex - 1].y : headerLine.y,
      startPage: headerLine.page,
      endPage,
      headerLine,
      columns,
    });
  }

  return regions;
}
