import { useState, useEffect, useRef, useCallback } from 'react';
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
  UserCheck,
  Receipt,
  Landmark,
  Factory,
  ArrowLeftRight,
  CheckCheck,
  Clock,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiGet, apiPost } from '../api/client';

const navItems = [
  { label: 'Dashboard', path: '/', icon: Home, permission: '' },
  { label: 'Products', path: '/products', icon: PackageSearch, permission: 'manage_inventory' },
  { label: 'Warehouses', path: '/warehouses', icon: Boxes, permission: 'manage_inventory', adminOnly: true },
  { label: 'Inventory', path: '/inventory', icon: ClipboardList, permission: 'manage_inventory' },
  { label: 'Manufacturing', path: '/manufacturing', icon: Factory, permission: 'manage_inventory' },
  { label: 'Branches', path: '/branches', icon: Building2, permission: 'manage_users', adminOnly: true },
  { label: 'Transfers', path: '/transfers', icon: ArrowLeftRight, permission: 'manage_transfers' },
  { label: 'Purchasing', path: '/purchasing', icon: ClipboardList, permission: 'manage_purchasing' },
  { label: 'Sales', path: '/sales', icon: ShoppingCart, permission: 'manage_sales' },
  { label: 'Deliveries', path: '/deliveries', icon: Truck, permission: 'manage_sales' },
  { label: 'Customers', path: '/customers', icon: UserCheck, permission: 'manage_sales' },
  { label: 'Expenses', path: '/expenses', icon: Receipt, permission: 'manage_purchasing' },
  { label: 'Owner\'s Assets', path: '/assets', icon: Landmark, permission: '', adminOnly: true },
  { label: 'Reports', path: '/reports', icon: BarChart3, permission: 'view_reports' },
  { label: 'Accounting', path: '/accounting', icon: BookOpen, permission: 'view_reports', adminOnly: true },
  { label: 'Audit Log', path: '/audit', icon: FileClock, permission: 'view_reports', adminOnly: true },
  { label: 'Users', path: '/users', icon: Users, permission: 'manage_users', adminOnly: true },
];

// Map route prefixes → { section, title } for the topbar heading
const pageTitles: Record<string, { section: string; title: string }> = {
  '/':              { section: 'Operations Dashboard',   title: 'Inventory, purchasing, transfers, and sales' },
  '/products':      { section: 'Catalog',                title: 'Products' },
  '/warehouses':    { section: 'Inventory',              title: 'Warehouses' },
  '/inventory':     { section: 'Stock Control',          title: 'Inventory' },
  '/manufacturing': { section: 'Production',             title: 'Manufacturing & Work Orders' },
  '/branches':      { section: 'Organization',           title: 'Branches' },
  '/transfers':     { section: 'Movement',               title: 'Stock Transfers' },
  '/purchasing':    { section: 'Procurement',            title: 'Purchasing' },
  '/sales':         { section: 'Revenue',                title: 'Sales' },
  '/deliveries':    { section: 'Logistics',              title: 'Product Deliveries & Fleet' },
  '/customers':     { section: 'Sales',                  title: 'Customers' },
  '/expenses':      { section: 'Finance',                title: 'Expenses' },
  '/assets':        { section: 'Owner Investments',      title: "Owner's Assets & Investments" },
  '/reports':       { section: 'Analytics',              title: 'Reports' },
  '/accounting':    { section: 'Finance',                title: 'Accounting' },
  '/audit':         { section: 'Compliance',             title: 'Audit Log' },
  '/users':         { section: 'Administration',         title: 'Users & Permissions' },
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

  // Notification states
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [readIds, setReadIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('alhayat_read_notifications');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const popoverRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await apiGet<any[]>('/notifications');
      if (Array.isArray(data)) {
        setNotifications(data);
      }
    } catch (err) {
      console.warn('Failed to load notifications:', err);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Click outside to close notifications popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications]);

  const unreadCount = notifications.filter(
    (n) => !readIds.includes(n.id) && !n.read_at
  ).length;

  const handleNotificationClick = (item: any) => {
    if (!readIds.includes(item.id)) {
      const updated = [...readIds, item.id];
      setReadIds(updated);
      try {
        localStorage.setItem('alhayat_read_notifications', JSON.stringify(updated));
      } catch { /* */ }
    }
    setShowNotifications(false);
    if (item.link) {
      navigate(item.link);
    }
  };

  const handleMarkAllAsRead = async () => {
    const allIds = notifications.map((n) => n.id);
    const merged = Array.from(new Set([...readIds, ...allIds]));
    setReadIds(merged);
    try {
      localStorage.setItem('alhayat_read_notifications', JSON.stringify(merged));
      await apiPost('/notifications/read');
    } catch { /* */ }
  };

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
            <div className="notification-btn-wrapper" ref={popoverRef}>
              <button
                type="button"
                title="Notifications"
                onClick={() => setShowNotifications((prev) => !prev)}
                aria-expanded={showNotifications}
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="notification-badge">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="notification-popover">
                  <div className="notification-popover__header">
                    <h3>
                      Notifications
                      <span className={`notification-popover__count ${unreadCount > 0 ? 'notification-popover__count--active' : ''}`}>
                        {unreadCount} new
                      </span>
                    </h3>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        className="notification-popover__mark-btn"
                        onClick={handleMarkAllAsRead}
                      >
                        <CheckCheck size={14} style={{ display: 'inline', marginRight: 4 }} />
                        Mark all as read
                      </button>
                    )}
                  </div>

                  <div className="notification-popover__list">
                    {notifications.length === 0 ? (
                      <div className="notification-popover__empty">
                        No pending delivery or transfer alerts.
                      </div>
                    ) : (
                      notifications.map((item) => {
                        const isUnread = !readIds.includes(item.id) && !item.read_at;
                        return (
                          <div
                            key={item.id}
                            className={`notification-popover__item ${isUnread ? 'unread' : ''}`}
                            onClick={() => handleNotificationClick(item)}
                          >
                            <div className={`notification-item__icon notification-item__icon--${(item.type || 'system').toLowerCase()}`}>
                              {item.type === 'DELIVERY' ? (
                                <Truck size={16} />
                              ) : item.type === 'TRANSFER' ? (
                                <ArrowLeftRight size={16} />
                              ) : (
                                <Bell size={16} />
                              )}
                            </div>
                            <div className="notification-item__content">
                              <div className="notification-item__title">
                                <span>{item.title}</span>
                                {item.status && (
                                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: '#f1f5f9', fontWeight: 600 }}>
                                    {item.status}
                                  </span>
                                )}
                              </div>
                              <div className="notification-item__message">
                                {item.message}
                              </div>
                              <div className="notification-item__date">
                                <Clock size={11} style={{ display: 'inline', marginRight: 4 }} />
                                <span>{item.date ? new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent'}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

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


