import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ActivityProvider } from './contexts/ActivityContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

// Import components
import Login from './pages/Login';
import ModernDashboard from './pages/ModernDashboard.jsx';
import Dashboard from './pages/Dashboard.js';
import Transactions from './pages/Transactions';
import Banks from './pages/Banks';
import Settings from './pages/Settings';
import PDFManagement from './pages/PDFManagement';
import FieldMapping from './pages/FieldMapping.jsx';
import CsvExports from './pages/CsvExports.jsx';
import Automation from './pages/Automation.jsx';
import BankStatements from './pages/BankStatements.jsx';
import ApiAccess from './pages/ApiAccess.jsx';
import Jobs from './pages/Jobs.jsx';
import Budgets from './pages/Budgets.jsx';
import Goals from './pages/Goals.jsx';
import AskAI from './pages/AskAI.jsx';
import Imports from './pages/Imports.jsx';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ActivityProvider>
            <Router>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/dashboard" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
                <Route path="/transactions" element={<ProtectedRoute><Layout><Transactions /></Layout></ProtectedRoute>} />
                <Route path="/banks" element={<ProtectedRoute><Layout><Banks /></Layout></ProtectedRoute>} />
                <Route path="/bank-statements" element={<ProtectedRoute><Layout><BankStatements /></Layout></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Layout><Settings /></Layout></ProtectedRoute>} />
                <Route path="/pdfs" element={<ProtectedRoute><Layout><PDFManagement /></Layout></ProtectedRoute>} />
                <Route path="/analytics" element={<ProtectedRoute><Layout><ModernDashboard /></Layout></ProtectedRoute>} />
                <Route path="/field-mapping" element={<ProtectedRoute><Layout><FieldMapping /></Layout></ProtectedRoute>} />
                <Route path="/csv" element={<ProtectedRoute><Layout><CsvExports /></Layout></ProtectedRoute>} />
                <Route path="/automation" element={<ProtectedRoute><Layout><Automation /></Layout></ProtectedRoute>} />
                <Route path="/api-access" element={<ProtectedRoute><Layout><ApiAccess /></Layout></ProtectedRoute>} />
                <Route path="/jobs" element={<ProtectedRoute><Layout><Jobs /></Layout></ProtectedRoute>} />
                <Route path="/budgets" element={<ProtectedRoute><Layout><Budgets /></Layout></ProtectedRoute>} />
                <Route path="/goals" element={<ProtectedRoute><Layout><Goals /></Layout></ProtectedRoute>} />
                <Route path="/assistant" element={<ProtectedRoute><Layout><AskAI /></Layout></ProtectedRoute>} />
                <Route path="/imports" element={<ProtectedRoute><Layout><Imports /></Layout></ProtectedRoute>} />
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Router>
          </ActivityProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
