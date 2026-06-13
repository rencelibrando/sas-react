import { useState, useRef, useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../../config/firebase";
import { logAuthEvent } from "../../services/authActivityLogService";
import Icon from "../Icon";
import NotificationBell from "../NotificationBell";
import sasLogo from "../../assets/images/logos/sas-logo.png";
import "../../styles/colors.css";
import "./AdminNavbar.css";

const AdminNavbar = ({ userData = null }) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      const current = auth.currentUser;
      await logAuthEvent({
        type: "logout",
        email: current?.email || null,
        userId: current?.uid || null,
        success: true,
        context: "admin-navbar",
      });
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const userRole = userData?.userRole || "Administrator";

  return (
    <nav className="admin-navbar">
      <div className="admin-navbar-left">
        <div className="admin-navbar-logo-container">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <img src={sasLogo} alt="SAS Logo" className="admin-navbar-logo-img" />
            <div className="admin-navbar-logo">ADMINISTRATOR</div>
          </div>
          <div className="admin-navbar-app-name">Student Affairs and Services</div>
        </div>
      </div>
      
      <div className="admin-navbar-right">
        <NotificationBell userId={auth.currentUser?.uid} isAdmin />
        <div className="admin-user-menu" ref={menuRef}>
          <button 
            className="admin-user-button"
            onClick={() => setShowUserMenu(!showUserMenu)}
            aria-label="User menu"
          >
            <Icon name="profile" size={20} className="admin-user-avatar navbar-icon-white" />
          </button>
          
          {showUserMenu && (
            <div className="admin-user-menu-dropdown">
              <button className="admin-user-menu-item" onClick={() => {
                setShowUserMenu(false);
                window.dispatchEvent(new CustomEvent("adminNavigate", { detail: "profile" }));
              }}>
                <Icon name="profile" size={18} />
                <span>Admin Profile</span>
              </button>
              <div className="admin-user-menu-divider"></div>
              <button className="admin-user-menu-item admin-user-menu-item--danger" onClick={handleLogout}>
                <Icon name="lock" size={18} />
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default AdminNavbar;

