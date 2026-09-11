import { TextToken, InvoiceExtractionResult, PartyInfo, InvoiceMetadata, InvoiceTotals, ExtractedItem, ConfidenceScores } from '../types/invoice.types';
import { groupTokensIntoLines, detectTableRegions, LineToken } from './table.detector';
import { parseTableRows, mergeMultiLineRows, convertRowsToItems, extractTotalsFromRows } from './row.grouping';
import { 
  normalizeText, 
  parseDate, 
  parseNumber, 
  extractGSTIN, 
  validateGSTIN, 
  validatePAN,
  extractPANFromGSTIN,
  getStateCodeFromGSTIN,
  getStateFromCode
} from './normalizer';

/**
 * Main invoice parser that processes tokens and extracts structured data.
 * This is the common parser used by both text extraction and OCR pipelines.
 */
export class InvoiceParser {
  private tokens: TextToken[];
  private lines: LineToken[];
  private warnings: string[] = [];

  constructor(tokens: TextToken[]) {
    this.tokens = tokens;
    this.lines = groupTokensIntoLines(tokens);
  }

  /**
   * Parse the invoice and return structured data
   */
  async parse(source: 'text' | 'ocr'): Promise<InvoiceExtractionResult> {
    // Detect table regions
    const tableRegions = detectTableRegions(this.lines);
    
    // Extract items from tables
    let items: ExtractedItem[] = [];
    let tableConfidence = 0;

    if (tableRegions.length > 0) {
      const allRows = [];
      
      for (const region of tableRegions) {
        const rows = parseTableRows(this.lines, region.headerLine, region.columns);
        const mergedRows = mergeMultiLineRows(rows);
        allRows.push(...mergedRows);
      }

      items = convertRowsToItems(allRows);
      
      // Calculate table confidence based on header detection and column mapping
      tableConfidence = this.calculateTableConfidence(tableRegions, items);
    } else {
      this.warnings.push('No table structure detected in the invoice');
    }

    // Extract totals from table rows
    const extractedTotals = extractTotalsFromRows(
      tableRegions.length > 0 
        ? parseTableRows(this.lines, tableRegions[0].headerLine, tableRegions[0].columns)
        : []
    );

    // Extract seller and buyer information
    const seller = this.extractSeller();
    const buyer = this.extractBuyer();

    // Extract invoice metadata
    const invoice = this.extractInvoiceMetadata();

    // Calculate confidence scores
    const confidence = this.calculateConfidence(
      seller,
      buyer,
      invoice,
      items,
      extractedTotals,
      tableConfidence
    );

    // Build page count
    const pageCount = Math.max(...this.tokens.map(t => t.page), 1);

    return {
      success: true,
      document: {
        type: 'invoice',
        source,
        page_count: pageCount,
      },
      seller,
      buyer,
      invoice,
      items,
      totals: {
        subtotal: extractedTotals.subtotal,
        discount: null,
        taxable_value: extractedTotals.taxable_value,
        cgst: extractedTotals.cgst,
        sgst: extractedTotals.sgst,
        igst: extractedTotals.igst,
        cess: extractedTotals.cess,
        round_off: extractedTotals.round_off,
        grand_total: extractedTotals.grand_total,
        amount_paid: null,
        balance_due: null,
      },
      confidence,
      warnings: [...this.warnings],
    };
  }

