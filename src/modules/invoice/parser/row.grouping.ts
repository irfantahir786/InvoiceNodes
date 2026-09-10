import { TextToken, ExtractedItem } from '../types/invoice.types';
import { LineToken, ColumnDefinition, groupTokensIntoLines, detectTableRegions, assignTokenToColumn } from './table.detector';
import { parseNumber } from './normalizer';

/**
 * Group lines into table rows, handling multi-line descriptions
 */
export interface TableRow {
  line: LineToken;
  tokensByColumn: Record<string, TextToken[]>;
  isHeaderRow: boolean;
  isTotalRow: boolean;
}

/**
 * Parse table rows from detected regions
 */
export function parseTableRows(
  lines: LineToken[],
  headerLine: LineToken | null,
  columns: ColumnDefinition[]
): TableRow[] {
  const rows: TableRow[] = [];
  
  if (!headerLine) return rows;

  // Find the header line index
  const headerIndex = lines.findIndex(l => l === headerLine);
  if (headerIndex < 0) return rows;

  // Process lines after the header
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if this looks like a data row
    const tokensByColumn: Record<string, TextToken[]> = {};
    
    for (const token of line.tokens) {
      const columnType = assignTokenToColumn(token, columns);
      if (columnType) {
        if (!tokensByColumn[columnType]) {
          tokensByColumn[columnType] = [];
        }
        tokensByColumn[columnType].push(token);
      }
    }

    // Skip if no tokens align with columns
    if (Object.keys(tokensByColumn).length === 0) {
      continue;
    }

    // Detect if this is a header repeat (skip it)
    const isHeaderRepeat = isHeaderRow(line, headerLine);
    
    // Detect if this is a total/subtotal row
    const isTotalRow = detectTotalRow(line);

    rows.push({
      line,
      tokensByColumn,
      isHeaderRow: isHeaderRepeat,
      isTotalRow,
    });
  }

  return rows;
}

/**
 * Check if a line is a repeated header
 */
function isHeaderRow(line: LineToken, originalHeader: LineToken): boolean {
  const lineText = line.text.toLowerCase();
  const headerText = originalHeader.text.toLowerCase();
  
  // Check if line contains most of the header keywords
  const headerWords = headerText.split(/\s+/).filter(w => w.length > 2);
  const matchCount = headerWords.filter(w => lineText.includes(w)).length;
  
  return matchCount >= headerWords.length * 0.7;
}

/**
 * Detect if a row is a total/subtotal row based on keywords
 */
function detectTotalRow(line: LineToken): boolean {
  const totalKeywords = [
    'total', 'subtotal', 'grand total', 'net total', 'amount',
    'balance', 'taxable', 'round off', 'rounding'
  ];
  
  const lineText = line.text.toLowerCase();
  return totalKeywords.some(keyword => lineText.includes(keyword));
}

/**
 * Merge consecutive rows that belong to the same item (multi-line descriptions)
 */
export function mergeMultiLineRows(rows: TableRow[]): TableRow[] {
  if (rows.length === 0) return rows;

  const mergedRows: TableRow[] = [];
  let currentRow: TableRow | null = null;

  for (const row of rows) {
    if (row.isHeaderRow) continue; // Skip repeated headers

    if (!currentRow) {
      currentRow = { ...row, tokensByColumn: { ...row.tokensByColumn } };
      continue;
    }

    // Check if this row should be merged with the previous one
    const shouldMerge = shouldMergeRows(currentRow, row);

    if (shouldMerge) {
      // Merge description tokens
      if (row.tokensByColumn.description) {
        if (!currentRow.tokensByColumn.description) {
          currentRow.tokensByColumn.description = [];
        }
        currentRow.tokensByColumn.description.push(...row.tokensByColumn.description);
      }
      
      // For other columns, use values from the new row if current is empty
      for (const [colType, tokens] of Object.entries(row.tokensByColumn)) {
        if (!currentRow.tokensByColumn[colType] || currentRow.tokensByColumn[colType].length === 0) {
          currentRow.tokensByColumn[colType] = tokens;
        }
      }
    } else {
      mergedRows.push(currentRow);
      currentRow = { ...row, tokensByColumn: { ...row.tokensByColumn } };
    }
  }

  if (currentRow) {
    mergedRows.push(currentRow);
  }

  return mergedRows;
}

/**
 * Determine if two rows should be merged (same item, multi-line description)
 */
function shouldMergeRows(prevRow: TableRow, currRow: TableRow): boolean {
  // Don't merge total rows
  if (currRow.isTotalRow || prevRow.isTotalRow) {
    return false;
  }

  // If current row has quantity/rate/amount but prev doesn't, they're separate items
  const currHasNumeric = currRow.tokensByColumn.quantity || 
                         currRow.tokensByColumn.rate || 
                         currRow.tokensByColumn.amount;
  
  const prevHasNumeric = prevRow.tokensByColumn.quantity || 
                         prevRow.tokensByColumn.rate || 
                         prevRow.tokensByColumn.amount;

  if (currHasNumeric && !prevHasNumeric) {
    // Current row starts a new item
    return false;
  }

  // If both have numeric values in same columns, they're likely separate items
  if (currHasNumeric && prevHasNumeric) {
    // Check Y spacing - large gap means separate items
    const yGap = currRow.line.y - prevRow.line.y;
    if (yGap > 30) { // More than 30 pixels gap
      return false;
    }
  }

  // If current row only has description-like content, merge it
  const descOnly = Object.keys(currRow.tokensByColumn).every(col => 
    col === 'description' || col === 'hsn'
  );

  if (descOnly) {
    return true;
  }

  return false;
}

