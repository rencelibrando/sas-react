import { useState, useEffect, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./config/firebase";
import { getUserById, updateLastLogin } from "./services/userService";
import { getOrganizationById } from "./services/organizationService";
import { checkAndFireReportReminders } from "./services/notificationService";
import { markOverduePendingReports } from "./services/reportService";
import AuthPage from "./pages/AuthPage";
import HomePage from "./pages/HomePage";
import AdminDashboard from "./pages/AdminDashboard";
import AdminActivityProposals from "./pages/AdminActivityProposals";
import AdminProfilePage from "./pages/AdminProfilePage";
import AdminAccountManagement from "./pages/AdminAccountManagement";
import AdminEquipmentInventory from "./pages/AdminEquipmentInventory";
import AdminEquipmentRequests from "./pages/AdminEquipmentRequests";
import AdminActivityLog from "./pages/AdminActivityLog";
import AdminMemorandums from "./pages/AdminMemorandums";
import AdminReports from "./pages/AdminReports";
import EquipmentBorrowingPage from "./pages/EquipmentBorrowingPage";
import ActivityProposalsPage from "./pages/ActivityProposalsPage";
import ISGEndorsementPage from "./pages/ISGEndorsementPage";
import ISGDistributionPage from "./pages/ISGDistributionPage";
import MemorandumsPage from "./pages/MemorandumsPage";
import ReportsPage from "./pages/ReportsPage";
import ProfilePage from "./pages/ProfilePage";
import ReviewPage from "./pages/ReviewPage";
import LoadingScreen from "./components/LoadingScreen";
import Chatbot from "./components/Chatbot/Chatbot";
import "./App.css";

function App() {
  const isReviewRoute =
    typeof window !== "undefined" && window.location.pathname === "/review";

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState(null);
  const [checkingRole, setCheckingRole] = useState(false);
  const [adminPage, setAdminPage] = useState("dashboard");
  const [currentPage, setCurrentPage] = useState("home");
  const lastLoginUpdatedRef = useRef(new Set());

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        const firstAuthThisSession = !lastLoginUpdatedRef.current.has(currentUser.uid);
        if (firstAuthThisSession) {
          lastLoginUpdatedRef.current.add(currentUser.uid);
          updateLastLogin(currentUser.uid).catch(error => {
            console.error("Error updating last login:", error);
          });
        }

        setCheckingRole(true);
        try {
          const userDoc = await getUserById(currentUser.uid);
          if (userDoc) {
            setUserRole(userDoc.role || null);
          } else {
            setUserRole(null);
          }
          // Admin-only post-auth scans: promote overdue reports + fire deadline
          // reminder notifications. Org users can't enumerate the reports
          // collection (rules forbid it), so we gate by role. Non-blocking.
          if (firstAuthThisSession && userDoc?.role === "Admin") {
            markOverduePendingReports().catch((err) =>
              console.error("markOverduePendingReports failed:", err)
            );
            checkAndFireReportReminders().catch((err) =>
              console.error("checkAndFireReportReminders failed:", err)
            );
          }
        } catch (error) {
          console.error("Error fetching user role:", error);
          setUserRole(null);
        } finally {
          setCheckingRole(false);
          setLoading(false);
        }
      } else {
        lastLoginUpdatedRef.current.clear();
        setUserRole(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const [hasOrgInfo, setHasOrgInfo] = useState(false);
  const [checkingOrgInfo, setCheckingOrgInfo] = useState(false);
  const [orgType, setOrgType] = useState(null);

  useEffect(() => {
    const checkOrgInfo = async () => {
      if (user) {
        setCheckingOrgInfo(true);
        try {
          const userDoc = await getUserById(user.uid);
          const hasOrgId = userDoc?.organizationId && userDoc.organizationId.trim() !== "";
          const hasRole = userDoc?.role && userDoc.role.trim() !== "";
          const hasUserRole = userDoc?.userRole && userDoc.userRole.trim() !== "";

          if (userDoc && hasOrgId && hasRole && hasUserRole) {
            setHasOrgInfo(true);
            const orgDoc = await getOrganizationById(userDoc.organizationId);
            setOrgType(orgDoc?.type || null);
          } else {
            setHasOrgInfo(false);
            setOrgType(null);
          }
        } catch (error) {
          console.error("Error checking user org info:", error);
          setHasOrgInfo(false);
          setOrgType(null);
        } finally {
          setCheckingOrgInfo(false);
        }
      } else {
        setHasOrgInfo(false);
        setOrgType(null);
      }
    };

    checkOrgInfo();
  }, [user]);

  useEffect(() => {
    const handleAdminNavigate = (event) => {
      if (event.detail && typeof event.detail === "string") {
        setAdminPage(event.detail);
      }
    };

    window.addEventListener("adminNavigate", handleAdminNavigate);
    return () => window.removeEventListener("adminNavigate", handleAdminNavigate);
  }, []);

  useEffect(() => {
    const handlePageNavigate = (event) => {
      if (event.detail && typeof event.detail === "string") {
        setCurrentPage(event.detail);
      }
    };

    window.addEventListener("pageNavigate", handlePageNavigate);
    return () => window.removeEventListener("pageNavigate", handlePageNavigate);
  }, []);

  if (isReviewRoute) {
    return (
      <div className="App">
        <ReviewPage />
      </div>
    );
  }

  if (loading || checkingRole || checkingOrgInfo) {
    return <LoadingScreen />;
  }

  if (!user) {
    return (
      <div className="App">
        <AuthPage />
      </div>
    );
  }

  const isAdmin = userRole === "Admin";

  let pageElement;
  if (isAdmin) {
    switch (adminPage) {
      case "activity-proposals":
        pageElement = <AdminActivityProposals />;
        break;
      case "account-management":
        pageElement = <AdminAccountManagement />;
        break;
      case "equipment-inventory":
        pageElement = <AdminEquipmentInventory />;
        break;
      case "equipment-requests":
        pageElement = <AdminEquipmentRequests />;
        break;
      case "profile":
        pageElement = <AdminProfilePage />;
        break;
      case "activity-log":
        pageElement = <AdminActivityLog />;
        break;
      case "memorandums":
        pageElement = <AdminMemorandums />;
        break;
      case "reports":
        pageElement = <AdminReports />;
        break;
      case "dashboard":
      default:
        pageElement = <AdminDashboard />;
        break;
    }
  } else if (!hasOrgInfo) {
    return (
      <div className="App">
        <AuthPage />
      </div>
    );
  } else {
    switch (currentPage) {
      case "activity-proposals":
        pageElement = <ActivityProposalsPage orgType={orgType} />;
        break;
      case "equipment-borrowing":
        pageElement = <EquipmentBorrowingPage orgType={orgType} />;
        break;
      case "isg-endorsement":
        pageElement = <ISGEndorsementPage />;
        break;
      case "isg-distribution":
        pageElement = <ISGDistributionPage />;
        break;
      case "memorandums":
        pageElement = <MemorandumsPage orgType={orgType} />;
        break;
      case "reports":
        pageElement = <ReportsPage orgType={orgType} />;
        break;
      case "profile":
        pageElement = <ProfilePage orgType={orgType} />;
        break;
      case "home":
      default:
        pageElement = orgType === "ISG" ? <ISGEndorsementPage /> : <HomePage />;
        break;
    }
  }

  return (
    <>
      <div className="App">{pageElement}</div>
      <Chatbot user={user} userRole={userRole} orgType={orgType} />
    </>
  );
}

export default App;
