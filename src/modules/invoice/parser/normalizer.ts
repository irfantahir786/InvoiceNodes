/**
 * Normalization utilities for Indian invoice data
 */

/**
 * Normalize text for comparison - lowercase, remove special chars, trim
 */
export function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Check if a normalized token matches any of the expected variations
 */
export function matchesToken(token: string, variations: string[]): boolean {
  const normalized = normalizeText(token);
  return variations.some(v => normalizeText(v) === normalized || normalized.includes(normalizeText(v)));
}

/**
 * Column header vocabulary for semantic matching
 */
export const COLUMN_VOCABULARY: Record<string, string[]> = {
  description: [
    'description', 'item', 'item description', 'product', 'product description',
    'particulars', 'goods description', 'details', 'material', 'name',
    'goods', 'services', 'particular', 'article'
  ],
  quantity: [
    'qty', 'quantity', 'qnty', 'units', 'nos', 'number', 'pcs', 'pieces',
    'count', 'no', 'qty.', 'quant'
  ],
  rate: [
    'rate', 'price', 'unit price', 'unit rate', 'selling price', 'basic rate',
    'mrp', 'rate.', 'unit'
  ],
  hsn: [
    'hsn', 'hsn code', 'hsn/sac', 'hsn sac', 'hsn/sac code', 'sac', 'sac code',
    'itc', 'classification'
  ],
  amount: [
    'amount', 'value', 'total', 'line total', 'net amount', 'taxable value',
    'net', 'sum', 'gross', 'amt', 'amount.'
  ],
  gst: [
    'gst', 'gst %', 'gst rate', 'tax', 'tax %', 'tax rate', 'gst%', 'tax%'
  ],
  cgst: [
    'cgst', 'cgst %', 'cgst amount', 'cgst%', 'central tax'
  ],
  sgst: [
    'sgst', 'sgst %', 'sgst amount', 'sgst%', 'state tax'
  ],
  igst: [
    'igst', 'igst %', 'igst amount', 'igst%', 'integrated tax'
  ],
  discount: [
    'discount', 'disc', 'less', 'discount %', 'off', 'rebate'
  ],
  cess: [
    'cess', 'cess %', 'cess amount', 'compensation cess'
  ],
  unit: [
    'unit', 'uom', 'measure', 'unit of measure', 'unit of measurement'
  ],
  sku: [
    'sku', 'sku code', 'item code', 'product code', 'code', 'art no', 'article no'
  ]
};

/**
 * Get column type from header text
 */
export function getColumnType(headerText: string): string | null {
  const normalized = normalizeText(headerText);
  
  for (const [columnType, variations] of Object.entries(COLUMN_VOCABULARY)) {
    if (matchesToken(normalized, variations)) {
      return columnType;
    }
  }
  
  return null;
}

/**
 * Parse Indian date formats to YYYY-MM-DD
 */
export function parseDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  
  const trimmed = dateStr.trim();
  
  // Try various date patterns
  const patterns: Array<{ regex: RegExp; format: string }> = [
    { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, format: 'YYYY-MM-DD' },
    { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, format: 'DD/MM/YYYY' },
    { regex: /^(\d{1,2})-(\d{1,2})\/?(\d{4})$/, format: 'DD-MM-YYYY' },
    { regex: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, format: 'DD.MM.YYYY' },
    { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, format: 'DD/MM/YY' },
    { regex: /^(\d{1,2})-(\d{1,2})\/?(\d{2})$/, format: 'DD-MM-YY' },
  ];
  
  for (const pattern of patterns) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      let year: number, month: number, day: number;
      
      if (pattern.format === 'YYYY-MM-DD') {
        year = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        day = parseInt(match[3], 10);
      } else if (pattern.format.endsWith('YY')) {
        day = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        year = parseInt(match[3], 10);
        // Handle 2-digit years
        if (year < 50) year += 2000;
        else year += 1900;
      } else {
        day = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        year = parseInt(match[3], 10);
      }
      
      // Validate date components
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
        const paddedMonth = month.toString().padStart(2, '0');
        const paddedDay = day.toString().padStart(2, '0');
        return `${year}-${paddedMonth}-${paddedDay}`;
      }
    }
  }
  
  return null;
}

/**
 * Parse Indian number formats to numeric values
 * Handles: 1,200 | 1,200.50 | 1200.50 | ₹1,200 | Rs. 1,200 | 1 200
 */
export function parseNumber(value: string | null): number | null {
  if (!value) return null;
  
  let cleaned = value.trim();
  
  // Remove currency symbols and prefixes
  cleaned = cleaned.replace(/^[₹$€£]|Rs\.?\s*|INR\s*/gi, '');
  
  // Remove thousand separators (commas or spaces)
  cleaned = cleaned.replace(/,/g, '').replace(/\s/g, '');
  
  // Handle parentheses for negative numbers
  const isNegative = /^\(.*\)$/.test(cleaned);
  if (isNegative) {
    cleaned = cleaned.replace(/[()]/g, '');
  }
  
  // Parse the number
  const num = parseFloat(cleaned);
  
  if (isNaN(num)) return null;
  
  return isNegative ? -num : num;
}

/**
 * Validate Indian GSTIN format
 * Format: 2 digits state code + 10 char PAN + 1 digit entity + 1 Z + 1 check digit
 */
export function validateGSTIN(gstin: string | null): boolean {
  if (!gstin) return false;
  
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstinRegex.test(gstin.trim().toUpperCase());
}

/**
 * Extract GSTIN from text content
 */
export function extractGSTIN(text: string): string | null {
  const gstinRegex = /([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i;
  const match = text.match(gstinRegex);
  if (match && validateGSTIN(match[1])) {
    return match[1].toUpperCase();
  }
  return null;
}

/**
 * Validate Indian PAN format
 * Format: 5 letters + 4 digits + 1 letter
 */
export function validatePAN(pan: string | null): boolean {
  if (!pan) return false;
  
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  return panRegex.test(pan.trim().toUpperCase());
}

/**
 * Extract PAN from text (often embedded in GSTIN)
 */
export function extractPANFromGSTIN(gstin: string | null): string | null {
  if (!gstin || gstin.length !== 15) return null;
  return gstin.substring(2, 12).toUpperCase();
}

/**
 * Map Indian state codes to state names
 */
export const STATE_CODE_MAP: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu / Dadra and Nagar Haveli',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh (New)',
  '38': 'Ladakh'
};

/**
 * Get state name from state code
 */
export function getStateFromCode(code: string | null): string | null {
  if (!code) return null;
  const normalizedCode = code.padStart(2, '0');
  return STATE_CODE_MAP[normalizedCode] || null;
}

/**
 * Extract state code from GSTIN (first 2 digits)
 */
export function getStateCodeFromGSTIN(gstin: string | null): string | null {
  if (!gstin || gstin.length < 2) return null;
  return gstin.substring(0, 2);
}
