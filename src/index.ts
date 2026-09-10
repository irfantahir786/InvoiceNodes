import express, { Application, Request, Response } from 'express';
import { invoiceRoutes } from './modules/invoice/invoice.routes';

const app: Application = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/invoice', invoiceRoutes);

// Root endpoint with API info
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'Invoice Extraction API',
    version: '1.0.0',
    endpoints: {
      'POST /api/invoice/extract-text': 'Extract text from system-generated PDFs',
      'POST /api/invoice/extract-ocr': 'Extract text from scanned/image invoices using OCR',
      'GET /health': 'Health check endpoint',
    },
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint ${req.method} ${req.path} not found`,
    },
  });
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Invoice Extraction API server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`API endpoints:`);
    console.log(`  POST /api/invoice/extract-text`);
    console.log(`  POST /api/invoice/extract-ocr`);
  });
}

export default app;
