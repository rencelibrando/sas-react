import { useState } from "react";
import Icon from "./Icon";
import "../styles/colors.css";
import "./DashboardLayout.css";

const DashboardLayout = ({ children, currentPage = "dashboard", orgType = null }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const menuItems = orgType === "ISG"
    ? [
        { id: "isg-endorsement", label: "Endorsement Queue", icon: "activity-proposals" },
        { id: "isg-distribution", label: "Distribution", icon: "dashboard" },
        { id: "activity-proposals", label: "Our Proposals", icon: "activity-proposals" },
        { id: "equipment-borrowing", label: "Equipment Borrowing", icon: "equipment" },
        { id: "memorandums", label: "Memorandums", icon: "documents" },
        { id: "profile", label: "Profile", icon: "profile" },
      ]
    : [
        { id: "dashboard", label: "Dashboard", icon: "dashboard" },
        { id: "activity-proposals", label: "Activity Proposals", icon: "activity-proposals" },
        { id: "equipment-borrowing", label: "Equipment Borrowing", icon: "equipment" },
        { id: "profile", label: "Profile", icon: "profile" },
      ];

  const pageMap = {
    dashboard: "home",
    "activity-proposals": "activity-proposals",
    "equipment-borrowing": "equipment-borrowing",
    "isg-endorsement": "isg-endorsement",
    "isg-distribution": "isg-distribution",
    memorandums: "memorandums",
    profile: "profile",
  };

  const handleMenuClick = (item) => {
    const pageId = pageMap[item.id] || item.id;
    window.dispatchEvent(new CustomEvent("pageNavigate", { detail: pageId }));
  };

  return (
    <div className="dashboard-layout">
      <aside className={`dashboard-sidebar ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
        <button 
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        >
          <Icon name={sidebarOpen ? "chevron-left" : "chevron-right"} size={16} className="sidebar-toggle-icon" />
        </button>
        
        <nav className="sidebar-nav">
          {menuItems.map((item) => (
            <button
              key={item.id}
              className={`sidebar-nav-item ${currentPage === item.id ? "active" : ""}`}
              onClick={() => handleMenuClick(item)}
              title={sidebarOpen ? "" : item.label}
            >
              <span className="sidebar-nav-icon">
                <Icon name={item.icon} size={24} />
              </span>
              {sidebarOpen && <span className="sidebar-nav-label">{item.label}</span>}
            </button>
          ))}
        </nav>
      </aside>

      <main className="dashboard-main">
        {children}
      </main>
    </div>
  );
};

export default DashboardLayout;

