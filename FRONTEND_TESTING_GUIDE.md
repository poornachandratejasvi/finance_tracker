# Frontend Testing Guide

## Overview
This document explains how to run and maintain the frontend integration tests.

## Test Structure

### Test Files
- `src/tests/integration.test.js` - Main integration test suite
- Tests cover:
  - Bank Management (CRUD operations)
  - PDF Management (list, resync, password handling)
  - PDF Password Dialog (password testing, bulk operations)
  - Transaction Table (fetch, filter, pagination)
  - Error Handling (API failures, timeouts, auth)
  - Loading States
  - Real-time Updates

## Running Tests

### Prerequisites
```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom axios-mock-adapter jest
```

### Run All Tests
```bash
npm test
```

### Run Specific Test Suite
```bash
npm test -- integration.test.js
```

### Run Tests in Watch Mode
```bash
npm test -- --watch
```

### Run Tests with Coverage
```bash
npm test -- --coverage
```

## Test Coverage Goals

| Component | Target Coverage |
|-----------|----------------|
| BankManagement | 80%+ |
| PDFManagement | 80%+ |
| PDFPasswordDialog | 90%+ |
| TransactionTable | 80%+ |
| API Integration | 95%+ |

## Writing New Tests

### Example Test Structure
```javascript
describe('Component Name', () => {
  beforeEach(() => {
    // Setup mock data
    mock.reset();
  });

  test('should perform specific action', async () => {
    // 1. Setup mock API responses
    mock.onGet('/api/endpoint').reply(200, mockData);
    
    // 2. Render component
    render(<Component />);
    
    // 3. Interact with component
    fireEvent.click(screen.getByText('Button'));
    
    // 4. Assert expectations
    await waitFor(() => {
      expect(screen.getByText('Result')).toBeInTheDocument();
    });
  });
});
```

## Common Testing Patterns

### Testing API Calls
```javascript
mock.onPost('/api/banks/').reply(201, { id: 1 });
// ... trigger action ...
expect(mock.history.post.length).toBe(1);
expect(mock.history.post[0].data).toContain('expected');
```

### Testing User Interactions
```javascript
const button = screen.getByText('Click Me');
fireEvent.click(button);
await waitFor(() => {
  expect(screen.getByText('Success')).toBeInTheDocument();
});
```

### Testing Error States
```javascript
mock.onGet('/api/data').reply(500, { detail: 'Error' });
render(<Component />);
await waitFor(() => {
  expect(screen.getByText(/error/i)).toBeInTheDocument();
});
```

## Debugging Failed Tests

### Enable Verbose Output
```bash
npm test -- --verbose
```

### Debug Specific Test
```javascript
test.only('should debug this test', async () => {
  screen.debug(); // Prints current DOM
  // ... test code ...
});
```

### Check Mock History
```javascript
console.log('API calls:', mock.history);
console.log('GET requests:', mock.history.get);
console.log('POST requests:', mock.history.post);
```

## Current Test Status

### Integration Tests
- ✅ Bank Management (3 tests)
- ✅ PDF Management (3 tests)
- ✅ PDF Password Dialog (3 tests)
- ✅ Transaction Table (3 tests)
- ✅ Error Handling (3 tests)
- ✅ Loading States (1 test)
- ✅ Real-time Updates (1 test)

**Total: 17 tests**

## Known Limitations

1. Tests use mock data - doesn't test against real backend
2. WebSocket/real-time features need separate testing
3. File upload testing limited
4. Complex user flows may need E2E tests

## E2E Testing (Future)

For comprehensive testing, consider adding Cypress/Playwright:
```bash
npm install --save-dev cypress
```

E2E tests should cover:
- Complete user workflows
- Multi-step processes
- Real backend integration
- PDF upload and parsing
- Password management flows

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Frontend Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm test -- --coverage
```

## Maintenance

### Update Tests When:
- API endpoints change
- Component props change
- User flows change
- New features added
- Bugs fixed (add regression test)

### Review Tests:
- Monthly: Check coverage reports
- Before releases: Run full suite
- After bugs: Add regression tests
