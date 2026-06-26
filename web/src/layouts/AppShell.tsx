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
          <div className="brand__mark">AH</div>
          <div>
            <strong>Al Hayat</strong>
            <span>ERP + WMS</span>
          </div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 64px)', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
                  style={({ isActive }) => ({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 16px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: isActive ? '#fff' : '#c2d2c2',
                    background: isActive ? '#0b8f08' : 'transparent',
                    textDecoration: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    width: '100%',
                    textAlign: 'start'
                  })}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>

          <div>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 16px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                color: '#f87171',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                width: '100%',
                textAlign: 'start',
                marginTop: 'auto'
              }}
            >
              <LogOut size={18} />
              <span>Log Out</span>
            </button>
          </div>
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
        <div style={{ flex: '1', overflowY: 'auto', padding: '24px' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
