import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { useAuth } from './contexts/AuthContext';

// Pages
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductDetailsPage } from './pages/ProductDetailsPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { InventoryPage } from './pages/InventoryPage';
import { BranchesPage } from './pages/BranchesPage';
import { BranchDetailsPage } from './pages/BranchDetailsPage';
import { TransfersPage } from './pages/TransfersPage';
import { CreateTransferPage } from './pages/CreateTransferPage';
import { PurchasingPage } from './pages/PurchasingPage';
import { CreatePOPage } from './pages/CreatePOPage';
import { SalesPage } from './pages/SalesPage';
import { CreateSalesOrderPage } from './pages/CreateSalesOrderPage';
import { ReportsPage } from './pages/ReportsPage';
import { AuditPage } from './pages/AuditPage';
import { UsersPage } from './pages/UsersPage';

function ProtectedRoute({ permission }: { permission?: string }) {
  const { isAuthenticated, hasPermission, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', background: '#f4fbf4' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ inlineSize: '40px', blockSize: '40px', border: '3px solid #e1e8e1', borderTopColor: '#0b8f08', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }}></div>
          <p style={{ color: '#066006', fontWeight: '500' }}>Checking Security Credentials...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (permission && !hasPermission(permission)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

function AppShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected Core Routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShellLayout />}>
            <Route path="/" element={<DashboardPage />} />
            
            {/* Products catalog */}
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/products/:id" element={<ProductDetailsPage />} />
            
            {/* Warehouses configuration */}
            <Route path="/warehouses" element={<WarehousesPage />} />
            
            {/* Stock ledger */}
            <Route path="/inventory" element={<InventoryPage />} />
            
            {/* Branches analytics */}
            <Route path="/branches" element={<BranchesPage />} />
            <Route path="/branches/:id" element={<BranchDetailsPage />} />
            
            {/* Stock Transfers */}
            <Route path="/transfers" element={<TransfersPage />} />
            <Route path="/transfers/new" element={<CreateTransferPage />} />
            
            {/* Procurement POs */}
            <Route path="/purchasing" element={<PurchasingPage />} />
            <Route path="/purchasing/new" element={<CreatePOPage />} />
            
            {/* Sales orders */}
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/sales/new" element={<CreateSalesOrderPage />} />
            
            {/* Reports */}
            <Route path="/reports" element={<ReportsPage />} />
            
            {/* Audit Logs */}
            <Route path="/audit" element={<AuditPage />} />
            
            {/* Identity & Access Management */}
            <Route path="/users" element={<UsersPage />} />
          </Route>
        </Route>

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
export default App;
