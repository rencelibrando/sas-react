import { useState, useRef, useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../config/firebase";
import { logAuthEvent } from "../services/authActivityLogService";
import Icon from "./Icon";
import sasLogo from "../assets/images/logos/sas-logo.png";
import "../styles/colors.css";
import "./Navbar.css";

const Navbar = () => {
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
        context: "user-navbar",
      });
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <div className="navbar-logo-container">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <img src={sasLogo} alt="SAS Logo" className="navbar-logo-img" />
            <div className="navbar-logo">SAS</div>
          </div>
          <div className="navbar-app-name">Student Affairs and Services</div>
        </div>
      </div>

      <div className="navbar-center">
      </div>

      <div className="navbar-right">
        <div className="navbar-user-menu" ref={menuRef}>
          <button
            className="navbar-user-button"
            onClick={() => setShowUserMenu(!showUserMenu)}
            aria-label="User menu"
          >
            <Icon name="profile" size={20} className="user-avatar navbar-icon-white" />
          </button>

          {showUserMenu && (
            <div className="user-menu-dropdown">
              <button className="user-menu-item" onClick={() => {
                setShowUserMenu(false);
                window.dispatchEvent(new CustomEvent("pageNavigate", { detail: "profile" }));
              }}>
                <Icon name="profile" size={18} />
                <span>Profile</span>
              </button>
              <div className="user-menu-divider"></div>
              <button className="user-menu-item user-menu-item--danger" onClick={handleLogout}>
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

export default Navbar;
