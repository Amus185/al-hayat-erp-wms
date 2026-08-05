import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
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
  Menu,
  X,
  MapPin,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { label: 'Dashboard', path: '/', icon: Home, permission: '' },
  { label: 'Products', path: '/products', icon: PackageSearch, permission: 'manage_inventory' },
  { label: 'Warehouses', path: '/warehouses', icon: Boxes, permission: 'manage_inventory', adminOnly: true },
  { label: 'Inventory', path: '/inventory', icon: ClipboardList, permission: 'manage_inventory' },
  { label: 'Branches', path: '/branches', icon: Building2, permission: 'manage_users', adminOnly: true },
  { label: 'Transfers', path: '/transfers', icon: Truck, permission: 'manage_transfers' },
  { label: 'Purchasing', path: '/purchasing', icon: ClipboardList, permission: 'manage_purchasing' },
  { label: 'Sales', path: '/sales', icon: ShoppingCart, permission: 'manage_sales' },
  { label: 'Reports', path: '/reports', icon: BarChart3, permission: 'view_reports' },
  { label: 'Accounting', path: '/accounting', icon: BookOpen, permission: 'view_reports', adminOnly: true },
  { label: 'Audit Log', path: '/audit', icon: FileClock, permission: 'view_reports' },
  { label: 'Users', path: '/users', icon: Users, permission: 'manage_users', adminOnly: true },
];

// Map route prefixes → { section, title } for the topbar heading
const pageTitles: Record<string, { section: string; title: string }> = {
  '/':           { section: 'Operations Dashboard',   title: 'Inventory, purchasing, transfers, and sales' },
  '/products':   { section: 'Catalog',                title: 'Products' },
  '/warehouses': { section: 'Inventory',              title: 'Warehouses' },
  '/inventory':  { section: 'Stock Control',          title: 'Inventory' },
  '/branches':   { section: 'Organization',           title: 'Branches' },
  '/transfers':  { section: 'Movement',               title: 'Stock Transfers' },
  '/purchasing': { section: 'Procurement',            title: 'Purchasing' },
  '/sales':      { section: 'Revenue',                title: 'Sales' },
  '/reports':    { section: 'Analytics',              title: 'Reports' },
  '/accounting': { section: 'Finance',                title: 'Accounting' },
  '/audit':      { section: 'Compliance',             title: 'Audit Log' },
  '/users':      { section: 'Administration',         title: 'Users & Permissions' },
};

function usePageTitle() {
  const location = useLocation();
  const path = location.pathname;
  // Find longest matching prefix
  const match = Object.keys(pageTitles)
    .filter((key) => key === '/' ? path === '/' : path === key || path.startsWith(key + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return pageTitles[match] ?? { section: 'AlHayat ERP', title: path.replace('/', '') };
}

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { user, logout, hasPermission, isAdmin, isBranchUser } = useAuth();
  const navigate = useNavigate();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const pageTitle = usePageTitle();

  const handleLogout = () => {
    setIsMobileOpen(false);
    logout();
    navigate('/login');
  };

  const closeMobileNav = () => {
    setIsMobileOpen(false);
  };

  return (
    <div className="app-shell">
      {/* Mobile Overlay Backdrop */}
      {isMobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={closeMobileNav}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${isMobileOpen ? 'mobile-open' : ''}`}>
        <div className="brand">
          <div className="brand__logo">
            <img src="/logo.png" alt="AlHayat Furniture Logo" />
          </div>
          <div className="brand__text">
            <strong>AlHayat Furniture</strong>
          </div>
          <button
            type="button"
            className="sidebar-close-btn"
            onClick={closeMobileNav}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>
        
        <nav className="sidebar-nav">
          <div className="sidebar-nav-main">
            {navItems.map((item) => {
              const Icon = item.icon;
              // Hide admin-only items from branch users
              if ((item as any).adminOnly && !isAdmin) {
                return null;
              }
              // Check permission
              if (item.permission && !hasPermission(item.permission)) {
                return null;
              }

              return (
                <NavLink
                  to={item.path}
                  key={item.label}
                  onClick={closeMobileNav}
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
          <div className="topbar__left">
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setIsMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
            <div>
              {isBranchUser ? (
                <>
                  <p className="topbar-branch-label">
                    <MapPin size={12} style={{ display: 'inline', marginRight: 4 }} />
                    Branch Operations
                  </p>
                  <h1>My Branch Dashboard</h1>
                </>
              ) : (
                <>
                  <p>{pageTitle.section}</p>
                  <h1>{pageTitle.title}</h1>
                </>
              )}
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


