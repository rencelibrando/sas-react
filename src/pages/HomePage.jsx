import { useState, useEffect } from "react";
import { auth } from "../config/firebase";
import { getUserById } from "../services/userService";
import { getOrganizationById } from "../services/organizationService";
import Navbar from "../components/Navbar";
import DashboardLayout from "../components/DashboardLayout";
import LoadingScreen from "../components/LoadingScreen";
import MemorandumsSection from "../components/MemorandumsSection";
import "../styles/colors.css";
import "../styles/home.css";
import "./HomePage.css";

const HomePage = () => {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [organizationData, setOrganizationData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getUserById(user.uid);
        if (cancelled) return;
        if (userDoc) {
          setUserData(userDoc);
          if (userDoc.organizationId) {
            const orgDoc = await getOrganizationById(userDoc.organizationId);
            if (!cancelled && orgDoc) setOrganizationData(orgDoc);
          }
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const organizationName = organizationData?.name || "Organization";
  const role = userData?.role || "ISG";
  const userRole = userData?.userRole || "";
  const userName = userData?.fullName || auth.currentUser?.email || "User";

  return (
    <div className="home-container">
      <Navbar
        organizationName={organizationName}
        role={role}
        userRole={userRole}
        userName={userName}
      />

      <DashboardLayout currentPage="dashboard">
        {loading ? (
          <LoadingScreen compact={true} />
        ) : (
          <div className="dashboard-content">
            <section className="welcome-section">
              <div className="welcome-header">
                <h1 className="welcome-title">Welcome, {userName}</h1>
                <div className="welcome-org-info">
                  <span className="welcome-org-label">Representing:</span>
                  <span className="welcome-org-name">{organizationName}</span>
                </div>
              </div>
            </section>

            <MemorandumsSection heading="SAS Memorandums" />
          </div>
        )}
      </DashboardLayout>
    </div>
  );
};

export default HomePage;
