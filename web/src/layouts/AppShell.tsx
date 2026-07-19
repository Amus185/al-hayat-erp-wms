import { NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  Boxes,
  Building2,
  ClipboardList,
  FileClock,
  Home,
  PackageSearch,
  ShoppingCart,
  Truck,
  Users,
  LogOut,
  Menu,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { label: 'Dashboard', path: '/', icon: Home, permission: '' },
  { label: 'Products', path: '/products', icon: PackageSearch, permission: 'manage_inventory' },
  { label: 'Warehouses', path: '/warehouses', icon: Boxes, permission: 'manage_inventory' },
  { label: 'Inventory', path: '/inventory', icon: ClipboardList, permission: 'manage_inventory' },
  { label: 'Branches', path: '/branches', icon: Building2, permission: 'manage_users' },
  { label: 'Transfers', path: '/transfers', icon: Truck, permission: 'manage_transfers' },
  { label: 'Purchasing', path: '/purchasing', icon: ClipboardList, permission: 'manage_purchasing' },
  { label: 'Sales', path: '/sales', icon: ShoppingCart, permission: 'manage_sales' },
  { label: 'Reports', path: '/reports', icon: BarChart3, permission: 'view_reports' },
  { label: 'Audit Log', path: '/audit', icon: FileClock, permission: 'view_reports' },
  { label: 'Users', path: '/users', icon: Users, permission: 'manage_users' },
];

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <div 
          className="sidebar-backdrop" 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand__logo">
            <img src="/logo.png" alt="Al Hayat Logo" />
          </div>
          <div className="brand__text">
            <strong>Al Hayat</strong>
            <span>ERP System</span>
          </div>
        </div>
        
        <nav className="sidebar-nav">
          <div className="sidebar-nav-main">
            {navItems.map((item) => {
              const Icon = item.icon;
              // Check if user has permission
              if (item.permission && !hasPermission(item.permission)) {
                return null;
              }

              return (
                <NavLink
                  to={item.path}
                  key={item.label}
                  className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                  onClick={() => setIsSidebarOpen(false)}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>

          <div className="sidebar-divider" />
          
          <button
            type="button"
            className="sidebar-logout"
            onClick={handleLogout}
          >
            <LogOut size={18} />
            <span>Log Out</span>
          </button>
        </nav>
      </aside>
      
      <main className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              className="mobile-menu-btn" 
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={24} />
            </button>
            <div>
              <p>Operations Dashboard</p>
              <h1>Inventory, purchasing, transfers, and sales</h1>
            </div>
          </div>
          <div className="topbar__actions">
            <button type="button" title="Notifications">
              <Bell size={18} />
            </button>
            <div className="user-chip">
              {user?.fullName || 'Guest User'}
            </div>
          </div>
        </header>
        
        <div className="main-content">
          {children}
        </div>
      </main>
    </div>
  );
}
