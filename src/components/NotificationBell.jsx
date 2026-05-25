import { useState, useEffect, useRef } from "react";
import {
  subscribeToNotifications,
  markAsRead,
  markAllAsRead,
} from "../services/notificationService";
import Icon from "./Icon";
import "./NotificationBell.css";

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
};

const formatTimeAgo = (value) => {
  const d = toDate(value);
  if (!d) return "";
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const NotificationBell = ({ userId, isAdmin = false }) => {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribeToNotifications(userId, setNotifications);
  }, [userId]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const unread = notifications.filter((n) => !n.isRead).length;

  const handleItemClick = async (n) => {
    if (!n.isRead) {
      try {
        await markAsRead(n.id);
      } catch (err) {
        console.error("markAsRead failed:", err);
      }
    }
    if (n.link) {
      const eventName = isAdmin ? "adminNavigate" : "pageNavigate";
      window.dispatchEvent(new CustomEvent(eventName, { detail: n.link }));
    }
    setOpen(false);
  };

  const handleMarkAll = async () => {
    if (!userId) return;
    try {
      await markAllAsRead(userId);
    } catch (err) {
      console.error("markAllAsRead failed:", err);
    }
  };

  return (
    <div className="notification-bell" ref={ref}>
      <button
        type="button"
        className="notification-bell-button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
      >
        <Icon name="notifications" size={20} className="navbar-icon-white" />
        {unread > 0 && (
          <span className="notification-bell-badge">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="notification-bell-dropdown">
          <div className="notification-bell-header">
            <span>Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                className="notification-bell-mark-all"
                onClick={handleMarkAll}
              >
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="notification-bell-empty">No notifications yet.</div>
          ) : (
            <ul className="notification-bell-list">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={`notification-bell-item ${
                    !n.isRead ? "notification-bell-item--unread" : ""
                  }`}
                  onClick={() => handleItemClick(n)}
                >
                  <div className="notification-bell-item-title">{n.title}</div>
                  {n.message && (
                    <div className="notification-bell-item-message">
                      {n.message}
                    </div>
                  )}
                  <div className="notification-bell-item-time">
                    {formatTimeAgo(n.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