  /**
   * Calculate confidence score for table extraction
   */
  private calculateTableConfidence(regions: any[], items: ExtractedItem[]): number {
    let confidence = 0.5; // Base confidence

    if (regions.length > 0) {
      confidence += 0.2; // Found at least one table
    }

    if (items.length > 0) {
      confidence += 0.1; // Found items
    }

    // Check if items have meaningful data
    const itemsWithDescription = items.filter(i => i.description !== null).length;
    const itemsWithAmount = items.filter(i => i.total !== null || i.taxable_value !== null).length;

    if (itemsWithDescription > 0 && itemsWithDescription / items.length > 0.8) {
      confidence += 0.1;
    }

    if (itemsWithAmount > 0 && itemsWithAmount / items.length > 0.5) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Extract seller information from the document
   */
  private extractSeller(): PartyInfo {
    const seller: PartyInfo = {
      name: null,
      gstin: null,
      pan: null,
      address: null,
      phone: null,
      email: null,
      state: null,
      state_code: null,
    };

    // Look for GSTIN patterns - typically near the top of the invoice
    const gstinCandidates = this.findGSTINs();
    
    if (gstinCandidates.length > 0) {
      // First GSTIN is usually the seller's
      seller.gstin = gstinCandidates[0];
      seller.state_code = getStateCodeFromGSTIN(seller.gstin);
      seller.state = getStateFromCode(seller.state_code);
      seller.pan = extractPANFromGSTIN(seller.gstin);
    }

    // Look for seller indicators
    const sellerKeywords = ['seller', 'supplier', 'billed by', 'sold by', 'from', 'vendor'];
    const sellerLines = this.lines.slice(0, Math.min(20, this.lines.length)); // Top portion
    
    for (const line of sellerLines) {
      const lineText = line.text.toLowerCase();
      
      // Check for seller keywords
      if (sellerKeywords.some(kw => lineText.includes(kw))) {
        // Next few lines might contain seller info
        const index = this.lines.indexOf(line);
        for (let i = index + 1; i < Math.min(index + 5, this.lines.length); i++) {
          const infoLine = this.lines[i];
          if (!seller.name && infoLine.tokens.length > 1) {
            seller.name = infoLine.text.trim().substring(0, 100);
          }
        }
        break;
      }
    }

    // If no explicit seller found, use company name near GSTIN
    if (!seller.name && seller.gstin) {
      seller.name = this.findCompanyNearGSTIN(seller.gstin);
    }

    // Look for contact info near seller section
    const contactInfo = this.extractContactInfo(sellerLines);
    seller.phone = contactInfo.phone;
    seller.email = contactInfo.email;

    return seller;
  }

  /**
   * Extract buyer information from the document
   */
  private extractBuyer(): PartyInfo {
    const buyer: PartyInfo = {
      name: null,
      gstin: null,
      pan: null,
      address: null,
      phone: null,
      email: null,
      state: null,
      state_code: null,
    };

    // Look for buyer indicators
    const buyerKeywords = [
      'buyer', 'bill to', 'billed to', 'customer', 'consignee', 
      'ship to', 'sold to', 'party', 'recipient'
    ];

    for (const line of this.lines) {
      const lineText = line.text.toLowerCase();
      
      if (buyerKeywords.some(kw => lineText.includes(kw))) {
        const index = this.lines.indexOf(line);
        
        // Extract buyer info from following lines
        for (let i = index + 1; i < Math.min(index + 8, this.lines.length); i++) {
          const infoLine = this.lines[i];
          const infoText = infoLine.text.trim();
          
          // Check for GSTIN
          const gstin = extractGSTIN(infoText);
          if (gstin && !buyer.gstin) {
            buyer.gstin = gstin;
            buyer.state_code = getStateCodeFromGSTIN(buyer.gstin);
            buyer.state = getStateFromCode(buyer.state_code);
            buyer.pan = extractPANFromGSTIN(buyer.gstin);
            continue;
          }

          // First non-empty line after keyword is likely the name
          if (!buyer.name && infoText.length > 3 && infoText.length < 100) {
            // Skip if it looks like an address line with numbers
            if (!/^\d/.test(infoText)) {
              buyer.name = infoText.substring(0, 100);
            }
          }
        }
        break;
      }
    }

    // If second GSTIN found, it's likely the buyer's
    const gstinCandidates = this.findGSTINs();
    if (gstinCandidates.length > 1 && !buyer.gstin) {
      buyer.gstin = gstinCandidates[1];
      buyer.state_code = getStateCodeFromGSTIN(buyer.gstin);
      buyer.state = getStateFromCode(buyer.state_code);
      buyer.pan = extractPANFromGSTIN(buyer.gstin);
    }

    return buyer;
  }

  /**
   * Extract invoice metadata (number, date, etc.)
   */
  private extractInvoiceMetadata(): InvoiceMetadata {
    const metadata: InvoiceMetadata = {
      invoice_number: null,
      invoice_date: null,
      due_date: null,
      place_of_supply: null,
      reverse_charge: null,
      payment_terms: null,
      po_number: null,
      eway_bill_number: null,
      irn: null,
      acknowledgement_number: null,
      acknowledgement_date: null,
    };

    const invoiceKeywords = [
      { key: 'invoice_number', patterns: ['invoice no', 'invoice number', 'inv no', 'bill no', 'tax invoice'] },
      { key: 'invoice_date', patterns: ['invoice date', 'date', 'dated'] },
      { key: 'due_date', patterns: ['due date', 'payment due', 'pay by'] },
      { key: 'po_number', patterns: ['po no', 'purchase order', 'po number', 'order no'] },
      { key: 'eway_bill_number', patterns: ['eway bill', 'eway bill no', 'e-way bill'] },
      { key: 'irn', patterns: ['irn', 'irn no', 'reference no', 'acknowledgement no'] },
    ];

    for (const line of this.lines) {
      const lineText = line.text.toLowerCase();

      for (const { key, patterns } of invoiceKeywords) {
        for (const pattern of patterns) {
          if (lineText.includes(pattern)) {
            // Extract value after the pattern
            const patternIndex = lineText.indexOf(pattern);
            const afterPattern = lineText.substring(patternIndex + pattern.length).trim();
            
            // Try to extract alphanumeric value
            const valueMatch = afterPattern.match(/[:\s]*([A-Z0-9\-\/]+)/i);
            if (valueMatch) {
              const value = valueMatch[1].trim();
              
              if (key === 'invoice_number' && !metadata.invoice_number) {
                metadata.invoice_number = value.substring(0, 50);
              } else if (key === 'invoice_date' && !metadata.invoice_date) {
                metadata.invoice_date = parseDate(value) || parseDate(afterPattern);
              } else if (key === 'due_date' && !metadata.due_date) {
                metadata.due_date = parseDate(value) || parseDate(afterPattern);
              } else if (key === 'po_number' && !metadata.po_number) {
                metadata.po_number = value.substring(0, 50);
              } else if (key === 'eway_bill_number' && !metadata.eway_bill_number) {
                metadata.eway_bill_number = value.substring(0, 50);
              } else if (key === 'irn' && !metadata.irn) {
                metadata.irn = value.substring(0, 64);
              }
            }
            break;
          }
        }
      }

      // Check for reverse charge
      if (lineText.includes('reverse charge') && (lineText.includes('yes') || lineText.includes('applicable'))) {
        metadata.reverse_charge = true;
      }
    }

    return metadata;
  }

  /**
   * Find all GSTINs in the document
   */
  private findGSTINs(): string[] {
    const gstins: Set<string> = new Set();

    for (const token of this.tokens) {
      const gstin = extractGSTIN(token.text);
      if (gstin) {
        gstins.add(gstin);
      }
    }

    // Also search in combined line text
    for (const line of this.lines) {
      const gstin = extractGSTIN(line.text);
      if (gstin) {
        gstins.add(gstin);
      }
    }

    return Array.from(gstins);
  }

  /**
   * Find company name near a GSTIN
   */
  private findCompanyNearGSTIN(gstin: string): string | null {
    // Find the line containing the GSTIN
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (line.text.includes(gstin)) {
        // Look at previous lines for company name
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          const prevLine = this.lines[j];
          const text = prevLine.text.trim();
          
          // Skip empty lines or lines that look like addresses
          if (text.length > 3 && text.length < 100 && !/^\d/.test(text)) {
            return text.substring(0, 100);
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract contact information (phone, email) from lines
   */
  private extractContactInfo(lines: LineToken[]): { phone: string | null; email: string | null } {
    let phone: string | null = null;
    let email: string | null = null;

    for (const line of lines) {
      const text = line.text;

      // Email pattern
      if (!email) {
        const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) {
          email = emailMatch[0];
        }
      }

      // Phone pattern (Indian formats)
      if (!phone) {
        const phoneMatch = text.match(/(\+91[- ]?)?[6-9]\d{9}|\d{5}[- ]?\d{5}/);
        if (phoneMatch) {
          phone = phoneMatch[0];
        }
      }
    }

    return { phone, email };
  }

  /**
   * Calculate overall confidence scores
   */
  private calculateConfidence(
    seller: PartyInfo,
    buyer: PartyInfo,
    invoice: InvoiceMetadata,
    items: ExtractedItem[],
    totals: any,
    tableConfidence: number
  ): ConfidenceScores {
    // Seller confidence
    let sellerScore = 0;
    if (seller.name) sellerScore += 0.3;
    if (seller.gstin && validateGSTIN(seller.gstin)) sellerScore += 0.4;
    if (seller.address || seller.phone || seller.email) sellerScore += 0.3;

    // Buyer confidence
    let buyerScore = 0;
    if (buyer.name) buyerScore += 0.4;
    if (buyer.gstin && validateGSTIN(buyer.gstin)) buyerScore += 0.4;
    if (buyer.address || buyer.phone || buyer.email) buyerScore += 0.2;

    // Invoice metadata confidence
    let invoiceScore = 0;
    if (invoice.invoice_number) invoiceScore += 0.3;
    if (invoice.invoice_date) invoiceScore += 0.3;
    if (invoice.eway_bill_number || invoice.irn) invoiceScore += 0.2;
    if (invoice.place_of_supply) invoiceScore += 0.2;

    // Items confidence
    const itemsScore = tableConfidence;

    // Totals confidence
    let totalsScore = 0;
    if (totals.grand_total !== null) totalsScore += 0.4;
    if (totals.taxable_value !== null) totalsScore += 0.2;
    if (totals.cgst !== null || totals.sgst !== null || totals.igst !== null) totalsScore += 0.4;

    const overall = (sellerScore + buyerScore + invoiceScore + itemsScore + totalsScore) / 5;

    return {
      overall: Math.round(overall * 100) / 100,
      seller: Math.round(sellerScore * 100) / 100,
      buyer: Math.round(buyerScore * 100) / 100,
      invoice: Math.round(invoiceScore * 100) / 100,
      items: Math.round(itemsScore * 100) / 100,
      totals: Math.round(totalsScore * 100) / 100,
    };
  }
}
