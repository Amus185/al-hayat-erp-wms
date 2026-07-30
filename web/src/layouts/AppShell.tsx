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
  BookOpen,
} from 'lucide-react';
import type { ReactNode } from 'react';
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
  { label: 'Accounting', path: '/accounting', icon: BookOpen, permission: 'view_reports' },
  { label: 'Audit Log', path: '/audit', icon: FileClock, permission: 'view_reports' },
  { label: 'Users', path: '/users', icon: Users, permission: 'manage_users' },
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
            <img src="/logo.png" alt="AlHayat Furniture Logo" />
          </div>
          <div className="brand__text">
            <strong>AlHayat Furniture</strong>
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
            <p>Operations Dashboard</p>
            <h1>Inventory, purchasing, transfers, and sales</h1>
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
