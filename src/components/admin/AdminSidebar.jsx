import { useState } from "react";
import Icon from "../Icon";
import "../../styles/colors.css";
import "./AdminSidebar.css";

const AdminSidebar = ({ currentPage = "dashboard", onNavigate }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const menuItems = [
    { id: "dashboard", label: "Dashboard Overview", icon: "dashboard" },
    { id: "activity-proposals", label: "Activity Proposals", icon: "activity-proposals" },
    { id: "reports", label: "Reports", icon: "reports" },
    { id: "memorandums", label: "Memorandums", icon: "documents" },
    { id: "equipment-requests", label: "Equipment Requests", icon: "equipment" },
    { id: "equipment-inventory", label: "Equipment Inventory", icon: "equipment-management" },
    { id: "account-management", label: "Account Management", icon: "building" },
    { id: "activity-log", label: "Activity Log", icon: "analytics" },
  ];

  const handleMenuClick = (item) => {
    if (onNavigate) {
      onNavigate(item.id);
    } else {
      console.log(`Navigate to ${item.id}`);
    }
  };

  return (
    <aside className={`admin-sidebar ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      <button 
        className="admin-sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle sidebar"
      >
        <Icon name={sidebarOpen ? "chevron-left" : "chevron-right"} size={16} className="sidebar-toggle-icon" />
      </button>
      
      <nav className="admin-sidebar-nav">
        {menuItems.map((item) => (
          <button
            key={item.id}
            className={`admin-sidebar-nav-item ${currentPage === item.id ? "active" : ""}`}
            onClick={() => handleMenuClick(item)}
            title={sidebarOpen ? "" : item.label}
          >
            <span className="admin-sidebar-nav-icon">
              <Icon name={item.icon} size={24} />
            </span>
            {sidebarOpen && <span className="admin-sidebar-nav-label">{item.label}</span>}
          </button>
        ))}
      </nav>
    </aside>
  );
};

export default AdminSidebar;

