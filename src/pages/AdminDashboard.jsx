import { useState, useEffect } from "react";
import { auth } from "../config/firebase";
import { getUserById } from "../services/userService";
import { getDashboardStats } from "../services/adminService";
import AdminLayout from "../components/admin/AdminLayout";
import StatsCard from "../components/admin/StatsCard";
import LoadingScreen from "../components/LoadingScreen";
import "../styles/colors.css";
import "./AdminDashboard.css";

const AdminDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        const userDoc = await getUserById(user.uid);
        if (userDoc) {
          setUserData(userDoc);

          if (userDoc.role !== "Admin") {
            console.warn("Non-admin user accessed admin dashboard");
            return;
          }

          if (userDoc.status !== "active") {
            setLoading(false);
            return;
          }
        }

        const dashboardStats = await getDashboardStats();
        setStats(dashboardStats);
      } catch (error) {
        console.error("Error fetching admin data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (userData && userData.status !== "active") {
    return (
      <div className="admin-dashboard-blocked">
        <div className="blocked-message">
          <h2>Access Blocked</h2>
          <p>Your administrator account is inactive. Please contact system administrator.</p>
        </div>
      </div>
    );
  }

  if (userData && userData.role !== "Admin") {
    return (
      <div className="admin-dashboard-blocked">
        <div className="blocked-message">
          <h2>Access Denied</h2>
          <p>You do not have permission to access the admin dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <AdminLayout userData={userData} currentPage="dashboard">
      {loading ? (
        <LoadingScreen compact={true} />
      ) : (
      <div className="admin-dashboard">
        <div className="admin-dashboard-header">
          <h1 className="admin-dashboard-title">Admin Dashboard</h1>
          <p className="admin-dashboard-subtitle">System Overview</p>
        </div>

        {stats && (
          <section className="admin-stats-section">
            <h2 className="section-title">Overview</h2>
            <div className="stats-grid">
              <StatsCard
                title="Pending Proposals"
                value={stats.pendingProposals || 0}
                icon="📝"
                color="warning"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("adminNavigate", { detail: "activity-proposals" }));
                }}
              />
              <StatsCard
                title="Total Accounts"
                value={(stats.totalUsers || 0) - (stats.adminUsers || 0)}
                icon="👥"
                color="info"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("adminNavigate", { detail: "account-management" }));
                }}
              />
            </div>
          </section>
        )}

        <section className="admin-quick-actions">
          <h2 className="section-title">Quick Actions</h2>
          <div className="quick-actions-grid">
            <button
              className="quick-action-button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("adminNavigate", { detail: "activity-proposals" }));
              }}
            >
              <span className="quick-action-icon">📝</span>
              <span className="quick-action-label">Activity Proposals</span>
            </button>
            <button
              className="quick-action-button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("adminNavigate", { detail: "memorandums" }));
              }}
            >
              <span className="quick-action-icon">📄</span>
              <span className="quick-action-label">Memorandums</span>
            </button>
            <button
              className="quick-action-button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("adminNavigate", { detail: "account-management" }));
              }}
            >
              <span className="quick-action-icon">👥</span>
              <span className="quick-action-label">Manage Accounts</span>
            </button>
          </div>
        </section>
      </div>
      )}
    </AdminLayout>
  );
};

export default AdminDashboard;
