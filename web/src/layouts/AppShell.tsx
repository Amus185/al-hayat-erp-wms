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
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { label: 'Dashboard', path: '/', icon: Home, permission: '' },
  { label: 'Products', path: '/products', icon: PackageSearch, permission: 'products.read' },
  { label: 'Warehouses', path: '/warehouses', icon: Boxes, permission: 'inventory.read' },
  { label: 'Inventory', path: '/inventory', icon: ClipboardList, permission: 'inventory.read' },
  { label: 'Branches', path: '/branches', icon: Building2, permission: 'products.read' },
  { label: 'Transfers', path: '/transfers', icon: Truck, permission: 'transfers.create' },
  { label: 'Purchasing', path: '/purchasing', icon: ClipboardList, permission: 'purchasing.write' },
  { label: 'Sales', path: '/sales', icon: ShoppingCart, permission: 'sales.write' },
  { label: 'Reports', path: '/reports', icon: BarChart3, permission: 'reports.read' },
  { label: 'Audit Log', path: '/audit', icon: FileClock, permission: 'audit.read' },
  { label: 'Users', path: '/users', icon: Users, permission: 'users.manage' },
];

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__logo">
            <img src="/logo.png" alt="Al Hayat Logo" />
          </div>
          <div className="brand__text">
            <strong>Al Hayat</strong>
            <span>ERP + WMS</span>
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
          <div>
            <p>Operations Command</p>
            <h1>Furniture inventory, transfers, purchasing, and sales</h1>
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
