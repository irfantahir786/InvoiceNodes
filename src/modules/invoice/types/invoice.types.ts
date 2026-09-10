/**
 * Invoice extraction result types
 */

export interface TextToken {
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedItem {
  description: string | null;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  sac: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  discount: number | null;
  taxable_value: number | null;
  gst_rate: number | null;
  cgst_rate: number | null;
  cgst_amount: number | null;
  sgst_rate: number | null;
  sgst_amount: number | null;
  igst_rate: number | null;
  igst_amount: number | null;
  cess_rate: number | null;
  cess_amount: number | null;
  total: number | null;
}

export interface PartyInfo {
  name: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  state: string | null;
  state_code: string | null;
}

export interface InvoiceMetadata {
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  place_of_supply: string | null;
  reverse_charge: boolean | null;
  payment_terms: string | null;
  po_number: string | null;
  eway_bill_number: string | null;
  irn: string | null;
  acknowledgement_number: string | null;
  acknowledgement_date: string | null;
}

export interface InvoiceTotals {
  subtotal: number | null;
  discount: number | null;
  taxable_value: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  cess: number | null;
  round_off: number | null;
  grand_total: number | null;
  amount_paid: number | null;
  balance_due: number | null;
}

export interface ConfidenceScores {
  overall: number;
  seller: number;
  buyer: number;
  invoice: number;
  items: number;
  totals: number;
}

export interface InvoiceExtractionResult {
  success: boolean;
  document: {
    type: 'invoice';
    source: 'text' | 'ocr';
    page_count: number;
  };
  seller: PartyInfo;
  buyer: PartyInfo;
  invoice: InvoiceMetadata;
  items: ExtractedItem[];
  totals: InvoiceTotals;
  confidence: ConfidenceScores;
  warnings: string[];
}

export interface ExtractionWarning {
  code: string;
  message: string;
}
