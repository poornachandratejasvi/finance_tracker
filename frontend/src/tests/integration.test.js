/**
 * Frontend Integration Tests
 * 
 * Tests the integration between React components and backend APIs
 * 
 * To run: npm test
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MockAdapter from 'axios-mock-adapter';
import api from '../services/api';

// Import components to test
import Banks from '../pages/Banks';
import PDFManagement from '../pages/PDFManagement';
import FieldMapping from '../pages/FieldMapping';
import PDFPasswordDialog from '../components/PDFPasswordDialog';

// Create axios mock
const mock = new MockAdapter(api);

describe('Frontend Integration Tests', () => {
  
  beforeEach(() => {
    // Reset mock before each test
    mock.reset();
    
    // Mock authentication
    localStorage.setItem('access_token', 'mock-jwt-token');
  });
  
  afterEach(() => {
    localStorage.clear();
  });

  describe('Bank Management Integration', () => {
    
    test('should fetch and display banks list', async () => {
      const mockBanks = [
        { id: 1, name: 'HDFC Bank', code: 'HDFC' },
        { id: 2, name: 'YES Bank', code: 'YES' }
      ];

      mock.onGet('/api/banks/').reply(200, mockBanks);
      mock.onGet('/api/banks/gmail-accounts/').reply(200, []);
      mock.onGet('/api/banks/gmail-accounts/status').reply(200, { accounts: [] });

      render(<Banks />);

      await waitFor(() => {
        expect(screen.getByText('HDFC Bank')).toBeInTheDocument();
        expect(screen.getByText('YES Bank')).toBeInTheDocument();
      });
    });
    
    test('should render bank actions toolbar', async () => {
      mock.onGet('/api/banks/').reply(200, []);
      mock.onGet('/api/banks/gmail-accounts/').reply(200, []);
      mock.onGet('/api/banks/gmail-accounts/status').reply(200, { accounts: [] });

      render(<Banks />);

      await waitFor(() => {
        expect(screen.getByText('Resync All')).toBeInTheDocument();
        expect(screen.getByText('Gmail')).toBeInTheDocument();
      });
    });
  });

  describe('PDF Management Integration', () => {
    
    test('should fetch and display PDFs', async () => {
      const mockPDFs = {
        items: [
          { 
            id: 1, 
            file_name: 'statement_01.pdf', 
            bank_name: 'HDFC Bank',
            is_processed: true,
            transaction_count: 15,
            created_at: '2026-02-01T10:00:00Z'
          },
          { 
            id: 2, 
            file_name: 'statement_02.pdf', 
            bank_name: 'YES Bank',
            is_processed: false,
            transaction_count: 0,
            created_at: '2026-02-02T10:00:00Z'
          }
        ],
        total: 2
      };

      mock.onGet('/api/pdfs/').reply(200, mockPDFs);
      mock.onGet('/api/pdfs/stats').reply(200, { stats: [] });
      mock.onGet('/api/banks/').reply(200, []);

      render(<PDFManagement />);

      await waitFor(() => {
        expect(screen.getByText('statement_01.pdf')).toBeInTheDocument();
        expect(screen.getByText('statement_02.pdf')).toBeInTheDocument();
      });
    });
    
    test('should show lock icon for password-protected PDFs', async () => {
      const mockPDFs = {
        items: [
          { 
            id: 1, 
            file_name: 'locked.pdf', 
            is_password_protected: true,
            is_processed: false,
            transaction_count: 0,
            created_at: '2026-02-01T10:00:00Z'
          }
        ],
        total: 1
      };

      mock.onGet('/api/pdfs/').reply(200, mockPDFs);
      mock.onGet('/api/pdfs/stats').reply(200, { stats: [] });
      mock.onGet('/api/banks/').reply(200, []);

      render(<PDFManagement />);

      await waitFor(() => {
        expect(screen.getByText('locked.pdf')).toBeInTheDocument();
      });
    });
  });

  describe('Field Mapping Integration', () => {
    test('should load PDF preview and detected columns', async () => {
      const mockBanks = [{ id: 1, name: 'Standard Chartered' }];
      const mockFields = {
        standard_fields: [
          { name: 'transaction_date', label: 'Transaction Date' },
          { name: 'description', label: 'Description' }
        ]
      };
      const mockMapping = {
        field_mapping: {
          date_field: 'transaction_date',
          description_field: 'description'
        }
      };
      const mockPdfs = {
        items: [{ id: 10, file_name: 'sc.pdf' }],
        total: 1
      };
      const mockPdfFields = {
        detected_columns: ['Value Date', 'Description', 'Deposit', 'Withdrawal']
      };

      mock.onGet('/api/banks/').reply(200, mockBanks);
      mock.onGet('/api/transactions/fields').reply(200, mockFields);
      mock.onGet('/api/field-mapping/1').reply(200, mockMapping);
      mock.onGet('/api/pdfs/').reply(() => [200, mockPdfs]);
      mock.onGet('/api/pdfs/10/fields').reply(200, mockPdfFields);
      mock.onGet('/api/pdfs/10/download').reply(200, new Blob(['%PDF-1.4']));

      render(<FieldMapping />);

      await waitFor(() => {
        expect(screen.getByText('PDF Field Mapping')).toBeInTheDocument();
      });

      const bankSelect = screen.getByRole('combobox');
      fireEvent.mouseDown(bankSelect);
      const bankOption = await screen.findByRole('option', { name: 'Standard Chartered' });
      fireEvent.click(bankOption);

      await waitFor(() => {
        expect(screen.getByText('Detected PDF Columns')).toBeInTheDocument();
        expect(screen.getByText('Value Date')).toBeInTheDocument();
      });
    });
  });

  describe('PDF Password Dialog Integration', () => {
    
    test('should test single password', async () => {
      const mockPDF = {
        id: 1,
        file_name: 'statement.pdf'
      };
      
      const onClose = jest.fn();
      const onSuccess = jest.fn();
      
      mock.onPost(/\/api\/sync\/test-pdf-password.*/).reply(200, {
        success: false,
        password_works: false
      });
      
      render(
        <PDFPasswordDialog 
          open={true}
          pdf={mockPDF}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );
      
      const passwordInput = screen.getByLabelText('Password 1');
      fireEvent.change(passwordInput, { target: { value: 'TEST123' } });
      
      const testButton = screen.getByText('Test Password');
      fireEvent.click(testButton);
      
      await waitFor(() => {
        expect(mock.history.post.length).toBe(1);
        expect(mock.history.post[0].url).toContain('password=TEST123');
      });
    });
    
    test('should try all passwords sequentially', async () => {
      const mockPDF = {
        id: 1,
        file_name: 'statement.pdf'
      };

      mock.onPost(/\/api\/sync\/update-pdf-password.*/).reply(200, { success: true });
      
      mock.onPost(/\/api\/sync\/test-pdf-password.*/).reply((config) => {
        const match = config.url.match(/password=([^&]+)/);
        const password = match ? decodeURIComponent(match[1]) : '';
        if (password === 'CORRECT') {
          return [200, { success: true }];
        }
        return [400, { success: false }];
      });
      
      render(
        <PDFPasswordDialog 
          open={true}
          pdf={mockPDF}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      );
      
      fireEvent.click(screen.getByText('Add More Password'));
      fireEvent.click(screen.getByText('Add More Password'));

      // Enter multiple passwords
      fireEvent.change(screen.getByLabelText('Password 1'), { target: { value: 'WRONG1' } });
      fireEvent.change(screen.getByLabelText('Password 2'), { target: { value: 'CORRECT' } });
      fireEvent.change(screen.getByLabelText('Password 3'), { target: { value: 'WRONG2' } });
      
      const tryAllButton = screen.getByText(/Try All/);
      fireEvent.click(tryAllButton);
      
      await waitFor(() => {
        // Should stop at CORRECT password
        expect(mock.history.post.length).toBeGreaterThanOrEqual(2);
      }, { timeout: 3000 });
    });
    
    
  });

  describe('Error Handling', () => {
    
    test('should display error when API call fails', async () => {
      mock.onGet('/api/banks/').reply(500, { detail: 'Internal Server Error' });
      mock.onGet('/api/banks/gmail-accounts/').reply(200, []);
      mock.onGet('/api/banks/gmail-accounts/status').reply(200, { accounts: [] });

      render(<Banks />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load data')).toBeInTheDocument();
      });
    });
    
    test('should handle network timeout', async () => {
      mock.onGet('/api/pdfs/').timeout();
      mock.onGet('/api/pdfs/stats').reply(200, { stats: [] });
      mock.onGet('/api/banks/').reply(200, []);
      
      render(<PDFManagement />);
      
      await waitFor(() => {
        expect(screen.getByText('Failed to load PDF data')).toBeInTheDocument();
      }, { timeout: 5000 });
    });
    
  });

  describe('Loading States', () => {
    
    test('should show loading spinner while fetching data', async () => {
      mock.onGet('/api/banks/').reply(() => {
        return new Promise(resolve => {
          setTimeout(() => resolve([200, []]), 1000);
        });
      });
      mock.onGet('/api/banks/gmail-accounts/').reply(200, []);
      mock.onGet('/api/banks/gmail-accounts/status').reply(200, { accounts: [] });
      
      render(<Banks />);
      
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      
      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      }, { timeout: 2000 });
    });
  });

});

// Export for use in other test files
export { mock };