/**
 * Convert parsed rows to ExtractedItem objects
 */
export function convertRowsToItems(rows: TableRow[]): ExtractedItem[] {
  const items: ExtractedItem[] = [];

  for (const row of rows) {
    if (row.isHeaderRow || row.isTotalRow) continue;

    const item: ExtractedItem = {
      description: extractTextFromTokens(row.tokensByColumn.description),
      sku: extractTextFromTokens(row.tokensByColumn.sku),
      barcode: null,
      hsn: extractTextFromTokens(row.tokensByColumn.hsn) || 
           extractTextFromTokens(row.tokensByColumn.sac),
      sac: extractTextFromTokens(row.tokensByColumn.sac),
      quantity: parseNumber(extractTextFromTokens(row.tokensByColumn.quantity)),
      unit: extractTextFromTokens(row.tokensByColumn.unit),
      rate: parseNumber(extractTextFromTokens(row.tokensByColumn.rate)),
      discount: parseNumber(extractTextFromTokens(row.tokensByColumn.discount)),
      taxable_value: parseNumber(extractTextFromTokens(row.tokensByColumn.taxable_value)) ||
                     parseNumber(extractTextFromTokens(row.tokensByColumn.amount)),
      gst_rate: parseNumber(extractTextFromTokens(row.tokensByColumn.gst)),
      cgst_rate: parseNumber(extractTextFromTokens(row.tokensByColumn.cgst_rate)),
      cgst_amount: parseNumber(extractTextFromTokens(row.tokensByColumn.cgst_amount)) ||
                   parseNumber(extractTextFromTokens(row.tokensByColumn.cgst)),
      sgst_rate: parseNumber(extractTextFromTokens(row.tokensByColumn.sgst_rate)),
      sgst_amount: parseNumber(extractTextFromTokens(row.tokensByColumn.sgst_amount)) ||
                   parseNumber(extractTextFromTokens(row.tokensByColumn.sgst)),
      igst_rate: parseNumber(extractTextFromTokens(row.tokensByColumn.igst_rate)),
      igst_amount: parseNumber(extractTextFromTokens(row.tokensByColumn.igst_amount)) ||
                   parseNumber(extractTextFromTokens(row.tokensByColumn.igst)),
      cess_rate: parseNumber(extractTextFromTokens(row.tokensByColumn.cess_rate)),
      cess_amount: parseNumber(extractTextFromTokens(row.tokensByColumn.cess_amount)) ||
                   parseNumber(extractTextFromTokens(row.tokensByColumn.cess)),
      total: parseNumber(extractTextFromTokens(row.tokensByColumn.total)) ||
             parseNumber(extractTextFromTokens(row.tokensByColumn.amount)),
    };

    // Only add if there's meaningful content
    if (item.description || item.quantity !== null || item.rate !== null || item.total !== null) {
      items.push(item);
    }
  }

  return items;
}

/**
 * Extract combined text from multiple tokens
 */
function extractTextFromTokens(tokens?: TextToken[]): string | null {
  if (!tokens || tokens.length === 0) return null;
  const text = tokens.map(t => t.text).join(' ').trim();
  return text || null;
}

/**
 * Extract totals from footer rows
 */
export interface ExtractedTotals {
  subtotal: number | null;
  taxable_value: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  cess: number | null;
  round_off: number | null;
  grand_total: number | null;
}

export function extractTotalsFromRows(rows: TableRow[]): ExtractedTotals {
  const totals: ExtractedTotals = {
    subtotal: null,
    taxable_value: null,
    cgst: null,
    sgst: null,
    igst: null,
    cess: null,
    round_off: null,
    grand_total: null,
  };

  for (const row of rows) {
    if (!row.isTotalRow) continue;

    const lineText = row.line.text.toLowerCase();

    // Map row values to total fields based on keywords
    if (lineText.includes('subtotal') || lineText.includes('taxable')) {
      totals.subtotal = parseNumber(extractTextFromTokens(row.tokensByColumn.amount)) ||
                        parseNumber(extractTextFromTokens(row.tokensByColumn.total)) ||
                        totals.subtotal;
      totals.taxable_value = totals.subtotal;
    }

    if (lineText.includes('cgst')) {
      totals.cgst = parseNumber(extractTextFromTokens(row.tokensByColumn.cgst_amount)) ||
                    parseNumber(extractTextFromTokens(row.tokensByColumn.amount));
    }

    if (lineText.includes('sgst')) {
      totals.sgst = parseNumber(extractTextFromTokens(row.tokensByColumn.sgst_amount)) ||
                    parseNumber(extractTextFromTokens(row.tokensByColumn.amount));
    }

    if (lineText.includes('igst')) {
      totals.igst = parseNumber(extractTextFromTokens(row.tokensByColumn.igst_amount)) ||
                    parseNumber(extractTextFromTokens(row.tokensByColumn.amount));
    }

    if (lineText.includes('cess')) {
      totals.cess = parseNumber(extractTextFromTokens(row.tokensByColumn.cess_amount)) ||
                    parseNumber(extractTextFromTokens(row.tokensByColumn.amount));
    }

    if (lineText.includes('round')) {
      totals.round_off = parseNumber(extractTextFromTokens(row.tokensByColumn.amount));
    }

    if (lineText.includes('grand') || lineText.includes('total') || lineText.includes('balance')) {
      const amount = parseNumber(extractTextFromTokens(row.tokensByColumn.amount)) ||
                     parseNumber(extractTextFromTokens(row.tokensByColumn.total));
      if (amount !== null) {
        totals.grand_total = amount;
      }
    }
  }

  return totals;
}
